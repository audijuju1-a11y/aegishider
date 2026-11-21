/** Structured logging with conservative redaction. */
const SECRET_KEY = /(token|secret|password|authorization|api[-_]?key|private|signature|cookie)/i;

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  level: LogLevel;
  event: string;
  ts: string;
  [key: string]: unknown;
}

/** Bounded so an isolate cannot grow memory if nothing drains the buffer. */
const MAX_BUFFERED_RECORDS = 50;
let buffered: LogRecord[] = [];

/**
 * warn/error records are buffered for the observability sink. The HTTP
 * middleware, the cron handler and the queue consumer drain them when their
 * turn ends (see services/observability.ts).
 */
export function drainLogRecords(): LogRecord[] {
  if (buffered.length === 0) return [];
  const records = buffered;
  buffered = [];
  return records;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => redact(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(child, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function log(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const record: LogRecord = {
    level,
    event,
    ts: new Date().toISOString(),
    ...(redact(fields) as Record<string, unknown>),
  };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
  if ((level === "error" || level === "warn") && buffered.length < MAX_BUFFERED_RECORDS) {
    buffered.push(record);
  }
}

export function logError(event: string, error: unknown, fields: Record<string, unknown> = {}): void {
  log("error", event, {
    ...fields,
    error: error instanceof Error ? { name: error.name, message: error.message } : error,
  });
}
