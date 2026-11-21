-- 0003 — Stripe PromptPay provider fields for top-up orders.
-- Local PromptPay QR remains the default; Stripe is opt-in via PAYMENT_PROVIDER=stripe.

ALTER TABLE topup_orders ADD COLUMN provider TEXT NOT NULL DEFAULT 'local';
ALTER TABLE topup_orders ADD COLUMN provider_payment_id TEXT;
ALTER TABLE topup_orders ADD COLUMN provider_qr_url TEXT;
ALTER TABLE topup_orders ADD COLUMN provider_status TEXT;

CREATE INDEX IF NOT EXISTS idx_topup_provider_payment ON topup_orders(provider, provider_payment_id);
