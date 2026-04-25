export async function rateLimiter(client, userId) {
  const key = `rate:${userId}`;

  // increment request count
  const count = await client.incr(key);

  // set expiry ONLY on first request
  if (count === 1) {
    await client.expire(key, 60); // 60 seconds window
  }

  if (count > 5) {
    return {status: false, message: "Too many requests"};
  }

  return {status: true, message: "Request allowed"};
}