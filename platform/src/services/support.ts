import type { Env } from "../env";
import { all, first, run } from "../lib/db";
import { newId } from "../lib/core";
import { now } from "../lib/time";
import { badRequest, forbidden, notFound } from "../lib/errors";
import { primaryMembership, type SessionUser } from "../auth/session";
import { notifyUser, recordSecurityEvent } from "./audit";

export interface TicketRow {
  id: string;
  org_id: string;
  user_id: string;
  product_id: string | null;
  subject: string;
  status: "open" | "pending" | "resolved" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  created_at: number;
  updated_at: number;
  closed_at: number | null;
}

export interface TicketView extends TicketRow {
  product_name: string | null;
  customer_email: string;
  customer_name: string | null;
  message_count: number;
  last_message_at: number | null;
}

export interface TicketMessageRow {
  id: string;
  ticket_id: string;
  author_user_id: string | null;
  author_role: "customer" | "staff" | "system";
  body: string;
  internal: number;
  created_at: number;
}

const TICKET_SELECT = `
  SELECT t.*, p.name AS product_name, u.email AS customer_email, u.display_name AS customer_name,
         (SELECT COUNT(*) FROM support_messages m WHERE m.ticket_id = t.id AND m.internal = 0) AS message_count,
         (SELECT MAX(m.created_at) FROM support_messages m WHERE m.ticket_id = t.id) AS last_message_at
    FROM support_tickets t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN products p ON p.id = t.product_id`;

export async function createTicket(
  env: Env,
  user: SessionUser,
  input: { subject: string; message: string; productId?: string | null; priority?: string },
): Promise<string> {
  const membership = primaryMembership(user);
  if (!membership) throw forbidden("บัญชีของคุณยังไม่มีองค์กร");
  if (membership.role === "read_only") throw forbidden("บัญชีของคุณเป็นแบบอ่านอย่างเดียว");
  const subject = input.subject.trim().slice(0, 200);
  const body = input.message.trim().slice(0, 5000);
  if (subject.length < 3) throw badRequest("หัวข้อสั้นเกินไป");
  if (body.length < 5) throw badRequest("ข้อความสั้นเกินไป");
  if (input.productId) {
    const product = await first<{ id: string }>(env.DB, `SELECT id FROM products WHERE id = ?`, input.productId);
    if (!product) throw badRequest("ไม่พบผลิตภัณฑ์");
  }
  const ticketId = newId("tkt");
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO support_tickets (id, org_id, user_id, product_id, subject, status, priority, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    ).bind(
      ticketId,
      membership.orgId,
      user.id,
      input.productId ?? null,
      subject,
      input.priority === "high" || input.priority === "urgent" ? input.priority : "normal",
      timestamp,
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO support_messages (id, ticket_id, author_user_id, author_role, body, internal, created_at)
       VALUES (?, ?, ?, 'customer', ?, 0, ?)`,
    ).bind(newId("msg"), ticketId, user.id, body, timestamp),
  ]);
  await notifyUser(env, {
    userId: user.id,
    orgId: membership.orgId,
    type: "support.created",
    title: "เปิดตั๋วช่วยเหลือแล้ว",
    body: subject,
  });
  return ticketId;
}

export async function listTicketsForUser(env: Env, userId: string): Promise<TicketView[]> {
  return all<TicketView>(
    env.DB,
    `${TICKET_SELECT}
      WHERE t.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ?)
      ORDER BY t.updated_at DESC LIMIT 100`,
    userId,
  );
}

export async function getTicketForUser(
  env: Env,
  userId: string,
  ticketId: string,
): Promise<{ ticket: TicketView; messages: TicketMessageRow[] } | null> {
  const ticket = await first<TicketView>(
    env.DB,
    `${TICKET_SELECT}
      WHERE t.id = ? AND t.org_id IN (SELECT org_id FROM organization_members WHERE user_id = ?)`,
    ticketId,
    userId,
  );
  if (!ticket) return null;
  const messages = await all<TicketMessageRow>(
    env.DB,
    `SELECT * FROM support_messages WHERE ticket_id = ? AND internal = 0 ORDER BY created_at ASC`,
    ticketId,
  );
  return { ticket, messages };
}

export async function addCustomerMessage(
  env: Env,
  user: SessionUser,
  ticketId: string,
  body: string,
): Promise<void> {
  const ticket = await first<{ id: string; status: string; org_id: string }>(
    env.DB,
    `SELECT id, status, org_id FROM support_tickets
      WHERE id = ? AND org_id IN (SELECT org_id FROM organization_members WHERE user_id = ?)`,
    ticketId,
    user.id,
  );
  if (!ticket) throw notFound("ไม่พบตั๋วนี้");
  if (ticket.status === "closed") throw badRequest("ตั๋วนี้ปิดแล้ว");
  const text = body.trim().slice(0, 5000);
  if (text.length < 2) throw badRequest("ข้อความสั้นเกินไป");
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO support_messages (id, ticket_id, author_user_id, author_role, body, internal, created_at)
       VALUES (?, ?, ?, 'customer', ?, 0, ?)`,
    ).bind(newId("msg"), ticketId, user.id, text, timestamp),
    env.DB.prepare(
      `UPDATE support_tickets SET status = 'open', updated_at = ? WHERE id = ?`,
    ).bind(timestamp, ticketId),
  ]);
}

