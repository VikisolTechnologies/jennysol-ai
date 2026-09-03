import type { ZodError } from "zod";

// Every route sends { error: string } to the client, which does
// `new Error(data.error)` — passing a Zod error object directly there
// stringifies to the literal text "[object Object]" instead of a real
// message. Always go through this instead of `.flatten()`.
export function zodErrorMessage(error: ZodError): string {
  const first = error.issues[0];
  if (!first) return "Invalid request";
  const field = first.path.join(".");
  return field ? `${field}: ${first.message}` : first.message;
}
