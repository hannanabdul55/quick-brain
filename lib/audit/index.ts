/**
 * lib/audit/index.ts
 *
 * Public re-export surface for the smb-audit skill and any legacy consumers.
 *
 * Import pattern (from skill entry point or other callers):
 *   import { runDetection } from '../../../lib/audit/index.js';
 *
 * Note: anomaly-detector.ts is the canonical implementation; this file
 * provides a stable re-export surface so callers don't have to know the
 * internal module structure.
 */

export { runDetection } from "./anomaly-detector.ts";
