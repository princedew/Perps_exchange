import { pool } from "../src/db.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function migrate() {
  const sql = readFileSync(join(__dirname, "../migrations/001_schema.sql"), "utf-8");
  
  await pool.query(sql);
  
  console.log("Migration applied successfully");
  await pool.end();
}

migrate().catch(console.error);