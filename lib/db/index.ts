import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import { buildPoolConfig } from "./connection"
import * as schema from "./schema"

export const pool = new Pool(buildPoolConfig())
export const db = drizzle(pool, { schema })
