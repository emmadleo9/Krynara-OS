const native = require('../native/client');

function log(message) {
  console.log(`[transit] ${message}`);
}

const FEEDS = [
  { id: 'mta-new-york', name: 'MTA New York City buses', bounds: [-74.3, 40.48, -73.68, 40.95], url: 'https://gtfsrt.prod.obanyc.com/vehiclePositions', mode: 'bus' },
  { id: 'septa-philadelphia', name: 'SEPTA Philadelphia', bounds: [-75.8347, 39.8123, -74.7542, 40.334], url: 'https://www3.septa.org/gtfsrt/septa-pa-us/Vehicle/rtVehiclePosition.pb', mode: 'bus' },
  { id: 'entur-norway', name: 'Entur Norway', bounds: [4.5, 57.9, 31.2, 71.2], url: 'https://api.entur.io/realtime/v1/gtfs-rt/vehicle-positions', mode: 'transit', headers: { 'ET-Client-Name': 'krynara-os-world-view' } },
  { id: 'hsl-helsinki', name: 'HSL Helsinki region', bounds: [24.0181, 59.9875, 26.705, 60.9763], url: 'https://realtime.hsl.fi/realtime/vehicle-positions/v2/hsl', mode: 'transit' },
  { id: 'sofia-traffic', name: 'Sofia Traffic', bounds: [23.138, 42.5379, 23.546, 42.8688], url: 'https://gtfs.sofiatraffic.bg/api/v1/vehicle-positions', mode: 'transit' },
  { id: 'rome-mobility', name: 'Roma Mobilità', bounds: [12.1078, 41.6486, 12.7892, 42.4415], url: 'https://romamobilita.it/sites/default/files/rome_rtgtfs_vehicle_positions_feed.pb', mode: 'transit' },
  { id: 'lvivavtodor', name: 'Lvivavtodor', bounds: [23.8235, 49.733, 24.1977, 49.9546], url: 'https://track.ua-gis.com/gtfs/lviv/vehicle_position', mode: 'transit' },
  { id: 'bucharest-transit', name: 'Bucharest TPBI', bounds: [25.87, 44.2567, 26.3862, 44.7506], url: 'https://gtfs.tpbi.ro/api/gtfs-rt/vehiclePositions', mode: 'bus' },
  { id: 'queensland-translink', name: 'TransLink Queensland', bounds: [152.1242, -28.2016, 153.5434, -26.1594], url: 'https://gtfsrt.api.translink.com.au/api/realtime/seq/VehiclePositions', mode: 'transit' },
  { id: 'adelaide-metro', name: 'Adelaide Metro', bounds: [138.4259, -35.3392, 139.0361, -34.571], url: 'https://gtfs.adelaidemetro.com.au/v1/realtime/vehicle_positions', mode: 'transit' },
];
const cache = new Map();
const inflight = new Map();
const CACHE_MS = 20_000;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_FEEDS_PER_VIEW = 6;

function intersects(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function readVarint(bytes, cursor) {
  let value = 0;
  let scale = 1;
  for (let count = 0; count < 10; count += 1) {
    if (cursor.offset >= cursor.end) throw new Error('Truncated transit protobuf varint');
    const byte = bytes[cursor.offset++];
    value += (byte & 0x7f) * scale;
    if (byte < 0x80) return value;
    scale *= 128;
  }
  throw new Error('Transit protobuf varint is too long');
}

function span(bytes, cursor) {
  const length = readVarint(bytes, cursor);
  const start = cursor.offset;
  const end = start + length;
  if (!Number.isSafeInteger(end) || end > cursor.end) throw new Error('Truncated transit protobuf field');
  cursor.offset = end;
  return { offset: start, end };
}

function fields(bytes, start, end, handler) {
  const cursor = { offset: start, end };
  while (cursor.offset < end) {
    const key = readVarint(bytes, cursor);
    const field = Math.floor(key / 8);
    const wire = key & 7;
    const handled = handler(field, wire, cursor);
    if (handled) continue;
    if (wire === 0) readVarint(bytes, cursor);
    else if (wire === 1) cursor.offset += 8;
    else if (wire === 2) span(bytes, cursor);
    else if (wire === 5) cursor.offset += 4;
    else throw new Error(`Unsupported transit protobuf wire type ${wire}`);
    if (cursor.offset > end) throw new Error('Transit protobuf field exceeds message bounds');
  }
}

function readText(bytes, cursor) {
  const range = span(bytes, cursor);
  return Buffer.from(bytes.subarray(range.offset, range.end)).toString('utf8');
}

function readPosition(bytes, start, end) {
  const position = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  fields(bytes, start, end, (field, wire, cursor) => {
    if (wire !== 5) return false;
    if (cursor.offset + 4 > end) throw new Error('Truncated transit coordinate');
    const value = view.getFloat32(cursor.offset, true);
    cursor.offset += 4;
    if (field === 1) position.lat = value;
    else if (field === 2) position.lon = value;
    else if (field === 3) position.bearing = value;
    else if (field === 5) position.speed = value;
    return true;
  });
  return position;
}

function readTrip(bytes, start, end) {
  let route;
  fields(bytes, start, end, (field, wire, cursor) => {
    if (wire === 2 && field === 5) { route = readText(bytes, cursor); return true; }
    return false;
  });
  return route;
}

function readVehicleDescriptor(bytes, start, end) {
  const vehicle = {};
  fields(bytes, start, end, (field, wire, cursor) => {
    if (wire === 2 && field === 1) { vehicle.id = readText(bytes, cursor); return true; }
    if (wire === 2 && field === 2) { vehicle.label = readText(bytes, cursor); return true; }
    return false;
  });
  return vehicle;
}

function readVehicle(bytes, start, end) {
  const vehicle = {};
  fields(bytes, start, end, (field, wire, cursor) => {
    if (wire === 2 && field === 1) {
      const range = span(bytes, cursor);
      vehicle.route = readTrip(bytes, range.offset, range.end);
      return true;
    }
    if (wire === 2 && field === 2) {
      const range = span(bytes, cursor);
      vehicle.position = readPosition(bytes, range.offset, range.end);
      return true;
    }
    if (wire === 0 && field === 5) { vehicle.timestamp = readVarint(bytes, cursor); return true; }
    if (wire === 2 && field === 8) {
      const range = span(bytes, cursor);
      vehicle.descriptor = readVehicleDescriptor(bytes, range.offset, range.end);
      return true;
    }
    return false;
  });
  const p = vehicle.position ?? {};
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180 || (p.lat === 0 && p.lon === 0)) return null;
  return {
    id: vehicle.descriptor?.id || vehicle.descriptor?.label || '',
    label: vehicle.descriptor?.label || '',
    route: vehicle.route || '',
    lat: p.lat,
    lon: p.lon,
    bearing: p.bearing,
    speed: p.speed,
    timestamp: vehicle.timestamp,
  };
}

