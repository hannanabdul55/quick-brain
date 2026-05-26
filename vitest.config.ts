import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

// Match the rest of the toolchain (tsconfig paths / Next): resolve @/* to the
// repo root. With Vitest `projects`, the root resolve.alias is NOT inherited —
// each project needs its own, so the alias is defined once and applied to both.
let rootDir = fileURLToPath(new URL(".", import.meta.url));
if (rootDir.endsWith("/")) rootDir = rootDir.slice(0, -1);

const alias = { "@": rootDir };

/**
 * Strip Next.js "use client" / "use server" directives so Vitest can import
 * React components without Vite treating the directive string as a URL import.
 * This is a no-op in production builds (Next.js handles directives natively).
 */
function stripNextDirectives(): Plugin {
  return {
    name: "strip-next-directives",
    transform(code: string) {
      // Remove standalone directive strings at the very start of the file
      return code.replace(/^["']use (client|server)["'];\n?/m, "");
    },
  };
}

export default defineConfig({
  plugins: [stripNextDirectives()],
  resolve: { alias },
  test: {
    testTimeout: 10000,
    globals: false,
    pool: "forks",
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/integration/gbrain/**"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "gbrain-integration",
          include: ["tests/integration/gbrain/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
