import express from 'express';
import cookieParser from 'cookie-parser';
import { pool } from '@repo/db';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cookieParser());

app.get('/health', (req, res) => {
    res.send("server running...");
});

// Start the server
const server = app.listen(PORT, () => {
    console.log(`🔥 Server is running on http://localhost:${PORT}`);
});

pool.on("error", (error: Error): void => {
  console.error("DB POOL ERR:", error);
});


process.on("SIGTERM", () => { 
    server.on("close", async () => { 
        await pool.end();
        process.exit(1);
    })
 })
    