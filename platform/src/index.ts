import app from "./app";
import { handleQueue } from "./queue";
import { handleScheduled } from "./scheduled";
import type { Env } from "./env";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
  queue: handleQueue,
  scheduled: handleScheduled,
} satisfies ExportedHandler<Env>;
