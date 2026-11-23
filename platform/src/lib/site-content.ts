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
  pricingNote: string;
}

export const DEFAULT_SITE_CONTENT: SiteContent = {
  announcement: "อัปเดต 4.0.5 — ปรับ tick ให้มีขอบเขต, Y-shield และชุดบล็อกฐานครบชุด",
  heroEyebrow: "AEGISHIDER CONTROL PLATFORM",
  heroTitle: "ป้องกันฐาน Minecraft",
  heroTitleAccent: "ในระดับแพ็กเก็ต",
  heroLead:
    "Aegishider ซ่อนหีบ บล็อกฐาน และห้องใต้ดินก่อนข้อมูลจะถูกส่งถึงไคลเอนต์ พร้อมไลเซนส์ Ed25519 และระบบปฏิบัติการที่ตรวจสอบได้ — ฟรีสำหรับทุกเซิร์ฟเวอร์ Paper",
  primaryCta: "ดูผลิตภัณฑ์",
  secondaryCta: "อ่านเอกสาร",
  pricingNote: "ทุกฟีเจอร์ฟรี · ไม่มีระบบชำระเงิน · ไลเซนส์ไม่มีวันหมดอายุ",
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
