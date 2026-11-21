import type { Env } from "../env";
import { all, first, run } from "../lib/db";
import { newId } from "../lib/core";
import { now, jsonArray, jsonObject } from "../lib/time";
import { conflict, notFound } from "../lib/errors";

export interface ProductRow {
  id: string;
  slug: string;
  name: string;
  name_en: string | null;
  tagline: string;
  tagline_en: string | null;
  description: string;
  category: string;
  status: string;
  featured: number;
  logo_url: string | null;
  hero_image_url: string | null;
  gallery: string;
  price_cents: number;
  currency: string;
  purchase_url: string | null;
  docs_url: string | null;
  compatibility: string;
  features: string;
  seo_title: string | null;
  seo_description: string | null;
  created_at: number;
  updated_at: number;
  published_at: number | null;
}

export interface PlanRow {
  id: string;
  product_id: string;
  code: string;
  name: string;
  price_cents: number;
  currency: string;
  billing_interval: string;
  entitlements: string;
  activation_limit: number;
  active: number;
  created_at: number;
  updated_at: number;
}

export interface ReleaseRow {
  id: string;
  product_id: string;
  version: string;
  channel: string;
  status: string;
  notes: string;
  supported_minecraft: string;
  supported_java: string;
  supported_platforms: string;
  artifact_url: string | null;
  artifact_sha256: string | null;
  signing_key_id: string | null;
  artifact_signature: string | null;
  released_at: number;
  created_at: number;
}

export interface ProductFeature {
  title: string;
  description: string;
}

export interface ProductView extends ProductRow {
  plans: PlanRow[];
  releases: ReleaseRow[];
  latestRelease: ReleaseRow | null;
  featuresList: ProductFeature[];
  compatibilityData: Record<string, unknown>;
  galleryList: string[];
}

export interface ProductListOptions {
  statuses?: string[];
  query?: string;
  category?: string;
  featuredOnly?: boolean;
  limit?: number;
}

function toProductView(
  row: ProductRow,
  plans: PlanRow[],
  releases: ReleaseRow[],
): ProductView {
  return {
    ...row,
    plans,
    releases,
    latestRelease: releases[0] ?? null,
    featuresList: jsonArray<ProductFeature>(row.features),
    compatibilityData: jsonObject(row.compatibility),
    galleryList: jsonArray<string>(row.gallery),
  };
}

