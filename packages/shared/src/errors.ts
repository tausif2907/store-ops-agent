/**
 * A one-line description of an error for logs: its type, code and the first
 * line of its message. Full error objects can carry request data (a Prisma
 * error repeats the query's arguments), so they are not logged whole.
 */
export function errorSummary(err: unknown): string {
  if (!(err instanceof Error)) return String(err).split("\n")[0]!.slice(0, 300);
  const code = (err as { code?: unknown }).code;
  const firstLine = err.message.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return `${err.name}${typeof code === "string" ? ` ${code}` : ""}: ${firstLine.slice(0, 300)}`;
}
