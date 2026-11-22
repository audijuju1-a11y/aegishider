import type { Env } from "../env";
import { getSetting, setSetting } from "../services/audit";

export interface SiteContent {
  announcement: string;
  heroEyebrow: string;
  heroTitle: string;
  heroTitleAccent: string;
  heroLead: string;
  primaryCta: string;
  secondaryCta: string;
  supportEmail: string;
  pricingNote: string;
}

export const DEFAULT_SITE_CONTENT: SiteContent = {
  announcement: "อัปเดต Aegishider 4.0.4 — ซ่อนบล็อกฐานครบชุด + Y-shield ปิดห้องใต้ดิน + ตรวจกำแพงมอน/สัตว์",
  heroEyebrow: "AEGISHIDER CONTROL PLATFORM",
  heroTitle: "ปลั๊กอิน Minecraft",
  heroTitleAccent: "ฟรี พร้อมไลเซนส์จริง",
  heroLead:
    "Aegishider Control Platform รวมหน้าร้าน พอร์ทัลเจ้าของเซิร์ฟเวอร์ และคอนโซลผู้ดูแลไว้ในระบบเดียว — ฟรี 100% ไม่มีกระเป๋าเงินหรือการชำระเงิน ใบอนุญาตลงลายเซ็น Ed25519 ตรวจสอบได้ทุกใบ",
  primaryCta: "ดูผลิตภัณฑ์",
  secondaryCta: "เริ่มต้นใช้งาน",
  supportEmail: "audijuju1@gmail.com",
  pricingNote: "ทุกฟีเจอร์ฟรี · ไม่มีระบบชำระเงิน · ไม่มีวันหมดอายุ",
};

export async function getSiteContent(env: Env): Promise<SiteContent> {
  const raw = await getSetting(env, "site.content");
  if (!raw) return DEFAULT_SITE_CONTENT;
  try {
    const parsed = JSON.parse(raw) as Partial<SiteContent>;
    return {
      ...DEFAULT_SITE_CONTENT,
      ...Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === "string"),
      ),
    } as SiteContent;
  } catch {
    return DEFAULT_SITE_CONTENT;
  }
}

export async function saveSiteContent(env: Env, content: SiteContent): Promise<void> {
  await setSetting(env, "site.content", JSON.stringify(content));
}
