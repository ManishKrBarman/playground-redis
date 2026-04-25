import { rateLimiter } from "./rate-limit.js";

import { createClient } from "redis";

const client = createClient();

client.on("error", (err) => console.log("Redis Error", err));

await client.connect();

console.log("Connected to Redis");



// Test the function

(async () => {
    for (let i = 1; i <= 10; i++) {
        console.log(await rateLimiter(client, "user123"));
        console.log(await client.get("otp:user123"));
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
})();