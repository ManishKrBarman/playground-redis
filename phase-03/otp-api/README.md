# Phase-03 — OTP API (Generate & Verify)

A production-style OTP (One-Time Password) service built with **Express** and **Redis**, focused on learning real-world patterns like **rate limiting**, **cooldown mechanics**, **atomicity**, **race conditions**, and **structured logging**.

---

## Table of Contents

- [What It Does](#what-it-does)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
- [Redis Key Design](#redis-key-design)
- [Rate Limiting — The 3 Approaches (and Why WAY 3 Won)](#rate-limiting--the-3-approaches-and-why-way-3-won)
  - [WAY 1 — Timestamp-Based Cooldown](#way-1--timestamp-based-cooldown)
  - [WAY 2 — Simple Flag with Expiry](#way-2--simple-flag-with-expiry)
  - [WAY 3 — Counter + Progressive Cooldown (Final)](#way-3--counter--progressive-cooldown-final)
- [Race Conditions & Atomicity](#race-conditions--atomicity)
- [Concurrency Considerations](#concurrency-considerations)
- [Logging Strategy](#logging-strategy)
  - [Where to Log and Where Not To](#where-to-log-and-where-not-to)
- [Bugs Faced & Lessons Learned](#bugs-faced--lessons-learned)
- [How the Functions Work](#how-the-functions-work)

---

## What It Does

Two endpoints:

1. **`POST /send-otp`** — Generates a random 6-digit OTP, stores it in Redis with a 5-minute TTL, and enforces a 60-second resend cooldown.
2. **`POST /verify-otp`** — Validates the submitted OTP against the stored value, tracks failed attempts, enforces progressive cooldowns, and cleans up all keys on success.

The whole point is **not** just "store an OTP" — it's about handling the edge cases that come with it: what if someone brute-forces OTPs? What if two requests hit at the same time? What if the cooldown key gets overwritten?

---

## Tech Stack

| Tool       | Why                                                              |
| ---------- | ---------------------------------------------------------------- |
| Express    | Lightweight HTTP server                                          |
| Redis      | In-memory key-value store — perfect for ephemeral data like OTPs |
| Winston    | Structured JSON logging to files (no console noise in prod)      |
| Nodemon    | Auto-restart during development                                  |

> All dependencies are hoisted from the root monorepo (`redis-playground`) via npm workspaces — no local `node_modules` in this directory.

---

## Getting Started

```bash
# From the monorepo root
npm install

# Start Redis (WSL or native)
redis-server

# Run the OTP service
npm start -w phase-03/otp-api

# Or with auto-reload
npm run dev -w phase-03/otp-api
```

The server starts on **port 3000**.

---

## Project Structure

```
phase-03/otp-api/
├── index.js          # Main Express app — endpoints, Redis logic, rate limiting
├── logger.js         # Winston logger configuration
├── logs/
│   ├── combined.log  # All logs (info + error)
│   └── error.log     # Errors only (invalid OTPs, rate limits)
├── package.json      # Workspace package config
└── README.md         # You're here
```

---

## API Endpoints

### `POST /send-otp`

**Request:**
```json
{ "mobile": "9907221244" }
```

**Success (200):**
```json
{ "message": "OTP sent successfully", "otp": "482917" }
```

**Rate Limited (429):** — if requested again within 60 seconds
```json
{ "error": "Please wait 45 seconds before requesting a new OTP" }
```

---

### `POST /verify-otp`

**Request:**
```json
{ "mobile": "9907221244", "otp": "482917" }
```

**Success (200):**
```json
{ "message": "OTP verified successfully" }
```

**Invalid OTP (400):**
```json
{ "error": "Invalid OTP" }
```

**Expired OTP (400):**
```json
{ "error": "Expired OTP" }
```

**Rate Limited (429):** — during cooldown period
```json
{ "error": "Please wait 15 seconds before submitting OTP again" }
```

**Too Many Attempts (400):** — after 5+ failed attempts
```json
{ "error": "Too many attempts" }
```

---

## Redis Key Design

Every key is namespaced with a clear prefix to avoid collisions and make debugging easier:

| Key Pattern                  | Type   | TTL     | Purpose                                              |
| ---------------------------- | ------ | ------- | ---------------------------------------------------- |
| `otp:valid:{mobile}`         | String | 300s    | The actual OTP value — expires in 5 minutes           |
| `otp:sent:{mobile}`          | String | None*   | Timestamp of when OTP was last sent (resend cooldown) |
| `otp:attempts:{mobile}`      | String | 300s    | Counter of failed verification attempts               |
| `otp:cooldown:{mobile}`      | String | Dynamic | Flag key — its TTL **is** the cooldown duration       |

> `otp:sent` has no TTL set explicitly — it gets overwritten on every new OTP send. This is intentional because we calculate the age manually (`Date.now() - sentAt`) instead of relying on Redis expiry.

**Why this prefix pattern?**  
Instead of a single key per mobile, we split concerns into separate keys. This means we can independently expire the OTP itself, the attempt counter, and the cooldown without them interfering with each other.

---

## Rate Limiting — The 3 Approaches (and Why WAY 3 Won)

This was the core learning journey. Three different strategies were tried, each one fixing problems from the previous.

---

### WAY 1 — Timestamp-Based Cooldown

```js
// On invalid OTP:
await redisClient.set(`otp:invalid:${mobile}`, Date.now());

// On verify, check before processing:
const invalidAt = await redisClient.get(`otp:invalid:${mobile}`);
const age = Math.floor((Date.now() - invalidAt) / 1000);
if (age < 5) {
  return res.status(429).json({ error: `Please wait ${5 - age} seconds...` });
}
```

**Problems:**

- ❌ **Fixed cooldown** — always 5 seconds, regardless of how many times someone fails
- ❌ **Manual time math** — calculating `Date.now() - storedTimestamp` is fragile and depends on server clock
- ❌ **No attempt tracking** — can't differentiate between 1st and 50th failure
- ❌ **Key never expires** — `otp:invalid` lives forever unless manually deleted
- ❌ **No escalation** — a brute-forcer just waits 5 seconds every time

---

### WAY 2 — Simple Flag with Expiry

```js
// On invalid OTP:
await redisClient.set(`otp:cooldown:${mobile}`, "1", { EX: 15 });

// On verify, check before processing:
const cooldown = await redisClient.get(`otp:cooldown:${mobile}`);
if (cooldown) {
  return res.status(429).json({ error: "Please wait before submitting again" });
}
```

**Improvements over WAY 1:**

- ✅ **Redis handles expiry** — no manual time math, the key just disappears
- ✅ **Cleaner code** — simple flag check

**Still broken:**

- ❌ **Fixed cooldown** — always 15 seconds, no escalation
- ❌ **No attempt counting** — still can't tell how many times someone has failed
- ❌ **Vague error message** — can't tell the user exactly how long to wait (the `expiry` variable in the commented code was referencing an undefined variable — this was a bug)
- ❌ **No max attempts cap** — unlimited retries after each cooldown

---

### WAY 3 — Counter + Progressive Cooldown (Final) ✅

```js
const attemptsKey = `otp:attempts:${mobile}`;
const cooldownKey = `otp:cooldown:${mobile}`;

// Check cooldown FIRST (using TTL, not GET)
const ttl = await redisClient.ttl(cooldownKey);
if (ttl > 0) {
  return res.status(429).json({
    error: `Please wait ${ttl} seconds before submitting OTP again`
  });
}

// On invalid OTP:
const attempts = await redisClient.incr(attemptsKey);
if (attempts === 1) {
  await redisClient.expire(attemptsKey, 300); // 5 min window
}
if (attempts > 5) {
  return res.status(400).json({ error: "Too many attempts" });
}

const expiry = attempts * 10; // 10s, 20s, 30s, 40s, 50s...
await redisClient.set(cooldownKey, "1", { EX: expiry });
```

**Why this is the right approach:**

- ✅ **Progressive cooldown** — cooldown scales with attempts (`attempts * 10` seconds)
- ✅ **Attempt tracking** — `INCR` is atomic, so concurrent requests get correct counts
- ✅ **Max attempts cap** — after 5 failures, hard block
- ✅ **TTL-based check** — `redisClient.ttl()` gives exact seconds remaining, so the user gets a precise "wait X seconds" message
- ✅ **Self-cleaning** — both keys expire on their own, and get explicitly deleted on successful verification
- ✅ **Accurate error messages** — user knows exactly how long to wait

**Cooldown progression:**

| Attempt | Cooldown Duration |
| ------- | ----------------- |
| 1st     | 10 seconds        |
| 2nd     | 20 seconds        |
| 3rd     | 30 seconds        |
| 4th     | 40 seconds        |
| 5th     | 50 seconds        |
| 6th+    | Hard blocked      |

---

## Race Conditions & Atomicity

### The Problem

When two verification requests arrive at **the exact same time** for the same mobile number:

```
Request A: reads cooldownKey → not set     ← both see "no cooldown"
Request B: reads cooldownKey → not set
Request A: INCR attempts → 1, sets cooldown to 10s
Request B: INCR attempts → 2, OVERWRITES cooldown to 20s   ← race!
```

The cooldown key gets **overwritten** — Request B's `SET` clobbers Request A's `SET`. The `INCR` is fine (it's atomic in Redis), but the `SET` for the cooldown is not.

### The Fix (Commented in Code)

```js
// SET with NX — only set if the key does NOT already exist
const isSet = await redisClient.set(cooldownKey, "1", {
  NX: true,  // "Not eXists" — only set if key is absent
  EX: expiry
});

if (!isSet) {
  // Someone else already set the cooldown — respect it
  const ttl = await redisClient.ttl(cooldownKey);
  return res.status(429).json({
    error: `Please wait ${ttl} seconds`
  });
}
```

**Why `NX` matters:**

- `SET key value EX 10` — **always** sets the key, even if it already exists (overwrites)
- `SET key value NX EX 10` — **only** sets if the key doesn't exist, returns `null` if it does

This makes the cooldown set **atomic** — the first request wins, and the second one gracefully backs off.

### Why It's Commented Out

For a single-server, single-user learning project, the race condition is near-impossible to trigger. The fix is there as documentation of the **right** production pattern. In a real-world scenario with multiple app servers behind a load balancer, this becomes critical.

---

## Concurrency Considerations

### Redis is Single-Threaded — But Your App Isn't

Redis processes commands one at a time (single-threaded event loop), so individual commands like `INCR` are inherently atomic. But your **Node.js app** is concurrent — multiple `async` handlers can be running simultaneously.

The danger zone is between **reading** and **writing**:

```
// DANGER: "check-then-act" pattern
const attempts = await redisClient.get(attemptsKey);    // READ
const newAttempts = parseInt(attempts) + 1;             // COMPUTE
await redisClient.set(attemptsKey, newAttempts);        // WRITE
```

Between the `GET` and `SET`, another request could have already incremented the counter. This is why **`INCR`** is used instead — it does the read-modify-write in a single atomic Redis command.

### Key Takeaway

| Pattern                              | Safe? | Why                                       |
| ------------------------------------ | ----- | ----------------------------------------- |
| `GET` → manual increment → `SET`     | ❌    | Two requests can read the same old value  |
| `INCR`                               | ✅    | Atomic read-modify-write inside Redis     |
| `SET` (overwrite)                    | ⚠️    | Safe for single writes, dangerous for racing updates |
| `SET` with `NX`                      | ✅    | Only first writer wins, others get `null` |

---

## Logging Strategy

### Winston Setup (`logger.js`)

```js
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});
```

- **`combined.log`** — captures everything: OTP sends, successful verifications, and all errors
- **`error.log`** — only errors: invalid OTPs, rate limit hits, expired OTPs

Logs are JSON-formatted so they can be parsed by log aggregators (ELK, Datadog, etc.) in production.

### Log Format

Every log entry follows a consistent structured pattern:

```
[HTTP_METHOD] [MOBILE] -> [EVENT] additional_context | [TIMESTAMP]
```

**Examples:**
```json
{"level":"info","message":"[POST] [9907221244] -> [OTP Sent] [2026-04-25T15:39:41.947Z]"}
{"level":"error","message":"[POST] [9907221244] -> [Invalid OTP] attempts: 2 | cooling for 20 seconds | [2026-04-25T15:39:57.204Z]"}
{"level":"error","message":"[POST] [9907221244] -> [Rate Limited] cooling for 5 seconds | [2026-04-25T15:39:51.128Z]"}
```

### Where to Log and Where Not To

| Event                          | Log?  | Level    | Why                                                                     |
| ------------------------------ | ----- | -------- | ----------------------------------------------------------------------- |
| OTP Sent                       | ✅    | `info`   | Normal operation — audit trail of OTP generation                        |
| OTP Verified                   | ✅    | `info`   | Success event — important for tracking legitimate usage                 |
| Invalid OTP submitted          | ✅    | `error`  | Potential attack / misuse — need to track attempts                      |
| Rate limited (cooldown active) | ✅    | `error`  | Abuse signal — someone is hitting during cooldown                       |
| Expired OTP                    | ✅    | `error`  | Could indicate UX issues or stale sessions                             |
| Too many attempts              | ✅    | `error`  | Hard block trigger — definitely suspicious                              |
| Home route (`/`)               | ✅    | `info`   | Basic health check logging                                              |
| OTP value in logs              | ⚠️    | —        | Currently logged to console (`console.log`). **Never** log OTP values to file in production — security risk |
| Redis connection events        | ✅    | console  | Kept as `console.log` — infrastructure-level, not business logic        |
| Input validation failures      | ❌    | —        | No logging needed — these are just bad requests, not suspicious activity |

**Key Decision:** The `logger.error` for rate-limited attempts is placed **before** the response is sent. This ensures the log is written even if the response fails or the connection drops. The `attempts` count is retrieved from the `TTL` check on the cooldown key, not from a separate GET — fewer Redis calls.

---

## Bugs Faced & Lessons Learned

### 1. `expiry` Variable Was Undefined (WAY 2)
In WAY 2, the error message tried to use an `expiry` variable that didn't exist in that scope:
```js
.json({ error: `Please wait ${expiry} seconds...` });
// `expiry` is not defined here — bug!
```
**Fix:** WAY 3 uses `ttl` from `redisClient.ttl()` which always returns the actual remaining seconds.

### 2. `otp:sent` Key Has No Expiry
The `otp:sent:{mobile}` key is set without a TTL. This means it stays in Redis forever (until overwritten). For a learning project this is fine, but in production you'd want:
```js
await redisClient.set(`otp:sent:${mobile}`, Date.now(), { EX: 60 });
```

### 3. Setting Expiry on the Attempts Key
The first time `INCR` creates the key (`attempts === 1`), we set a 300-second TTL on it. But `INCR` on a non-existent key creates it with **no expiry** by default. If we didn't set the expiry conditionally, the attempts counter would live forever:
```js
const attempts = await redisClient.incr(attemptsKey);
if (attempts === 1) {
  await redisClient.expire(attemptsKey, 300); // Only on first attempt
}
```
**Why `attempts === 1`?** — We only want to set the window once. If we set it on every attempt, the window keeps extending (a user could fail 5 times over 25 minutes by spacing them out, each time resetting the 5-minute window).

### 4. Where to Place the Cooldown Check
The cooldown check (`ttl > 0`) **must** come before the `redisClient.get(otp:valid)` call. If placed after, we'd still be fetching the stored OTP on every rate-limited request — wasted Redis calls. Order matters:
```
1. Validate input      → 400 if missing
2. Check cooldown      → 429 if cooling
3. Get stored OTP      → 400 if expired
4. Compare OTPs        → 400 if mismatch, set cooldown
5. Success             → clean up all keys
```

### 5. `parseInt` for OTP Comparison
OTPs are stored as strings in Redis but need to be compared as numbers to avoid type mismatches:
```js
if (parseInt(storedOtp) !== parseInt(otp)) { ... }
```
Without `parseInt`, `"123456" !== 123456` would be `true` even for correct OTPs.

### 6. Logging Rate Limited Attempts — Getting the Right Data
Initially, the logger was placed after the response was sent. The fix was to move `logger.error` **before** `res.status(429).json(...)` to ensure the log captures the TTL accurately before the response goes out. The TTL value was already available from the check above, no extra Redis call needed.

---

## How the Functions Work

### `generateOTP()`
Simple utility — generates a random 6-digit number as a string:
```js
Math.floor(100000 + Math.random() * 900000).toString()
// Range: 100000–999999 (always 6 digits, never starts with 0)
```

### `/send-otp` Flow
```
Request → Validate mobile → Check resend cooldown (otp:sent) →
  ↳ If recently sent → 429 with remaining wait time
  ↳ Else → Generate OTP → Store in Redis (5 min TTL) →
           Mark as sent → Log → Respond with OTP
```

### `/verify-otp` Flow
```
Request → Validate input → Check cooldown (TTL on otp:cooldown) →
  ↳ If cooling → Log + 429 with TTL
  ↳ Else → Get stored OTP →
    ↳ If no OTP exists → Log + 400 "Expired"
    ↳ If OTP mismatch →
      ↳ INCR attempts → Set expiry if first →
        ↳ If attempts > 5 → Log + 400 "Too many attempts"
        ↳ Else → Set cooldown (attempts * 10s) → Log + 400 "Invalid"
    ↳ If OTP matches → Delete all keys → Log + 200 "Verified"
```

---

## What I Learned

- **Redis `INCR` is your friend** for anything counter-based — it's atomic, creates the key if missing, and returns the new value in one shot.
- **`SET` with `NX` + `EX`** is the correct pattern for distributed locks and one-time flags.
- **TTL is data** — using `redisClient.ttl()` to get remaining cooldown time is cleaner than storing timestamps and doing manual math.
- **Key design matters** — splitting `otp:valid`, `otp:attempts`, and `otp:cooldown` into separate keys with independent TTLs gives fine-grained control.
- **Log errors before responses** — if the connection drops, at least you have the log.
- **Don't log sensitive data to files** — OTP values go to `console.log` for dev, never to the persistent logger.
- **Order of checks matters** — cheapest/fastest checks first (input validation), then rate limits, then actual business logic.
