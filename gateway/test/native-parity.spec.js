/**
 * Parity tests for the Rust native sidecar.
 *
 * These pin the exact semantics of the JavaScript implementations the sidecar
 * replaced. They skip cleanly when the sidecar is not running, so they are safe
 * to run in CI or on a machine where gateway/native has not been built.
 *
 * Run: node --test gateway/test/native-parity.spec.js
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const BASE = process.env.KRYNARA_NATIVE_URL || 'http://127.0.0.1:2790';
let available = false;

before(async () => {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1000) });
    const body = await res.json().catch(() => null);
    available = Boolean(res.ok && body && body.ok === true);
  } catch {
    available = false;
  }
});

function requireSidecar() {
  if (!available) {
    console.log(`[native-parity] sidecar not reachable at ${BASE}; skipping`);
    return false;
  }
  return true;
}

async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/octet-stream' },
    body: body === undefined ? undefined : body,
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(res.status, 200, `${path} returned HTTP ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Reference implementations (copied from the JS code the sidecar replaced)
// ---------------------------------------------------------------------------

/** gateway/index.js loadAircraft() regional merge */
function jsDedupeAircraft(items) {
  const aircraft = new Map();
  for (const item of items) {
    if (item && typeof item.hex === 'string' && item.hex) aircraft.set(item.hex, item);
  }
  return [...aircraft.values()].slice(0, 400);
}

/** gateway/routes/transit.js readVehicle() flatten + validate guard */
function jsVehicleIsValid(p) {
  if (!p) return false;
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return false;
  if (Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return false;
  if (p.lat === 0 && p.lon === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// ADS-B dedupe
// ---------------------------------------------------------------------------

test('adsb dedupe: exact Map parity on adversarial input', async () => {
  if (!requireSidecar()) return;

  const payload = [
    { hex: 'AAA', marker: 'a1' },
    { hex: 'BBB', marker: 'b1' },
    { hex: 'AAA', marker: 'a2' },      // duplicate: last wins at first position
    { hex: 'aaa', marker: 'lower' },   // case variant: distinct key
    { marker: 'nohex' },               // dropped
    { hex: '', marker: 'empty' },      // dropped
    { hex: 42, marker: 'numeric' },    // dropped (non-string)
    { hex: null, marker: 'null' },     // dropped
    ...Array.from({ length: 600 }, (_, i) => ({ hex: `X${i}`, marker: `x${i}` })),
  ];

  const expected = jsDedupeAircraft(payload);
  const actual = await call('/adsb/dedupe', Buffer.from(JSON.stringify(payload)));

  assert.equal(Array.isArray(actual), true, 'expected an array');
  assert.equal(actual.length, expected.length, 'deduped length mismatch');
  assert.deepEqual(actual, expected);
});

test('adsb dedupe: caps at 400', async () => {
  if (!requireSidecar()) return;

  const payload = Array.from({ length: 500 }, (_, i) => ({ hex: `H${i}` }));
  const actual = await call('/adsb/dedupe', Buffer.from(JSON.stringify(payload)));
  assert.equal(actual.length, 400);
});

test('adsb dedupe: rejects non-array', async () => {
  if (!requireSidecar()) return;

  const res = await fetch(`${BASE}/adsb/dedupe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('{"hex":"a"}'),
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// Transit decode — shape semantics
// ---------------------------------------------------------------------------

test('transit decode: empty payload yields empty array', async () => {
  if (!requireSidecar()) return;
  const actual = await call('/transit/decode', Buffer.alloc(0));
  assert.deepEqual(actual, []);
});

test('transit decode: output objects carry the JS field set', async () => {
  if (!requireSidecar()) return;

  // Build a minimal FeedMessage{ header, entity: [ { vehicle: { position: { latitude, longitude } } } ] }
  // field 1 = header (skip), field 2 = entity (length-delimited)
  const position = Buffer.from([
    0x0d, 0x00, 0x00, 0x48, 0x42, // field 1 (latitude), wire 5, float32 50.0
    0x11, 0x00, 0x00, 0x48, 0x42, // field 2 (longitude), wire 5, float32 50.0
  ]);
  const vehicle = Buffer.from([
    0x12, position.length, ...position, // field 2 = position
  ]);
  const entity = Buffer.from([
    0x22, vehicle.length, ...vehicle, // field 4 = vehicle
  ]);
  const feed = Buffer.from([
    0x12, entity.length, ...entity,   // field 2 = entity
  ]);

  const actual = await call('/transit/decode', feed);
  assert.equal(actual.length, 1);

  const v = actual[0];
  // JS readVehicle always emits these keys.
  for (const key of ['id', 'label', 'route', 'lat', 'lon', 'timestamp']) {
    assert.equal(key in v, true, `missing key ${key}`);
  }
  assert.equal(typeof v.lat, 'number');
  assert.equal(typeof v.lon, 'number');
  assert.equal(jsVehicleIsValid(v), true);
});

test('transit decode: drops vehicles with invalid coordinates', async () => {
  if (!requireSidecar()) return;

  // lat/lon both 0 -> JS guard returns null
  const position = Buffer.from([
    0x0d, 0x00, 0x00, 0x00, 0x00,
    0x11, 0x00, 0x00, 0x00, 0x00,
  ]);
  const vehicle = Buffer.from([0x12, position.length, ...position]);
  const entity = Buffer.from([0x22, vehicle.length, ...vehicle]);
  const feed = Buffer.from([0x12, entity.length, ...entity]);

  const actual = await call('/transit/decode', feed);
  assert.equal(actual.length, 0, 'vehicle with 0,0 coordinates must be dropped');
});

// ---------------------------------------------------------------------------
// System stats — percentage bounds (regression guard for the 10x bug)
// ---------------------------------------------------------------------------

test('system stats: percentages within 0-100', async () => {
  if (!requireSidecar()) return;
  const stats = await call('/system-stats');
  for (const field of ['cpuLoad', 'memoryLoad', 'diskLoad']) {
    const value = stats[field];
    assert.equal(typeof value, 'number', `${field} must be numeric`);
    assert.ok(value >= 0 && value <= 100, `${field} out of range: ${value}`);
  }
  assert.ok(stats.timestamp.endsWith('Z'), 'timestamp must be ISO-8601 Z');
});

test('system processes: shape and sort order', async () => {
  if (!requireSidecar()) return;
  const result = await call('/system-processes');
  assert.equal(Array.isArray(result.processes), true);
  assert.ok(result.total > 0, 'total must be positive');
  assert.ok(result.processes.length <= 200, 'rows must be capped at 200');
  for (let i = 1; i < result.processes.length; i += 1) {
    const prev = result.processes[i - 1].cpu;
    const cur = result.processes[i].cpu;
    assert.ok(prev >= cur, `rows not sorted by cpu desc at ${i}: ${prev} < ${cur}`);
  }
});