/* -------------------------------------------------------------------------- */
/* Admin                                                                      */
/* -------------------------------------------------------------------------- */

export async function listTicketsAdmin(
  env: Env,
  options: { status?: string; limit?: number; offset?: number } = {},
): Promise<TicketView[]> {
  const params: Array<string | number> = [];
  let where = "";
  if (options.status) {
    where = "WHERE t.status = ?";
    params.push(options.status);
  }
  params.push(Math.min(options.limit ?? 50, 200), options.offset ?? 0);
  return all<TicketView>(
    env.DB,
    `${TICKET_SELECT} ${where} ORDER BY
       CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       t.updated_at DESC LIMIT ? OFFSET ?`,
    ...params,
  );
}

export async function getTicketAdmin(
  env: Env,
  ticketId: string,
): Promise<{ ticket: TicketView; messages: TicketMessageRow[] } | null> {
  const ticket = await first<TicketView>(env.DB, `${TICKET_SELECT} WHERE t.id = ?`, ticketId);
  if (!ticket) return null;
  const messages = await all<TicketMessageRow>(
    env.DB,
    `SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY created_at ASC`,
    ticketId,
  );
  return { ticket, messages };
}

export async function addStaffMessage(
  env: Env,
  actor: { id: string; email: string },
  ticketId: string,
  body: string,
  internal: boolean,
): Promise<void> {
  const ticket = await first<{ id: string; status: string }>(
    env.DB,
    `SELECT id, status FROM support_tickets WHERE id = ?`,
    ticketId,
  );
  if (!ticket) throw notFound("ไม่พบตั๋วนี้");
  const text = body.trim().slice(0, 5000);
  if (text.length < 2) throw badRequest("ข้อความสั้นเกินไป");
  const timestamp = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO support_messages (id, ticket_id, author_user_id, author_role, body, internal, created_at)
       VALUES (?, ?, ?, 'staff', ?, ?, ?)`,
    ).bind(newId("msg"), ticketId, actor.id, text, internal ? 1 : 0, timestamp),
    env.DB.prepare(
      `UPDATE support_tickets SET status = CASE WHEN status = 'open' THEN 'pending' ELSE status END, updated_at = ?
        WHERE id = ?`,
    ).bind(timestamp, ticketId),
  ]);
}

export async function setTicketStatus(env: Env, ticketId: string, status: string): Promise<void> {
  if (!["open", "pending", "resolved", "closed"].includes(status)) throw badRequest("สถานะไม่ถูกต้อง");
  const timestamp = now();
  await run(
    env.DB,
    `UPDATE support_tickets SET status = ?, updated_at = ?, closed_at = CASE WHEN ? = 'closed' THEN ? ELSE closed_at END
      WHERE id = ?`,
    status,
    timestamp,
    status,
    timestamp,
    ticketId,
  );
}

/* -------------------------------------------------------------------------- */
/* Public contact                                                             */
/* -------------------------------------------------------------------------- */

export async function createContactMessage(
  env: Env,
  input: { name: string; email: string; topic: string; message: string; ipHash: string | null },
): Promise<void> {
  const name = input.name.trim().slice(0, 120);
  const email = input.email.trim().toLowerCase().slice(0, 200);
  const message = input.message.trim().slice(0, 5000);
  if (name.length < 2) throw badRequest("กรุณากรอกชื่อ");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("อีเมลไม่ถูกต้อง");
  if (message.length < 10) throw badRequest("ข้อความสั้นเกินไป");
  await run(
    env.DB,
    `INSERT INTO contact_messages (id, name, email, topic, message, status, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, 'new', ?, ?)`,
    newId("ctc"),
    name,
    email,
    input.topic.slice(0, 80) || "general",
    message,
    input.ipHash,
    now(),
  );
  await recordSecurityEvent(env, {
    eventType: "contact.received",
    severity: "info",
    ipHash: input.ipHash,
    details: { topic: input.topic.slice(0, 80) },
  });
}
