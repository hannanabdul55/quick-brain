import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Runtime deps that the Vercel file tracer cannot discover via static analysis
// (gbrain uses webpackIgnore + computed dynamic imports). Listed once; applied
// to every route-handler glob that imports gbrain.
const GBRAIN_RUNTIME_DEPS = [
  "node_modules/gbrain/**",
  "node_modules/postgres/**",
  "node_modules/@electric-sql/pglite/**",
  "node_modules/tree-sitter-wasms/**",
  "node_modules/web-tree-sitter/**",
];

const nextConfig: NextConfig = {
  // gbrain ships raw .ts + WASM deps (@electric-sql/pglite, tree-sitter-wasms,
  // web-tree-sitter); load from node_modules at runtime, do not bundle into the
  // serverless function. (debug resolution: gbrain-next-build-prod.md)
  serverExternalPackages: ["gbrain"],

  // Force-include gbrain and its WASM/native deps in the Vercel serverless
  // function bundle. Vercel's file tracer does static import analysis, but
  // gbrain is loaded via /* webpackIgnore: true */ dynamic imports with computed
  // specifiers ("gbrain/" + subpath) and a process.cwd()-constructed file://
  // path (_loadThink). The tracer cannot follow either form statically, so
  // node_modules/gbrain/** and the WASM deps would be silently excluded from
  // the function bundle — working locally but MODULE_NOT_FOUND on Vercel.
  // These globs force the tracer to include them regardless.
  //
  // Globs cover every route handler that touches gbrain:
  // - app/api/**/route.ts        — tenants/* + future API routes (Phase 3/4)
  // - app/auth/**/route.ts       — verify route provisions a per-user gbrain
  //                                 source on first sign-in (Phase 6)
  // All four WASM-dep packages are verified at top-level node_modules/ (not
  // nested under node_modules/gbrain/node_modules/) as of 2026-05-20.
  outputFileTracingIncludes: {
    "app/api/**/route.ts": GBRAIN_RUNTIME_DEPS,
    "app/auth/**/route.ts": GBRAIN_RUNTIME_DEPS,
  },

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
