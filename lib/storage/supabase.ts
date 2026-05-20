/**
 * Supabase Storage backend — production implementation.
 *
 * Uses the Supabase Storage REST API directly via fetch.
 * NO @supabase/storage-js or @supabase/supabase-js dependency —
 * raw fetch keeps the dep tree clean (hackathon constraint, CLAUDE.md).
 *
 * Security: SUPABASE_SERVICE_ROLE_KEY bypasses RLS for storage objects.
 * Used ONLY for binary asset upload/download (gbrain files subsystem).
 * Text pages live in Postgres via gbrain's own pooler connection —
 * the service role key is NOT passed to gbrain child processes. (T-02B-02)
 * The key is never logged or echoed in error messages. (T-02B-01)
 */

import type { StorageBackend } from "./types.ts";

export function createSupabaseStorage(
  bucket: string,
  supabaseUrl: string,
  serviceRoleKey: string,
): StorageBackend {
  const base = `${supabaseUrl}/storage/v1/object`;

  return {
    async upload(path: string, data: Buffer, mimeType?: string): Promise<void> {
      const url = `${base}/${bucket}/${path}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": mimeType ?? "application/octet-stream",
        },
        // Convert Buffer → ArrayBuffer for fetch BodyInit compatibility.
        // Bun's fetch types accept ArrayBuffer; a slice is used to avoid
        // sharing the underlying SharedArrayBuffer backing from Buffer.
        body: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Storage upload failed (${res.status}): ${body}`);
      }
    },

    async download(path: string): Promise<Buffer> {
      const url = `${base}/${bucket}/${path}`;
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      });
      if (!res.ok) {
        throw new Error(`Storage download failed (${res.status}) for path: ${path}`);
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    },

    async getUrl(path: string): Promise<string> {
      const url = `${supabaseUrl}/storage/v1/object/sign/${bucket}/${path}`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ expiresIn: 3600 }),
      });
      if (!res.ok) {
        throw new Error(`Storage sign-url failed (${res.status}) for path: ${path}`);
      }
      const json = (await res.json()) as { signedURL?: string; signedUrl?: string };
      const signed = json.signedURL ?? json.signedUrl;
      if (!signed) {
        throw new Error(`Storage sign-url response missing signedURL for path: ${path}`);
      }
      return signed;
    },

    async exists(path: string): Promise<boolean> {
      const url = `${base}/${bucket}/${path}`;
      const res = await fetch(url, {
        method: "HEAD",
        headers: {
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      });
      return res.ok;
    },
  };
}
