import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Sample 10% of transactions for performance monitoring. Adjust in production.
  tracesSampleRate: 0.1,

  // beforeSend is the scrubbing point for secrets and PII (Security Domain V7, T-04-05).
  // Do NOT attach process.env, chat question text, or other sensitive context.
  // Currently a pass-through — add field-level scrubbing here if needed.
  beforeSend(event) {
    return event;
  },
});
