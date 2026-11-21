import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

export default defineConfig(async () => {
  const migrations = await readD1Migrations({
    projectPath: __dirname,
    migrationsDir: path.join(__dirname, "migrations"),
  });

  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: "test",
            APP_URL: "http://localhost:8787",
            APP_NAME: "Aegishider Control Platform",
            SESSION_TTL_DAYS: "14",
            LEASE_TTL_HOURS: "24",
            OFFLINE_GRACE_HOURS: "72",
            TURNSTILE_SITE_KEY: "",
            ACCESS_TEAM_DOMAIN: "",
            ACCESS_AUD: "",
            EMAIL_PROVIDER: "console",
            MAIL_FROM: "Aegishider <noreply@test.local>",
            SUPPORT_EMAIL: "support@test.local",
            ADMIN_EMAILS: "admin@test.local",
            LICENSE_KEY_PEPPER: "test-pepper-not-for-production",
            LICENSE_SIGNING_KEY: "MC4CAQAwBQYDK2VwBCIEIEh0T+q6inqMVgFJoIdlz0gZ/7D1JPJ7oeKDcqlq3Uy1",
            LICENSE_SIGNING_KEY_ID: "test-key-1",
            LICENSE_PUBLIC_KEY: "MCowBQYDK2VwAyEAOUOwXRcfWXksyLbgJX8WDVtRBWnlxqIt8AIZinTgNRw=",
            PAYMENT_WEBHOOK_SECRET: "test-webhook-secret",
            BANK_WEBHOOK_SECRET: "test-bank-secret",
            PROMPTPAY_PHONE: "0925789459",
            PROMPTPAY_NAME: "Aegishider",
            EMAIL_OTP_TTL_MINUTES: "10",
            STRIPE_WEBHOOK_SECRET: "test-stripe-webhook-secret",
            STRIPE_SECRET_KEY: "sk_test_dummy",
          },
        },
      }),
    ],
    test: {
      include: ["tests/**/*.test.ts"],
      setupFiles: ["./tests/setup.ts"],
      testTimeout: 20_000,
    },
  };
});
