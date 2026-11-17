// Create the lab tables (idempotent).
import { makePool, initSchema } from "../server/db.mjs";
const pool = makePool();
await initSchema(pool);
console.log("schema ready");
await pool.end();
