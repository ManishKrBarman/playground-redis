# Redis Playground

A monorepo for learning and practicing Redis - organized by phases.

## Structure

```
redis/
├── package.json          ← root (shared deps: redis, nodemon)
├── phase-01/             ← Phase 1: Redis basics & caching
│   ├── index.js
│   └── cache-sim/        ← Cache simulation exercise
├── phase-02/             ← Phase 2: Rate limiting & beyond
│   ├── rate-limit/       ← Basic rate limiter
│   └── otp-rate-limit/   ← OTP rate limiter
└── node_modules/         ← single install, shared by all
```

## How It Works

This repo uses **npm workspaces**. All shared dependencies (`redis`, `nodemon`, etc.) are installed once at the root and available everywhere.

### Adding a new phase

```bash
mkdir phase-02
# Create a package.json inside it (see phase-01 as a template)
npm install   # re-link workspaces
```

### Running a specific workspace

```bash
# Run from root, targeting a workspace by name:
npm run dev -w phase-01

# Or cd into the directory and run directly:
cd phase-01
npm run dev
```

## Quick Commands

| Command | Description |
|---------|-------------|
| `npm run start:redis` | Start Redis server |
| `npm run start:redis-cli` | Open Redis CLI |
| `npm run dev -w phase-01` | Run phase-01 in dev mode |
