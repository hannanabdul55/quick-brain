/**
 * Abort tracker — module-scoped registry of AbortControllers keyed by tenantId.
 *
 * Route handlers (chat, onboard, etc.) call registerAbortable() when they
 * start a long-running operation for a tenant, and unregisterAbortable() in
 * a finally block when it completes. The reset endpoint calls abortTenant()
 * to signal all in-flight operations for the tenant to stop.
 *
 * Design note: the abort tracker is intentionally separate from withTenantLock().
 * The reset endpoint does NOT acquire the tenant lock — it proceeds independently.
 * An in-flight chat spawn may write to a dir that is about to be rm'd; that
 * spawn will exit non-zero and the chat surface shows an error, which is
 * acceptable demo behavior (trade-off documented in D-Reset-Flow).
 */

const trackers = new Map<string, Set<AbortController>>();

/**
 * Register a new AbortController for the given tenant.
 *
 * Callers MUST call unregisterAbortable() in a finally block.
 *
 * @param tenantId - The tenant whose operations to track.
 * @returns A fresh AbortController; the caller owns the associated operation.
 */
export function registerAbortable(tenantId: string): AbortController {
  const ctrl = new AbortController();
  let set = trackers.get(tenantId);
  if (!set) {
    set = new Set<AbortController>();
    trackers.set(tenantId, set);
  }
  set.add(ctrl);
  return ctrl;
}

/**
 * Unregister an AbortController that was previously registered.
 * Safe to call even if the controller was never registered or was already removed.
 *
 * @param tenantId - The tenant this controller belonged to.
 * @param ctrl     - The controller to remove.
 */
export function unregisterAbortable(tenantId: string, ctrl: AbortController): void {
  const set = trackers.get(tenantId);
  if (!set) return;
  set.delete(ctrl);
  if (set.size === 0) {
    trackers.delete(tenantId);
  }
}

/**
 * Abort all in-flight operations for the given tenant.
 * Clears the Set after aborting so stale controllers are not held.
 *
 * @param tenantId - The tenant whose in-flight operations to abort.
 * @returns The number of AbortControllers that were signalled.
 */
export function abortTenant(tenantId: string): number {
  const set = trackers.get(tenantId);
  if (!set || set.size === 0) return 0;

  let count = 0;
  for (const ctrl of set) {
    ctrl.abort();
    count++;
  }

  set.clear();
  trackers.delete(tenantId);

  return count;
}
