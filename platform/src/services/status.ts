import type { Env } from "../env";
import { first } from "../lib/db";
import { now, timeAgo } from "../lib/time";
import { telemetryHealth } from "./telemetry";
import { emailProvider } from "../auth/email";
import { listAlertStates, requestRate, type AlertStateRow, type RequestRate } from "./observability";

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
  metrics: {
    activeInstallations24h: number;
    publishedProducts: number;
    activeLicenses: number;
    pendingTelemetry: number;
    lastTelemetryAt: number;
    alertsFiring: number;
    http5xxRate5m: number;
  };
}

export async function getStatusReport(env: Env): Promise<StatusReport> {
  const started = Date.now();
  let dbOk = true;
  let dbLatency = 0;
  try {
    await first<{ ok: number }>(env.DB, `SELECT 1 AS ok`);
    dbLatency = Date.now() - started;
  } catch {
    dbOk = false;
  }

  let health = { lastProcessedAt: 0, processedBatches: 0, pendingEvents: 0, latestHeartbeatAt: null as number | null };
  try {
    health = await telemetryHealth(env);
  } catch {
    /* database failure is reported by the db component */
  }

  let alerts: AlertStateRow[] = [];
  let errorRate: RequestRate = { total: 0, errors: 0, rate: 0 };
  if (dbOk) {
    try {
      [alerts, errorRate] = await Promise.all([listAlertStates(env), requestRate(env)]);
    } catch {
      /* observability tables may not exist before migration 0008 is applied */
    }
  }
  const firing = alerts.filter((alert) => alert.status === "firing");

  let activeInstallations24h = 0;
  let publishedProducts = 0;
  let activeLicenses = 0;
  if (dbOk) {
    const [installations, products, licenses] = await Promise.all([
      first<{ count: number }>(
        env.DB,
        `SELECT COUNT(*) AS count FROM installations WHERE last_heartbeat_at > ? AND status = 'active'`,
        now() - 24 * 60 * 60 * 1000,
      ),
      first<{ count: number }>(env.DB, `SELECT COUNT(*) AS count FROM products WHERE status = 'published'`),
      first<{ count: number }>(env.DB, `SELECT COUNT(*) AS count FROM licenses WHERE status = 'active'`),
    ]);
    activeInstallations24h = installations?.count ?? 0;
    publishedProducts = products?.count ?? 0;
    activeLicenses = licenses?.count ?? 0;
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
      detail: dbOk ? `ตอบสนองใน ${dbLatency} ms` : "เชื่อมต่อฐานข้อมูลไม่สำเร็จ",
    },
  ];

  if (health.processedBatches === 0 && health.pendingEvents === 0) {
    components.push({
      key: "telemetry",
      name: "การประมวลผล Telemetry",
      status: "no_data",
      detail: "ยังไม่มีข้อมูลจากเซิร์ฟเวอร์ลูกค้า — ระบบยังไม่ได้รับ heartbeat",
    });
  } else {
    const stale = health.lastProcessedAt === 0 || now() - health.lastProcessedAt > 30 * 60 * 1000;
    components.push({
      key: "telemetry",
      name: "การประมวลผล Telemetry",
      status: health.pendingEvents > 500 || (stale && health.pendingEvents > 0) ? "degraded" : "operational",
      detail:
        health.lastProcessedAt > 0
          ? `ประมวลผลล่าสุด ${timeAgo(health.lastProcessedAt, "th")} · ค้าง ${health.pendingEvents} รายการ`
          : `ยังไม่มีการประมวลผล · ค้าง ${health.pendingEvents} รายการ`,
    });
  }

  if (alerts.length > 0) {
    components.push({
      key: "alerts",
      name: "การแจ้งเตือนอัตโนมัติ",
      status: firing.length > 0 ? "degraded" : "operational",
      detail:
        firing.length > 0
          ? `กำลังทำงาน ${firing.length} รายการ: ${firing.map((alert) => alert.key).join(", ")}`
          : `ปกติ · 5xx ${(errorRate.rate * 100).toFixed(2)}% ใน 5 นาที`,
    });
  }

  components.push({
    key: "email",
    name: "อีเมล transactional",
    status: emailProvider(env) === "console" ? "degraded" : "operational",
    detail:
      emailProvider(env) === "console"
        ? "โหมดพัฒนา (console) — ยังไม่ได้ตั้งค่าผู้ให้บริการอีเมลจริง"
        : `ผู้ให้บริการ: ${emailProvider(env)}`,
  });

  const overall: ComponentStatus = !dbOk
    ? "down"
    : components.some((component) => component.status === "degraded")
      ? "degraded"
      : "operational";

  return {
    overall,
    components,
    generatedAt: now(),
    metrics: {
      activeInstallations24h,
      publishedProducts,
      activeLicenses,
      pendingTelemetry: health.pendingEvents,
      lastTelemetryAt: health.lastProcessedAt,
      alertsFiring: firing.length,
      http5xxRate5m: errorRate.rate,
    },
  };
}
