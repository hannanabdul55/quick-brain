#!/usr/bin/env node
/**
 * QuickBrain D-12 patch applier.
 *
 * patch-package 8.x does not support bun.lock (only npm/yarn) and cannot
 * parse gbrain's 4-segment version (0.35.1.0) as a valid semver, so it fails
 * silently. This script applies the committed patch directly using the `patch`
 * CLI, which is available on all macOS/Linux systems.
 *
 * Invoked by:  "postinstall": "node scripts/apply-gbrain-patch.js"
 *
 * The patch at patches/gbrain+3933eb6.patch threads an optional `sourceId`
 * parameter through gbrain's runThink -> runGather -> hybridSearch/searchTakes
 * chain (D-12). A gbrain version bump invalidates this patch — re-run
 * `diff -u` against the new gbrain source and update the patch file.
 */

const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..');
const PATCH_FILE = path.join(REPO_ROOT, 'patches', 'gbrain+3933eb6.patch');
const GBRAIN_DIR = path.join(REPO_ROOT, 'node_modules', 'gbrain');

// Skip if gbrain is not installed (e.g. peer-dep-only environments)
if (!fs.existsSync(GBRAIN_DIR)) {
  process.stderr.write('[apply-gbrain-patch] node_modules/gbrain not found — skipping patch\n');
  process.exit(0);
}

// Skip if patch file doesn't exist (shouldn't happen in a normal checkout)
if (!fs.existsSync(PATCH_FILE)) {
  process.stderr.write('[apply-gbrain-patch] patches/gbrain+3933eb6.patch not found — skipping\n');
  process.exit(0);
}

// Check if the patch is already applied by looking for the sourceId marker
const gatherFile = path.join(GBRAIN_DIR, 'src', 'core', 'think', 'gather.ts');
if (fs.existsSync(gatherFile)) {
  const content = fs.readFileSync(gatherFile, 'utf8');
  if (content.includes('QuickBrain D-12 patch')) {
    // Already applied — skip silently (idempotent)
    process.exit(0);
  }
}

// Apply the patch using the system `patch` command
// -p1: strip one leading path component (a/ and b/ prefixes in the diff)
// --forward: skip patches that appear to be already applied
// --directory: apply relative to gbrain's node_modules directory
const result = spawnSync('patch', [
  '-p1',
  '--forward',
  '--directory', GBRAIN_DIR,
  '--input', PATCH_FILE,
], {
  stdio: 'inherit',
  cwd: REPO_ROOT,
});

if (result.status !== 0 && result.status !== 1) {
  // exit 1 from patch means "already applied" (--forward), which is fine
  process.stderr.write(`[apply-gbrain-patch] patch command failed with exit code ${result.status}\n`);
  process.exit(result.status);
}

process.stdout.write('[apply-gbrain-patch] D-12 patch applied to gbrain (sourceId threading)\n');
