/**
 * createStorage — factory that returns the correct StorageBackend.
 *
 * Reads STORAGE_BACKEND env var ("supabase" | "local"; default: "local").
 * Pass backend arg explicitly to override the env var.
 *
 * For STORAGE_BACKEND=supabase:
 *   Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
 *   Throws a clear, credential-free error if either is missing. (T-02B-04)
 *
 * For STORAGE_BACKEND=local (default):
 *   Uses local disk at .local-storage/ — no credentials needed.
 */

import { createLocalStorage } from "./local.ts";
import { createSupabaseStorage } from "./supabase.ts";
import type { StorageBackend } from "./types.ts";

export type { StorageBackend } from "./types.ts";

export function createStorage(backend?: string): StorageBackend {
  const resolved = backend ?? process.env.STORAGE_BACKEND ?? "local";

  if (resolved === "supabase") {
    const supabaseUrl = process.env.SUPABASE_URL ?? "";
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const bucket = process.env.STORAGE_BUCKET ?? "brain-files";
    if (!supabaseUrl || !key) {
      // T-02B-04: throw a clear, credential-free error — do NOT echo partial values.
      throw new Error(
        "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required for STORAGE_BACKEND=supabase",
      );
    }
    return createSupabaseStorage(bucket, supabaseUrl, key);
  }

  // Default: local filesystem fallback.
  return createLocalStorage();
}
