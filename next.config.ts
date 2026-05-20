import type { NextConfig } from "next";
import type { Configuration } from "webpack";

const nextConfig: NextConfig = {
  // gbrain ships raw .ts + WASM deps (@electric-sql/pglite, tree-sitter-wasms,
  // web-tree-sitter); load from node_modules at runtime, do not bundle into the
  // serverless function. withSentryConfig wraps this in 04-02.
  serverExternalPackages: ["gbrain"],

  webpack(config: Configuration, { isServer }: { isServer: boolean }) {
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

export default nextConfig;
