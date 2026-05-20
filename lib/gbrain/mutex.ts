// HARN-04: Per-tenant in-process Promise mutex queue.
//
// Per-tenant in-process Promise mutex queue. In Phase 1/2, this serialized
// child-process spawns to prevent PGLite "database is locked" crashes. As of
// Phase 3 (in-process gbrain on Postgres), PGLite is no longer in the
// query/think path and Postgres handles concurrent reads. withTenantLock is
// retained to:
// (a) serialize the onboarding init/import/embed sequence per tenant (sequential
//     gbrain operations must not interleave on the same brain dir),
// (b) preserve the Phase 1 mutex-smoke regression test contract unchanged.
// The lock is harmless for query/think (Postgres handles it); it is load-bearing
// for onboarding provisioning until Phase 6 replaces the spawn-based init path.
//
// Queue is keyed by tenantId. Different tenants run in parallel; same
// tenant serializes. Tasks always run, even if a predecessor rejects.

const queues = new Map<string, Promise<unknown>>();

export function withTenantLock<T>(tenantId: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(tenantId) ?? Promise.resolve();
  const next = previous.then(task, task);
  queues.set(tenantId, next);
  // .finally() returns a NEW promise that mirrors `next`'s rejection. The
  // caller can .catch on the returned `next` — but the finally-chain is
  // orphan, so swallow its rejection to prevent unhandledRejection events
  // when the caller's task throws. The caller still sees the rejection on `next`.
  next.finally(() => {
    if (queues.get(tenantId) === next) queues.delete(tenantId);
  }).catch(() => {});
  return next;
}

export function pendingTenants(): string[] {
  return Array.from(queues.keys());
}
