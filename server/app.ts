import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { apiRouter } from "./routes/api.js";
import { connectDB } from "./config/db.js";

dotenv.config();

export const app = express();

// Global Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Eager DB Connection initiation (non-blocking)
connectDB().catch((err) => {
  console.warn("[DB] Non-blocking initial database connection error:", err);
});

// Mount API routes at both /api and root
// This guarantees requests resolve whether Vercel rewrites preserve /api prefix or strip it
app.use("/api", apiRouter);
app.use(apiRouter);

export default app;
