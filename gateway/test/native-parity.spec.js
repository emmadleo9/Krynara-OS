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
// Protobuf fixture helpers (little-endian, length-delimited)
// ---------------------------------------------------------------------------

function varint(value) {
  const out = [];
  let v = value;
  do {
    let byte = v & 0x7f;
    v = Math.floor(v / 128);
    if (v > 0) byte |= 0x80;
    out.push(byte);
  } while (v > 0);
  return Buffer.from(out);
}

/** wire type 5 (32-bit) field */
function floatField(fieldNumber, value) {
  const key = varint((fieldNumber << 3) | 5);
  const payload = Buffer.alloc(4);
  payload.writeFloatLE(value, 0);
  return Buffer.concat([key, payload]);
}

/** wire type 2 (length-delimited) field */
function bytesField(fieldNumber, payload) {
  return Buffer.concat([varint((fieldNumber << 3) | 2), varint(payload.length), payload]);
}

/** Build a FeedMessage containing one vehicle with the given position. */
function feedWithVehicle(lat, lon) {
  const position = Buffer.concat([floatField(1, lat), floatField(2, lon)]);
  const vehicle = bytesField(2, position);   // field 2 = position
  const entity = bytesField(4, vehicle);     // field 4 = vehicle
  return bytesField(2, entity);              // field 2 = entity
}

// ---------------------------------------------------------------------------
// Transit decode — shape semantics
// ---------------------------------------------------------------------------

test('transit decode: empty payload yields empty array', async () => {
  if (!requireSidecar()) return;
  const actual = await call('/transit/decode', Buffer.alloc(0));
  assert.deepEqual(actual, []);
});

test('transit decode: output matches JSON.stringify of the JS vehicle', async () => {
  if (!requireSidecar()) return;

  // JS readVehicle returns { id, label, route, lat, lon, bearing, speed, timestamp }.
  // Keys whose value is undefined (e.g. timestamp when absent) are dropped by
  // JSON.stringify, so the wire format legitimately omits them.
  const actual = await call('/transit/decode', feedWithVehicle(50.0, 50.0));
  assert.equal(actual.length, 1);

  const jsVehicle = {
    id: '',
    label: '',
    route: '',
    lat: 50.0,
    lon: 50.0,
    bearing: undefined,
    speed: undefined,
    timestamp: undefined,
  };
  const expected = JSON.parse(JSON.stringify(jsVehicle));

  assert.deepEqual(actual[0], expected);
  assert.equal(jsVehicleIsValid(actual[0]), true);
});

test('transit decode: drops vehicles with invalid coordinates', async () => {
  if (!requireSidecar()) return;

  const actual = await call('/transit/decode', feedWithVehicle(0, 0));
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