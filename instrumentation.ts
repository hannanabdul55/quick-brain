import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captures unhandled errors re-thrown by Route Handlers and Server Components.
// Route Handlers (e.g. app/api/tenants/route.ts) re-throw unexpected errors so
// this boundary can catch them. Requires @sentry/nextjs >= 8.28.0 + Next.js 15.
export const onRequestError = Sentry.captureRequestError;
