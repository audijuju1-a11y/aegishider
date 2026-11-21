import { applyD1Migrations, env } from "cloudflare:test";

// Applies all D1 migrations to the isolated test database before the suite runs.
// See https://developers.cloudflare.com/workers/testing/vitest-integration/test-apis/
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
