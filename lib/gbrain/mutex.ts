// HARN-04: Per-tenant in-process Promise mutex queue.
//
// PGLite holds an exclusive file lock; concurrent gbrain CLI invocations
// against the same brain crash with "database is locked". Serialize at
// the application layer so the brain only sees one writer at a time.
//
// Queue is keyed by tenantId. Different tenants run in parallel; same
// tenant serializes. Tasks always run, even if a predecessor rejects.

const queues = new Map<string, Promise<unknown>>();

export function withTenantLock<T>(tenantId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(tenantId) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(tenantId, next);
  next.finally(() => {
    if (queues.get(tenantId) === next) queues.delete(tenantId);
  });
  return next;
}

export function pendingTenants(): string[] {
  return Array.from(queues.keys());
}
