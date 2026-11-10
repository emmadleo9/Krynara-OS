/**
 * KRYNARA single storage root resolver (ESM).
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

import fs from 'node:fs';
import path from 'node:path';

const LEGACY_ROOT = 'D:/Krynara-OS-STORAGE';
const CANONICAL_ROOT = 'D:/Krynara-OS Storage';

export function resolveStorageRoot() {
  const env = process.env.KRYNARA_STORAGE_ROOT;
  if (env) {
    const resolved = path.resolve(env);
    ensureDirs(resolved);
    return resolved;
  }

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

export const STORAGE_ROOT = resolveStorageRoot();
export const LEGACY_ROOT_PATH = LEGACY_ROOT;
export const CANONICAL_ROOT_PATH = CANONICAL_ROOT;
