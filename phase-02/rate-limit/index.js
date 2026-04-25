import { rateLimiter } from "./rate-limit.js";

import { createClient } from "redis";

const client = createClient();

client.on("error", (err) => console.log("Redis Error", err));

await client.connect();

console.log("Connected to Redis");



// Test the function
for (let i = 1; i <= 7; i++) {
  console.log(await rateLimiter(client, "user123"));
}