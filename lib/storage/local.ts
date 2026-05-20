/**
 * Local filesystem storage backend — dev fallback.
 *
 * Stores files under baseDir (defaults to .local-storage/ in the process cwd).
 * No external dependencies. Not suitable for production (ephemeral FS, no CDN URL).
 */

import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import type { StorageBackend } from "./types.ts";

export function createLocalStorage(baseDir?: string): StorageBackend {
  const root = baseDir ?? resolve(process.cwd(), ".local-storage");

  return {
    async upload(path: string, data: Buffer, _mimeType?: string): Promise<void> {
      const dest = join(root, path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, data);
    },

    async download(path: string): Promise<Buffer> {
      const src = join(root, path);
      return readFile(src);
    },

    async getUrl(path: string): Promise<string> {
      const abs = resolve(join(root, path));
      return `file://${abs}`;
    },

    exists(path: string): Promise<boolean> {
      return Promise.resolve(existsSync(join(root, path)));
    },
  };
}
