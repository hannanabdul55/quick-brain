/**
 * tests/infra/storage.test.ts
 *
 * CI-safe unit tests for lib/storage/.
 * The local backend is tested with a temp directory (no Supabase credentials needed).
 * The Supabase backend is NOT tested here — leave that to manual verification via
 * the checkpoint (requires live Supabase creds).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

describe("lib/storage — local backend", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "storage-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("createStorage('local') returns an object with all four StorageBackend methods", async () => {
    const { createStorage } = await import("../../lib/storage/index.ts");
    const backend = createStorage("local");
    expect(typeof backend.upload).toBe("function");
    expect(typeof backend.download).toBe("function");
    expect(typeof backend.getUrl).toBe("function");
    expect(typeof backend.exists).toBe("function");
  });

  it("createStorage('local') round-trips a small Buffer via upload/download", async () => {
    const { createLocalStorage } = await import("../../lib/storage/local.ts");
    const backend = createLocalStorage(tmpDir);
    const data = Buffer.from("hello phase 2 storage");
    await backend.upload("test/file.txt", data);
    const result = await backend.download("test/file.txt");
    expect(result.toString()).toBe("hello phase 2 storage");
  });

  it("createStorage('local') getUrl returns a file:// path containing the storage path", async () => {
    const { createLocalStorage } = await import("../../lib/storage/local.ts");
    const backend = createLocalStorage(tmpDir);
    const data = Buffer.from("url test");
    await backend.upload("assets/image.png", data);
    const url = await backend.getUrl("assets/image.png");
    expect(url).toMatch(/^file:\/\//);
    expect(url).toContain("assets");
  });

  it("createStorage('local') exists() returns true after upload, false before", async () => {
    const { createLocalStorage } = await import("../../lib/storage/local.ts");
    const backend = createLocalStorage(tmpDir);
    expect(await backend.exists("not-there.txt")).toBe(false);
    await backend.upload("exists-test.txt", Buffer.from("data"));
    expect(await backend.exists("exists-test.txt")).toBe(true);
  });

  it("factory respects STORAGE_BACKEND=local env var and returns local backend", async () => {
    // Ensure env var is set to local explicitly
    const origEnv = process.env.STORAGE_BACKEND;
    process.env.STORAGE_BACKEND = "local";
    try {
      // Re-import with env var set (modules are cached so we test the factory logic directly)
      const { createStorage } = await import("../../lib/storage/index.ts");
      const backend = createStorage(); // no explicit backend arg — reads env var
      expect(typeof backend.upload).toBe("function");
      expect(typeof backend.download).toBe("function");
    } finally {
      if (origEnv === undefined) {
        delete process.env.STORAGE_BACKEND;
      } else {
        process.env.STORAGE_BACKEND = origEnv;
      }
    }
  });

  it("createStorage('supabase') throws a clear error when credentials are missing", async () => {
    const origUrl = process.env.SUPABASE_URL;
    const origKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const { createStorage } = await import("../../lib/storage/index.ts");
      expect(() => createStorage("supabase")).toThrow(/SUPABASE_URL.*SUPABASE_SERVICE_ROLE_KEY/);
    } finally {
      if (origUrl !== undefined) process.env.SUPABASE_URL = origUrl;
      if (origKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origKey;
    }
  });
});
