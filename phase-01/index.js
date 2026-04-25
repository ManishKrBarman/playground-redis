import { createClient } from "redis";

const client = createClient();

client.on("error", (err) => console.log("Redis Error", err));

await client.connect();

console.log("Connected to Redis");