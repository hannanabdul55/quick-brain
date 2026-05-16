export { spawnGBrain, query, type GBrainResult, type SpawnGBrainOpts } from "./client.ts";
export { onboard, type ProgressEvent, type Phase, type OnboardOpts } from "./onboard.ts";
export {
  init as initTenants,
  reload as reloadTenants,
  get as getTenant,
  list as listTenants,
  upsert as upsertTenant,
  remove as removeTenant,
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
