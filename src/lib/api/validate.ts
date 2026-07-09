// GCCLAB TMS — request body validation helper (zod)
// Parses and validates a JSON request body against a zod schema. On failure it
// returns a 422 response via the standard envelope; callers do:
//   const parsed = await parseBody(req, schema);
//   if ("error" in parsed) return parsed.error;
//   const { ... } = parsed.data;
import type { ZodType } from "zod";
import { validationError } from "./response";
import type { NextResponse } from "next/server";

type ParseResult<T> = { data: T } | { error: NextResponse };

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { error: validationError("Request body must be valid JSON") };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return { error: validationError("Validation failed", result.error.flatten()) };
  }
  return { data: result.data };
}

// Validate an already-parsed value (e.g. query params assembled into an object).
export function parseValue<T>(value: unknown, schema: ZodType<T>): ParseResult<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    return { error: validationError("Validation failed", result.error.flatten()) };
  }
  return { data: result.data };
}
