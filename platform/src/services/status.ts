import type { Env } from "../env";
import { first } from "../lib/db";
import { now, timeAgo } from "../lib/time";
import { telemetryHealth } from "./telemetry";

export type ComponentStatus = "operational" | "degraded" | "down" | "no_data";

export interface StatusComponent {
  key: string;
  name: string;
  status: ComponentStatus;
  detail: string;
}

export interface StatusReport {
  overall: ComponentStatus;
  components: StatusComponent[];
  generatedAt: number;
}

/**
 * Public status is intentionally coarse: it answers "is the service reachable
 * and processing data?" without exposing customer counts, queue depth, provider
 * names, exact latency or alert keys.
 */
export async function getStatusReport(env: Env): Promise<StatusReport> {
  let dbOk = true;
  try {
    await first<{ ok: number }>(env.DB, `SELECT 1 AS ok`);
  } catch {
    dbOk = false;
  }

  let health = { lastProcessedAt: 0, processedBatches: 0, pendingEvents: 0, latestHeartbeatAt: null as number | null };
  try {
    health = await telemetryHealth(env);
  } catch {
    /* database failure is reported by the db component */
  }

  const components: StatusComponent[] = [
    {
      key: "api",
      name: "เว็บและ API",
      status: "operational",
      detail: "คำขอนี้ถูกประมวลผลสำเร็จ",
    },
    {
      key: "database",
      name: "ฐานข้อมูล",
      status: dbOk ? "operational" : "down",
      detail: dbOk ? "เชื่อมต่อฐานข้อมูลได้" : "เชื่อมต่อฐานข้อมูลไม่สำเร็จ",
    },
  ];

  if (health.processedBatches === 0 && health.pendingEvents === 0) {
    components.push({
      key: "telemetry",
      name: "การประมวลผล telemetry",
      status: "no_data",
      detail: "ยังไม่ได้รับ heartbeat จากเซิร์ฟเวอร์ลูกค้า",
    });
  } else {
    const stale = health.lastProcessedAt === 0 || now() - health.lastProcessedAt > 30 * 60 * 1000;
    components.push({
      key: "telemetry",
      name: "การประมวลผล telemetry",
      status: health.pendingEvents > 500 || (stale && health.pendingEvents > 0) ? "degraded" : "operational",
      detail:
        health.lastProcessedAt > 0
          ? `ประมวลผลล่าสุด ${timeAgo(health.lastProcessedAt, "th")}`
          : "ยังไม่มีการประมวลผล",
    });
  }

  const overall: ComponentStatus = !dbOk
    ? "down"
    : components.some((component) => component.status === "degraded")
      ? "degraded"
      : "operational";

  return { overall, components, generatedAt: now() };
}
