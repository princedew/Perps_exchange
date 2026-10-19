import dotenv from "dotenv";
import path from "node:path";
import { Pool } from "pg";

dotenv.config({
  path: path.resolve(process.cwd(), ".env"),
});

const connectionString = process.env.DATABASE_URL;

export const pool = new Pool({
  connectionString,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
});

