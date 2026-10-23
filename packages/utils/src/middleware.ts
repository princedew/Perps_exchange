import type { NextFunction, Request, Response } from "express";
import type z from "zod";
import jwt, { type JwtPayload } from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config({});

const secret = process.env.JWT_SECRET;

type SchemaObject = {
  body: z.ZodType;
  query: z.ZodType;
  params: z.ZodType;
};

type Key = "body" | "query" | "params";
type Issue = Record<Key, z.core.$ZodIssue[]>;
type SchemaArray = [Key, z.ZodType][];

export function validate(schemaObject: Partial<SchemaObject>) {
  let issues: Partial<Issue> = {};
  return async (req: Request, res: Response, next: NextFunction) => {
    for (const [key, schema] of Object.entries(schemaObject) as SchemaArray) {
      const result = await schema.safeParseAsync(req[key]);
      if (!result.success) {
        issues[key] = result.error.issues;
      }
    }
    if (Object.entries(issues).length > 0) {
      return res
        .status(400)
        .json({ success: false, message: "Validation Failed." });
    } else {
      next();
    }
  };
}

declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

export function auth(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies.token;
  if (!token) {
    return res.status(400).json({ success: false, message: "Forbidden" });
  }
  if (!secret) {
    return res
      .status(400)
      .json({ success: false, message: "JWT is not configured." });
  }
  const decode = jwt.verify(token, secret);

  if (!decode || typeof decode === "string") {
    return res.status(409).json({ success: false, message: "Invalid token." });
  }
  if (Number.isNaN(Number(decode.userId))) {
    return res.status(409).json({ success: false, message: "Invalid Id type" });
  }
  req.userId = decode.userId;
  next();
}