function decodeVehicles(bytes) {
  const vehicles = [];
  fields(bytes, 0, bytes.length, (field, wire, cursor) => {
    if (field !== 2 || wire !== 2) return false;
    const entity = span(bytes, cursor);
    fields(bytes, entity.offset, entity.end, (entityField, entityWire, entityCursor) => {
      if (entityField !== 4 || entityWire !== 2) return false;
      const vehicle = span(bytes, entityCursor);
      const decoded = readVehicle(bytes, vehicle.offset, vehicle.end);
      if (decoded) vehicles.push(decoded);
      return true;
    });
    return true;
  });
  return vehicles;
}

async function loadFeed(feed) {
  const existing = cache.get(feed.id);
  if (existing && Date.now() - existing.time < CACHE_MS) return existing;
  let request = inflight.get(feed.id);
  if (!request) {
    request = (async () => {
      const response = await fetch(feed.url, {
        headers: { 'User-Agent': 'Krynara-OS World View', ...(feed.headers ?? {}) },
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const declaredSize = Number(response.headers.get('content-length'));
      if (Number.isFinite(declaredSize) && declaredSize > MAX_BYTES) throw new Error('Transit feed exceeded the size limit');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_BYTES) throw new Error('Transit feed exceeded the size limit');
      // Fast path: Rust protobuf decoder. Falls back to the JS decoder below.
      if (native.isEnabled()) {
        try {
          const decoded = await native.call('/transit/decode', bytes, 5000);
          if (Array.isArray(decoded)) {
            const data = decoded.map((vehicle) => ({ ...vehicle, mode: feed.mode, source: feed.name }));
            const entry = { time: Date.now(), data };
            cache.set(feed.id, entry);
            return entry;
          }
        } catch (error) {
          log(`transit native decode unavailable for ${feed.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const data = decodeVehicles(bytes).map((vehicle) => ({ ...vehicle, mode: feed.mode, source: feed.name }));
      const entry = { time: Date.now(), data };
      cache.set(feed.id, entry);
      return entry;
    })().finally(() => inflight.delete(feed.id));
    inflight.set(feed.id, request);
  }
  return request;
}

function register(app) {
  app.get('/api/feeds/transit', async (req, res) => {
    const bbox = typeof req.query.bbox === 'string' ? req.query.bbox.split(',').map(Number) : [];
    if (bbox.length !== 4 || !bbox.every(Number.isFinite)
      || bbox[0] < -180 || bbox[2] > 180 || bbox[1] < -90 || bbox[3] > 90
      || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
      return res.status(400).json({ error: 'bbox must be west,south,east,north in geographic degrees.' });
    }
    if (bbox[2] - bbox[0] > 100 || bbox[3] - bbox[1] > 60) {
      return res.json({ vehicles: [], feeds: [], skipped: FEEDS.length, source: 'Public GTFS-Realtime operators' });
    }
    const matching = FEEDS.filter((feed) => intersects(feed.bounds, bbox)).slice(0, MAX_FEEDS_PER_VIEW);
    const results = await Promise.all(matching.map(async (feed) => {
      try {
        const entry = await loadFeed(feed);
        return { feed: feed.name, vehicles: entry.data.filter((vehicle) =>
          vehicle.lon >= bbox[0] && vehicle.lon <= bbox[2] && vehicle.lat >= bbox[1] && vehicle.lat <= bbox[3]) };
      } catch (error) {
        return { feed: feed.name, vehicles: [], error: error instanceof Error ? error.message : String(error) };
      }
    }));
    return res.json({
      vehicles: results.flatMap((result) => result.vehicles),
      feeds: results.map(({ feed, vehicles, error }) => ({ feed, count: vehicles.length, ...(error ? { error } : {}) })),
      skipped: Math.max(0, FEEDS.filter((feed) => intersects(feed.bounds, bbox)).length - MAX_FEEDS_PER_VIEW),
      source: 'Public GTFS-Realtime operators',
    });
  });
}

module.exports = { register, decodeVehicles };
