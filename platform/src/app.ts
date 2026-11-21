import { Hono } from "hono";
import type { AppEnv } from "./env";
import { isProduction } from "./env";
import { combinedMiddleware } from "./middleware";
import { marketingRoutes } from "./routes/marketing";
import { authRoutes } from "./routes/auth";
import { portalRoutes } from "./routes/portal";
import { adminRoutes } from "./routes/admin";
import { apiRoutes } from "./routes/api";
import { AppError } from "./lib/errors";
import { jsonResponse } from "./lib/http";
import { logError } from "./lib/logger";
import { publicPage } from "./routes/helpers";
import { errorPage } from "./views/marketing";

const app = new Hono<AppEnv>();

app.use("*", combinedMiddleware);

app.route("/auth", authRoutes);
app.route("/app", portalRoutes);
app.route("/admin", adminRoutes);
app.route("/api", apiRoutes);
app.route("/", marketingRoutes);

app.notFound((c) => {
  if (c.req.path.startsWith("/api/")) {
    return jsonResponse({ error: { code: "not_found", message: "route not found", request_id: c.get("requestId") } }, 404);
  }
  return publicPage(c, {
    title: "ไม่พบหน้านี้",
    body: errorPage("ไม่พบหน้านี้", "ลิงก์อาจเปลี่ยนหรือหน้านี้ถูกย้ายแล้ว"),
    status: 404,
    noIndex: true,
  });
});

app.onError((error, c) => {
  const requestId = c.get("requestId") ?? "unknown";
  if (error instanceof AppError) {
    if (c.req.path.startsWith("/api/")) {
      return jsonResponse(
        {
          error: {
            code: error.code,
            message: error.message,
            details: error.details ?? undefined,
            request_id: requestId,
          },
        },
        error.status,
        error.headers,
      );
    }
    if (error.status === 401) {
      const next = encodeURIComponent(c.req.path + (new URL(c.req.url).search || ""));
      return c.redirect(`/auth/login?next=${next}`, 303);
    }
    return publicPage(c, {
      title: error.status === 403 ? "ไม่มีสิทธิ์เข้าถึง" : "เกิดข้อผิดพลาด",
      body: errorPage(
        error.status === 403 ? "ไม่มีสิทธิ์เข้าถึง" : error.status === 429 ? "ทำรายการบ่อยเกินไป" : "เกิดข้อผิดพลาด",
        error.message,
      ),
      status: error.status,
      noIndex: true,
    });
  }

  logError("unhandled_error", error, { requestId, path: c.req.path, method: c.req.method });
  if (c.req.path.startsWith("/api/")) {
    return jsonResponse({ error: { code: "internal_error", message: "internal server error", request_id: requestId } }, 500);
  }
  return publicPage(c, {
    title: "เกิดข้อผิดพลาด",
    body: errorPage(
      "เกิดข้อผิดพลาดภายในระบบ",
      isProduction(c.env) ? "ทีมงานได้รับบันทึกเหตุการณ์แล้ว กรุณาลองใหม่ภายหลัง" : error instanceof Error ? error.message : "unknown error",
    ),
    status: 500,
    noIndex: true,
  });
});

export default app;
