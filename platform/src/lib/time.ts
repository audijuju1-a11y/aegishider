/** Time, formatting and canonical-JSON helpers. */

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function now(): number {
  return Date.now();
}

export function addDays(base: number, days: number): number {
  return base + days * DAY;
}

export function addHours(base: number, hours: number): number {
  return base + hours * HOUR;
}

export function addMinutes(base: number, minutes: number): number {
  return base + minutes * MINUTE;
}

export function startOfBucket(ms: number, bucketMs: number): number {
  return Math.floor(ms / bucketMs) * bucketMs;
}

export function formatDateTime(ms: number | null | undefined, lang: "th" | "en" = "th"): string {
  if (!ms) return "—";
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(ms));
}

export function formatDate(ms: number | null | undefined, lang: "th" | "en" = "th"): string {
  if (!ms) return "—";
  return new Intl.DateTimeFormat(lang === "th" ? "th-TH" : "en-GB", {
    dateStyle: "medium",
    timeZone: "Asia/Bangkok",
  }).format(new Date(ms));
}

export function timeAgo(ms: number | null | undefined, lang: "th" | "en" = "th"): string {
  if (!ms) return lang === "th" ? "ยังไม่มีข้อมูล" : "No data";
  const delta = Date.now() - ms;
  const absolute = Math.abs(delta);
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [DAY, "day"],
    [HOUR, "hour"],
    [MINUTE, "minute"],
    [SECOND, "second"],
  ];
  const formatter = new Intl.RelativeTimeFormat(lang === "th" ? "th" : "en", { numeric: "auto" });
  for (const [unitMs, unit] of units) {
    if (absolute >= unitMs || unit === "second") {
      return formatter.format(Math.round(-delta / unitMs), unit);
    }
  }
  return formatter.format(0, "second");
}

export function hoursBetween(from: number, to: number): number {
  return Math.round((to - from) / HOUR);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function parsePositiveInt(value: string | undefined, fallback: number, max = 1000): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

/**
 * Deterministic JSON used for signed payloads.
 * Rules: object keys sorted by UTF-16 code units, no whitespace, integer numbers
 * only, strings escaped by JSON.stringify. The signature always covers the exact
 * UTF-8 bytes of this output; verifiers must verify the received bytes as-is.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "string") return JSON.stringify(value);
  if (type === "boolean") return value ? "true" : "false";
  if (type === "number") {
    if (!Number.isFinite(value as number) || !Number.isInteger(value as number)) {
      throw new Error("canonicalJson: only finite integers are supported");
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (type === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error(`canonicalJson: unsupported type ${type}`);
}

export function safeJsonParse<T>(input: string | null | undefined, fallback: T): T {
  if (!input) return fallback;
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

export function jsonArray<T>(input: string | null | undefined): T[] {
  const parsed = safeJsonParse<unknown>(input, []);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

export function jsonObject(input: string | null | undefined): Record<string, unknown> {
  const parsed = safeJsonParse<unknown>(input, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}
