export { spawnGBrain, query, think, type GBrainResult, type SpawnGBrainOpts } from "./client.ts";
export { onboard, type ProgressEvent, type Phase, type OnboardOpts } from "./onboard.ts";
export {
  getBySlug,
  getBySourceId,
  list as listTenants,
  isSeed,
  type TenantRecord,
  type TenantStatus,
} from "./tenants.ts";
export { withTenantLock } from "./mutex.ts";
export {
  TENANT_SLUG_REGEX,
  tenantSlugSchema,
  isValidTenantSlug,
  assertTenantSlug,
} from "./slug.ts";
export {
  BRAINS_ROOT,
  FIXTURES_ROOT,
  SEED_TENANT_ID,
  brainHome,
  seedBrainHome,
} from "./paths.ts";
export {
  createGBrainEngine,
  queryInProcess,
  disconnectEngine,
  type SearchResult,
} from "./engine.ts";
