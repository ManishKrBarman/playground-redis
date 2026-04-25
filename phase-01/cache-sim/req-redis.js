import { getUserFromDB } from "./req-db.js";

export async function getUser(client, id) {
    const key = `user:${id}`;

    // 1. Check cache
    const cachedData = await client.get(key);

    if (cachedData) {
        console.log("Cache HIT");
        return JSON.parse(cachedData);
    }

    // 2. Cache MISS → fetch from DB
    console.log("Cache MISS");
    const user = await getUserFromDB(id);

    // 3. Store in Redis with TTL
    await client.set(key, JSON.stringify(user), {
        EX: 60, // cache for 1 min
    });

    return user;
}