/**
 * KRYNARA single storage root resolver.
 *
 * Ensures exactly ONE storage folder is ever used. Precedence:
 *
 *  1. ``$KRYNARA_STORAGE_ROOT`` — explicit env override (absolute path).
 *  2. ``D:/Krynara-OS Storage`` — the canonical single storage folder (with
 *     space), created if nothing exists yet.
 *  3. ``D:/Krynara-OS-STORAGE`` — legacy fallback only when it already exists
 *     (so existing installs keep working without a silent duplicate).
 *
 * Whichever path wins is returned, and that directory (plus `config/` and
 * `generations/`) is created once. No other storage root is ever touched, so
 * there is never a duplicate folder.
 */

const fs = require('node:fs');
const path = require('node:path');

const LEGACY_ROOT = 'D:/Krynara-OS-STORAGE';
const CANONICAL_ROOT = 'D:/Krynara-OS Storage';

function resolveStorageRoot() {
  const env = process.env.KRYNARA_STORAGE_ROOT;
  if (env) {
    const resolved = path.resolve(env);
    ensureDirs(resolved);
    return resolved;
  }

  // If the legacy folder already exists, keep using it (no silent migration,
  // no duplicate). Otherwise use the canonical folder.
  if (fs.existsSync(LEGACY_ROOT)) {
    ensureDirs(LEGACY_ROOT);
    return LEGACY_ROOT;
  }

  ensureDirs(CANONICAL_ROOT);
  return CANONICAL_ROOT;
}

function ensureDirs(root) {
  for (const sub of ['', 'config', 'generations']) {
    const dir = path.join(root, sub);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

const STORAGE_ROOT = resolveStorageRoot();

module.exports = {
  STORAGE_ROOT,
  resolveStorageRoot,
  LEGACY_ROOT,
  CANONICAL_ROOT,
};
