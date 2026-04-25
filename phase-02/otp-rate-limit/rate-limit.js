export async function rateLimiter(client, userId) {
  const key = `rate:${userId}`;

  // increment request count
  const count = await client.incr(key);

  // set expiry ONLY on first request
  if (count === 1) {
    await client.expire(key, 60); // 60 seconds window
  }

  if (count > 5) {
    return {success: false, message: "Too many requests"};
  }

  // generate OTP only when request is allowed
  const otp = Math.floor(1000 + Math.random() * 9000);
  await client.set(`otp:${userId}`, otp, { EX: 60 });

  return {success: true, message: "Request allowed", otp};
}