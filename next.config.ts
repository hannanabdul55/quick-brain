import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // gbrain ships raw .ts + WASM deps (@electric-sql/pglite, tree-sitter-wasms,
  // web-tree-sitter); load from node_modules at runtime, do not bundle into the
  // serverless function. withSentryConfig wraps this in 04-02.
  serverExternalPackages: ["gbrain"],
};

export default nextConfig;
