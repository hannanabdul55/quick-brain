import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // gbrain ships raw .ts + WASM deps (@electric-sql/pglite, tree-sitter-wasms,
  // web-tree-sitter); load from node_modules at runtime, do not bundle into the
  // serverless function. (debug resolution: gbrain-next-build-prod.md)
  serverExternalPackages: ["gbrain"],

  // Type the webpack fn using Parameters/ReturnType rather than importing
  // webpack directly — webpack is not an installed package in this repo.
  // The original stale webpack type import was removed to fix tsc errors.
  // gbrainExternalsFn MUST be preserved — it prevents webpack
  // from parsing gbrain/* imports that bypass serverExternalPackages
  // (see debug resolution: gbrain-next-build-prod.md, fix part 4).
  webpack(
    ...args: Parameters<NonNullable<NextConfig["webpack"]>>
  ): ReturnType<NonNullable<NextConfig["webpack"]>> {
    const [config, { isServer }] = args;
    if (isServer) {
      const existingExternals = config.externals;
      config.externals = [
        ...(Array.isArray(existingExternals) ? existingExternals : existingExternals ? [existingExternals] : []),
        function gbrainExternalsFn(
          data: { request?: string; context?: string },
          callback: (err: null | Error, result?: string) => void,
        ) {
          const { request } = data;
          if (request && (request === "gbrain" || request.startsWith("gbrain/"))) {
            return callback(null, `commonjs ${request}`);
          }
          callback(null);
        },
      ];
    }
    return config;
  },
};

// withSentryConfig uploads source maps during next build.
// authToken (SENTRY_AUTH_TOKEN) is build-time only — NEVER use NEXT_PUBLIC_ prefix
// (Security Domain T-04-06). Only NEXT_PUBLIC_SENTRY_DSN is client-safe.
// withSentryConfig is a pass-through wrapper: serverExternalPackages and
// gbrainExternalsFn survive the wrap unchanged (T-04-07).
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
});