export async function listProducts(env: Env, options: ProductListOptions = {}): Promise<ProductRow[]> {
  const statuses = options.statuses ?? ["published"];
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (statuses.length > 0) {
    conditions.push(`status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }
  if (options.query) {
    conditions.push(`(name LIKE ? ESCAPE '\\' OR tagline LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')`);
    const like = `%${options.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like, like);
  }
  if (options.category) {
    conditions.push(`category = ?`);
    params.push(options.category);
  }
  if (options.featuredOnly) conditions.push("featured = 1");
  params.push(Math.min(options.limit ?? 50, 100));
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return all<ProductRow>(
    env.DB,
    `SELECT * FROM products ${where} ORDER BY featured DESC, COALESCE(published_at, created_at) DESC LIMIT ?`,
    ...params,
  );
}

export async function getProductBySlug(
  env: Env,
  slug: string,
  options: { includeUnpublished?: boolean } = {},
): Promise<ProductRow | null> {
  if (options.includeUnpublished) {
    return first<ProductRow>(env.DB, `SELECT * FROM products WHERE slug = ?`, slug);
  }
  return first<ProductRow>(
    env.DB,
    `SELECT * FROM products WHERE slug = ? AND status IN ('published','coming_soon')`,
    slug,
  );
}

export async function getProductById(env: Env, id: string): Promise<ProductRow | null> {
  return first<ProductRow>(env.DB, `SELECT * FROM products WHERE id = ?`, id);
}

export async function getProductPlans(
  env: Env,
  productId: string,
  includeInactive = false,
): Promise<PlanRow[]> {
  return all<PlanRow>(
    env.DB,
    `SELECT * FROM product_plans WHERE product_id = ? ${includeInactive ? "" : "AND active = 1"}
      ORDER BY price_cents ASC, created_at ASC`,
    productId,
  );
}

export async function getPlanById(env: Env, id: string): Promise<PlanRow | null> {
  return first<PlanRow>(env.DB, `SELECT * FROM product_plans WHERE id = ?`, id);
}

export async function getProductReleases(
  env: Env,
  productId: string,
  options: { limit?: number; includeDrafts?: boolean } = {},
): Promise<ReleaseRow[]> {
  const condition = options.includeDrafts ? "" : "AND status = 'published'";
  return all<ReleaseRow>(
    env.DB,
    `SELECT * FROM product_releases WHERE product_id = ? ${condition}
      ORDER BY released_at DESC, created_at DESC LIMIT ?`,
    productId,
    Math.min(options.limit ?? 20, 100),
  );
}

export async function getLatestRelease(env: Env, productId: string): Promise<ReleaseRow | null> {
  return first<ReleaseRow>(
    env.DB,
    `SELECT * FROM product_releases WHERE product_id = ? AND status = 'published'
      ORDER BY released_at DESC, created_at DESC LIMIT 1`,
    productId,
  );
}

export async function getProductView(
  env: Env,
  slug: string,
  options: { includeUnpublished?: boolean } = {},
): Promise<ProductView | null> {
  const product = await getProductBySlug(env, slug, options);
  if (!product) return null;
  const [plans, releases] = await Promise.all([
    getProductPlans(env, product.id, Boolean(options.includeUnpublished)),
    getProductReleases(env, product.id, { includeDrafts: Boolean(options.includeUnpublished) }),
  ]);
  return toProductView(product, plans, releases);
}

export async function listProductSummaries(
  env: Env,
  options: ProductListOptions = {},
): Promise<ProductView[]> {
  const products = await listProducts(env, options);
  if (products.length === 0) return [];
  const plans = await all<PlanRow>(
    env.DB,
    `SELECT * FROM product_plans WHERE active = 1 AND product_id IN (${products.map(() => "?").join(",")})
      ORDER BY price_cents ASC`,
    ...products.map((product) => product.id),
  );
  const releases = await all<ReleaseRow>(
    env.DB,
    `SELECT * FROM product_releases WHERE status = 'published' AND product_id IN (${products.map(() => "?").join(",")})
      ORDER BY released_at DESC`,
    ...products.map((product) => product.id),
  );
  return products.map((product) =>
    toProductView(
      product,
      plans.filter((plan) => plan.product_id === product.id),
      releases.filter((release) => release.product_id === product.id),
    ),
  );
}

export interface ProductInput {
  slug: string;
  name: string;
  nameEn?: string | null;
  tagline: string;
  taglineEn?: string | null;
  description: string;
  category: string;
  status: string;
  featured: boolean;
  priceCents: number;
  currency: string;
  docsUrl?: string | null;
  purchaseUrl?: string | null;
  logoUrl?: string | null;
  heroImageUrl?: string | null;
  compatibility: string;
  features: string;
  seoTitle?: string | null;
  seoDescription?: string | null;
  actorId: string | null;
}

export async function createProduct(env: Env, input: ProductInput): Promise<string> {
  const existing = await getProductBySlug(env, input.slug, { includeUnpublished: true });
  if (existing) throw conflict("slug นี้ถูกใช้แล้ว");
  const id = newId("prod");
  const timestamp = now();
  await run(
    env.DB,
    `INSERT INTO products (
      id, slug, name, name_en, tagline, tagline_en, description, category, status, featured,
      logo_url, hero_image_url, price_cents, currency, purchase_url, docs_url,
      compatibility, features, seo_title, seo_description, created_by, created_at, updated_at, published_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.slug,
    input.name,
    input.nameEn ?? null,
    input.tagline,
    input.taglineEn ?? null,
    input.description,
    input.category,
    input.status,
    input.featured ? 1 : 0,
    input.logoUrl ?? null,
    input.heroImageUrl ?? null,
    input.priceCents,
    input.currency,
    input.purchaseUrl ?? null,
    input.docsUrl ?? null,
    input.compatibility,
    input.features,
    input.seoTitle ?? null,
    input.seoDescription ?? null,
    input.actorId,
    timestamp,
    timestamp,
    input.status === "published" ? timestamp : null,
  );
  return id;
}

export async function updateProduct(
  env: Env,
  id: string,
  input: ProductInput,
): Promise<void> {
  const existing = await getProductById(env, id);
  if (!existing) throw notFound("ไม่พบผลิตภัณฑ์");
  const clash = await getProductBySlug(env, input.slug, { includeUnpublished: true });
  if (clash && clash.id !== id) throw conflict("slug นี้ถูกใช้แล้ว");
  const timestamp = now();
  const publish = input.status === "published" && existing.status !== "published";
  await run(
    env.DB,
    `UPDATE products SET
      slug = ?, name = ?, name_en = ?, tagline = ?, tagline_en = ?, description = ?,
      category = ?, status = ?, featured = ?, logo_url = ?, hero_image_url = ?,
      price_cents = ?, currency = ?, purchase_url = ?, docs_url = ?,
      compatibility = ?, features = ?, seo_title = ?, seo_description = ?,
      updated_at = ?, published_at = CASE WHEN ? THEN COALESCE(published_at, ?) ELSE published_at END
     WHERE id = ?`,
    input.slug,
    input.name,
    input.nameEn ?? null,
    input.tagline,
    input.taglineEn ?? null,
    input.description,
    input.category,
    input.status,
    input.featured ? 1 : 0,
    input.logoUrl ?? null,
    input.heroImageUrl ?? null,
    input.priceCents,
    input.currency,
    input.purchaseUrl ?? null,
    input.docsUrl ?? null,
    input.compatibility,
    input.features,
    input.seoTitle ?? null,
    input.seoDescription ?? null,
    timestamp,
    publish ? 1 : 0,
    timestamp,
    id,
  );
}

export async function setProductStatus(env: Env, id: string, status: string): Promise<void> {
  const timestamp = now();
  await run(
    env.DB,
    `UPDATE products SET status = ?, updated_at = ?,
       published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, ?) ELSE published_at END
     WHERE id = ?`,
    status,
    timestamp,
    status,
    timestamp,
    id,
  );
}

export interface PlanInput {
  code: string;
  name: string;
  priceCents: number;
  currency: string;
  billingInterval: string;
  entitlements: string;
  activationLimit: number;
  active: boolean;
}

export async function createPlan(env: Env, productId: string, input: PlanInput): Promise<string> {
  const id = newId("plan");
  const timestamp = now();
  await run(
    env.DB,
    `INSERT INTO product_plans (id, product_id, code, name, price_cents, currency, billing_interval, entitlements, activation_limit, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    productId,
    input.code,
    input.name,
    input.priceCents,
    input.currency,
    input.billingInterval,
    input.entitlements,
    Math.max(1, Math.min(1000, Math.trunc(input.activationLimit))),
    input.active ? 1 : 0,
    timestamp,
    timestamp,
  );
  return id;
}

export async function updatePlan(env: Env, planId: string, input: PlanInput): Promise<void> {
  await run(
    env.DB,
    `UPDATE product_plans SET code = ?, name = ?, price_cents = ?, currency = ?,
       billing_interval = ?, entitlements = ?, activation_limit = ?, active = ?, updated_at = ?
     WHERE id = ?`,
    input.code,
    input.name,
    input.priceCents,
    input.currency,
    input.billingInterval,
    input.entitlements,
    Math.max(1, Math.min(1000, Math.trunc(input.activationLimit))),
    input.active ? 1 : 0,
    now(),
    planId,
  );
}

export interface ReleaseInput {
  productId: string;
  version: string;
  channel: string;
  status: string;
  notes: string;
  supportedMinecraft: string;
  supportedJava: string;
  supportedPlatforms: string;
  artifactUrl: string | null;
  artifactSha256: string | null;
}

export async function createRelease(env: Env, input: ReleaseInput): Promise<string> {
  const id = newId("rel");
  const timestamp = now();
  await run(
    env.DB,
    `INSERT INTO product_releases (
      id, product_id, version, channel, status, notes, supported_minecraft, supported_java,
      supported_platforms, artifact_url, artifact_sha256, released_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.productId,
    input.version,
    input.channel,
    input.status,
    input.notes,
    input.supportedMinecraft,
    input.supportedJava,
    input.supportedPlatforms,
    input.artifactUrl,
    input.artifactSha256,
    timestamp,
    timestamp,
  );
  return id;
}

export async function listAllReleases(env: Env, limit = 100): Promise<Array<ReleaseRow & { product_name: string; product_slug: string }>> {
  return all<ReleaseRow & { product_name: string; product_slug: string }>(
    env.DB,
    `SELECT r.*, p.name AS product_name, p.slug AS product_slug
       FROM product_releases r JOIN products p ON p.id = r.product_id
      ORDER BY r.released_at DESC LIMIT ?`,
    limit,
  );
}

export function formatPrice(priceCents: number, currency = "THB"): string {
  if (priceCents <= 0) return "ฟรี";
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(priceCents / 100);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0e00-\u0e7f]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
