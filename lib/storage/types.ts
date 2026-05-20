/**
 * StorageBackend — common interface for binary asset storage.
 *
 * Implementations: createLocalStorage (local disk, dev fallback),
 * createSupabaseStorage (Supabase Storage, production).
 *
 * Factory: createStorage() in index.ts reads STORAGE_BACKEND env var.
 */
export interface StorageBackend {
  /** Upload data to the given storage path. Creates parent directories as needed. */
  upload(path: string, data: Buffer, mimeType?: string): Promise<void>;
  /** Download data from the given storage path. Throws if the path does not exist. */
  download(path: string): Promise<Buffer>;
  /**
   * Return a URL for the given storage path.
   * - Local backend: file:// absolute path.
   * - Supabase backend: a signed URL (1-hour TTL).
   */
  getUrl(path: string): Promise<string>;
  /**
   * Check whether the given storage path exists.
   * Synchronous for the local backend; returns a Promise<boolean> for
   * the Supabase backend (HEAD request). Both return Promise<boolean>
   * so callers can use await uniformly.
   */
  exists(path: string): Promise<boolean>;
}
