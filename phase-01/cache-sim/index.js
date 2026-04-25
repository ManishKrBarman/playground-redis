import { getUser } from "./req-redis.js";

import { createClient } from "redis";

const client = createClient();

client.on("error", (err) => console.log("Redis Error", err));

await client.connect();

console.log("Connected to Redis");



// Test the function

console.time("getUser");
await getUser(client, 2); // first time from db
console.timeEnd("getUser");

console.time("getUser");
await getUser(client, 2); // second time from cache
console.timeEnd("getUser");

console.time("getUser");
await getUser(client, 2); // third time from cache
console.timeEnd("getUser");
