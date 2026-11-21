/** Typed application errors. Unexpected errors never leak details to clients. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly headers?: Record<string, string>;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: unknown; headers?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.headers = options.headers;
  }
}

export function badRequest(message: string, details?: unknown): AppError {
  return new AppError(400, "invalid_request", message, { details });
}

export function unauthorized(message = "ต้องเข้าสู่ระบบก่อน"): AppError {
  return new AppError(401, "unauthorized", message);
}

export function forbidden(message = "คุณไม่มีสิทธิ์เข้าถึงข้อมูลนี้"): AppError {
  return new AppError(403, "forbidden", message);
}

export function notFound(message = "ไม่พบข้อมูลที่ต้องการ"): AppError {
  return new AppError(404, "not_found", message);
}

export function conflict(message: string): AppError {
  return new AppError(409, "conflict", message);
}

export function gone(message = "ลิงก์นี้หมดอายุแล้ว"): AppError {
  return new AppError(410, "gone", message);
}

export function tooMany(message = "ทำรายการบ่อยเกินไป กรุณารอสักครู่"): AppError {
  return new AppError(429, "rate_limited", message, {
    headers: { "Retry-After": "60" },
  });
}

export function unavailable(message = "บริการนี้ยังไม่พร้อมใช้งาน"): AppError {
  return new AppError(503, "unavailable", message);
}

export function configError(message: string): AppError {
  return new AppError(503, "configuration_error", message);
}
