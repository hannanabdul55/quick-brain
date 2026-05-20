import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 10000,
    globals: false,
    pool: "forks",
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/integration/gbrain/**"],
          environment: "node",
        },
      },
      {
        test: {
          name: "gbrain-integration",
          include: ["tests/integration/gbrain/**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
