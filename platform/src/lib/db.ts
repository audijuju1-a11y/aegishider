/** Thin typed helpers over D1. All SQL is parameterised at the call site. */

export type SqlValue = string | number | null;

export async function first<T>(
  db: D1Database,
  sql: string,
  ...params: SqlValue[]
): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}

export async function all<T>(
  db: D1Database,
  sql: string,
  ...params: SqlValue[]
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all<T>();
  return result.results ?? [];
}

export async function run(
  db: D1Database,
  sql: string,
  ...params: SqlValue[]
): Promise<D1Result> {
  return db.prepare(sql).bind(...params).run();
}

export async function batch(db: D1Database, statements: D1PreparedStatement[]): Promise<D1Result[]> {
  if (statements.length === 0) return [];
  return db.batch(statements);
}

export async function scalar<T extends SqlValue>(
  db: D1Database,
  sql: string,
  ...params: SqlValue[]
): Promise<T | null> {
  const row = await db.prepare(sql).bind(...params).first<Record<string, T>>();
  if (!row) return null;
  const values = Object.values(row);
  return values.length > 0 ? values[0]! : null;
}

export function affected(result: D1Result): number {
  return result.meta?.changes ?? 0;
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
