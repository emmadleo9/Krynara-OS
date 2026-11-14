/**
 * Tests for the WhatsApp media retention sweep.
 *
 * Uses a temp directory so real media is never touched.
 * Run: node --test gateway/test/media-cleanup.spec.js
 */

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'krynara-media-'));
  process.env.KRYNARA_MEDIA_DIR = tmpDir;
  process.env.KRYNARA_MEDIA_RETENTION_DAYS = '30';
  process.env.KRYNARA_MEDIA_MAX_GB = '0';
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.KRYNARA_MEDIA_DIR;
});

function writeFile(name, bytes, ageMs = 0) {
  const fullPath = path.join(tmpDir, name);
  fs.writeFileSync(fullPath, Buffer.alloc(bytes, 1));
  if (ageMs > 0) {
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(fullPath, when, when);
  }
  return fullPath;
}

// media-cleanup reads env at require time, so re-require per test.
function loadModule() {
  delete require.cache[require.resolve('../media-cleanup')];
  return require('../media-cleanup');
}

test('keeps fresh files', () => {
  const mc = loadModule();
  const file = writeFile('fresh.jpg', 1024);
  const summary = mc.sweepMedia();
  assert.equal(summary.removed, 0);
  assert.equal(fs.existsSync(file), true);
});

test('deletes files older than the retention window', () => {
  const mc = loadModule();
  const old = writeFile('old.jpg', 1024, 40 * 24 * 60 * 60 * 1000);
  const summary = mc.sweepMedia();
  assert.equal(summary.removed, 1);
  assert.equal(fs.existsSync(old), false);
});

test('deletes stale .part files older than one hour', () => {
  const mc = loadModule();
  const part = writeFile('download.mp4.part', 512, 2 * 60 * 60 * 1000);
  const summary = mc.sweepMedia();
  assert.equal(summary.removed, 1);
  assert.equal(summary.partRemoved, 1);
  assert.equal(fs.existsSync(part), false);
});

test('keeps fresh .part files', () => {
  const mc = loadModule();
  const part = writeFile('active.mp4.part', 512, 60 * 1000);
  const summary = mc.sweepMedia();
  assert.equal(summary.removed, 0);
  assert.equal(fs.existsSync(part), true);
});

test('enforces the total-size cap by deleting oldest first', () => {
  // Cap at 1600 bytes so 2100 bytes of media must shed exactly the oldest file.
  process.env.KRYNARA_MEDIA_MAX_GB = String(1600 / (1024 * 1024 * 1024));
  const mc = loadModule();

  const oldest = writeFile('a-oldest.jpg', 700, 3 * 60 * 1000);
  const middle = writeFile('b-middle.jpg', 700, 2 * 60 * 1000);
  const newest = writeFile('c-newest.jpg', 700, 1 * 60 * 1000);

  const summary = mc.sweepMedia();

  assert.equal(summary.sizeCapped, true);
  assert.equal(fs.existsSync(oldest), false, 'oldest should be evicted first');
  assert.equal(fs.existsSync(middle), true, 'middle should survive');
  assert.equal(fs.existsSync(newest), true, 'newest should survive');
  assert.equal(summary.removed, 1);
});

test('missing directory is not an error', () => {
  const mc = loadModule();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  const summary = mc.sweepMedia();
  assert.equal(summary.removed, 0);
  assert.equal(summary.failed, 0);
});