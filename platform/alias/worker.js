/**
 * Canonical-host proxy for aegishider-platform.
 *
 * The application and its secrets live on `basehider-platform`. This Worker forwards
 * every request through a service binding instead of redirecting: the plugin's HTTP
 * client uses `HttpClient.Redirect.NEVER`, so a 302 would break activation, leases and
 * heartbeats. A service binding keeps the canonical URL, Origin and cookies intact.
 *
 * Deliberately has no cron triggers, queues, D1 or KV bindings. Deploying this config
 * also clears the triggers that a failed full-app deploy left on this worker.
 */
export default {
  async fetch(request, env) {
    const response = await env.APP.fetch(request);

    // fetch() can fold multiple Set-Cookie headers; rebuild them one by one so the
    // browser receives both the session and CSRF cookies intact.
    const headers = new Headers(response.headers);
    const cookies = typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [];
    if (cookies.length > 0) {
      headers.delete("set-cookie");
      for (const cookie of cookies) headers.append("set-cookie", cookie);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
