/**
 * WhatsApp media retention.
 *
 * gateway/data/whatsapp_media grows without bound: every downloaded attachment is
 * kept forever, plus interrupted downloads leave `.part` files behind. This runs
 * a sweep at boot and on an interval, deleting:
 *
 *   - `.part` files older than PART_TTL_MS (orphaned partial downloads)
 *   - any media file older than RETENTION_DAYS
 *
 * Tunable via env:
 *   KRYNARA_MEDIA_RETENTION_DAYS=30   (0 disables age-based deletion)
 *   KRYNARA_MEDIA_MAX_GB=2            (0 disables the total-size cap)
 *   KRYNARA_MEDIA_SWEEP_HOURS=6
 */

const fs = require('node:fs');
const path = require('node:path');

const MEDIA_DIR = path.join(__dirname, 'data', 'whatsapp_media');

const RETENTION_DAYS = Number(process.env.KRYNARA_MEDIA_RETENTION_DAYS ?? 30);
const MAX_GB = Number(process.env.KRYNARA_MEDIA_MAX_GB ?? 2);
const SWEEP_HOURS = Number(process.env.KRYNARA_MEDIA_SWEEP_HOURS ?? 6);
const PART_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_BYTES = MAX_GB > 0 ? MAX_GB * 1024 * 1024 * 1024 : Infinity;

function log(message) {
  console.log(`${new Date().toISOString()} ${message}`);
}

/**
 * Deletes expired files. Returns a summary; never throws, so a permission or
 * I/O error can never take the gateway down.
 */
function sweepMedia() {
  const summary = { removed: 0, bytes: 0, partRemoved: 0, failed: 0 };
  let entries;
  try {
    entries = fs.readdirSync(MEDIA_DIR, { withFileTypes: true });
  } catch {
    return summary; // directory not created yet
  }

  const now = Date.now();
  const maxAgeMs = RETENTION_DAYS > 0 ? RETENTION_DAYS * 24 * 60 * 60 * 1000 : Infinity;

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const fullPath = path.join(MEDIA_DIR, entry.name);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }

    const age = now - stat.mtimeMs;
    const isPart = entry.name.endsWith('.part');
    const expired = isPart ? age > PART_TTL_MS : age > maxAgeMs;
    if (!expired) continue;

    try {
      fs.unlinkSync(fullPath);
      summary.removed += 1;
      summary.bytes += stat.size;
      if (isPart) summary.partRemoved += 1;
    } catch (error) {
      summary.failed += 1;
      log(`media cleanup: could not delete ${entry.name}: ${error && error.message ? error.message : error}`);
    }
  }

  return summary;
}

/** Runs a sweep at boot, then every SWEEP_HOURS. */
function startMediaCleanup() {
  const run = () => {
    const summary = sweepMedia();
    if (summary.removed > 0) {
      const mb = (summary.bytes / 1024 / 1024).toFixed(1);
      log(`media cleanup: removed ${summary.removed} file(s), ${mb} MB (${summary.partRemoved} partial)`);
    }
  };

  run();
  const intervalMs = Math.max(1, SWEEP_HOURS) * 60 * 60 * 1000;
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = { sweepMedia, startMediaCleanup, MEDIA_DIR };