import type { Request, Response } from "express";
import { app } from "../server/app.js";
import { connectDB } from "../server/config/db.js";

export default async function handler(req: Request, res: Response) {
  try {
    await connectDB();
  } catch {
    // Memory store fallback
  }
  return app(req, res);
}
