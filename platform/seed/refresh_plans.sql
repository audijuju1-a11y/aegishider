-- Aegishider monthly licence plans: Lite 30 THB (1 concurrent server), Pro 60 THB (5 concurrent servers).
-- Both plans are monthly and can be activated on up to the plan limit; sharing the licence across
-- those server slots is allowed. Existing Standard plans are deactivated, not deleted.
UPDATE product_plans SET active = 0, updated_at = (strftime('%s','now') * 1000)
WHERE product_id = 'prod_aegishider' AND code NOT IN ('lite', 'pro');

INSERT INTO product_plans (
  id, product_id, code, name, price_cents, currency, billing_interval, entitlements,
  activation_limit, active, created_at, updated_at
) VALUES
  ('plan_bh_lite', 'prod_aegishider', 'lite', 'Lite', 3000, 'THB', 'monthly',
   '["aegishider:block-protection","aegishider:item-shield","aegishider:diagnostics"]', 1, 1,
   (strftime('%s','now') * 1000), (strftime('%s','now') * 1000)),
  ('plan_bh_pro', 'prod_aegishider', 'pro', 'Pro', 6000, 'THB', 'monthly',
   '["aegishider:block-protection","aegishider:item-shield","aegishider:diagnostics"]', 5, 1,
   (strftime('%s','now') * 1000), (strftime('%s','now') * 1000))
ON CONFLICT(id) DO UPDATE SET
  code = excluded.code,
  name = excluded.name,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  billing_interval = excluded.billing_interval,
  entitlements = excluded.entitlements,
  activation_limit = excluded.activation_limit,
  active = 1,
  updated_at = excluded.updated_at;

UPDATE products SET updated_at = (strftime('%s','now') * 1000) WHERE id = 'prod_aegishider';
