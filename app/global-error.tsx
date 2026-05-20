"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// global-error.tsx replaces the root layout when a React render crash escapes
// all page/layout boundaries. It must emit its own <html><body> shell.
// Never render error.message to the user — surface a generic safe message only.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ padding: "2rem", fontFamily: "sans-serif" }}>
          <h2>Something went wrong.</h2>
          <p>We&apos;ve been notified and will look into it.</p>
        </div>
      </body>
    </html>
  );
}
