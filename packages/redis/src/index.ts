import { Redis } from "ioredis";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../../../.env") });

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

export const CACHE_KEY = {
  
}

export const redis = new Redis(REDIS_URL);


