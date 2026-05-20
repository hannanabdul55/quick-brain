import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Match the rest of the toolchain (tsconfig paths / Next): resolve @/* to the
// repo root. With Vitest `projects`, the root resolve.alias is NOT inherited —
// each project needs its own, so the alias is defined once and applied to both.
let rootDir = fileURLToPath(new URL(".", import.meta.url));
if (rootDir.endsWith("/")) rootDir = rootDir.slice(0, -1);

const alias = { "@": rootDir };

export default defineConfig({
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
