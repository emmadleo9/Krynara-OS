//! GTFS-RT vehicle-positions decoder.
//!
//! Exact port of `gateway/routes/transit.js` lines 23-153. The JavaScript
//! version walks the protobuf wire format by hand; this does the same, with
//! identical field numbers, wire types, and output field names so the gateway
//! can swap implementations without any observable difference.

pub struct Cursor {
    pub offset: usize,
    pub end: usize,
}

/// Mirrors `readVarint` from the JS decoder, kept for API parity with the
/// original module. Only the `u64` variant is used by the decoder itself.
#[allow(dead_code)]
pub fn read_varint(bytes: &[u8], cursor: &mut Cursor) -> Result<f64, String> {
    let mut value: f64 = 0.0;
    let mut scale: f64 = 1.0;
    for _ in 0..10 {
        if cursor.offset >= cursor.end {
            return Err("Truncated transit protobuf varint".to_string());
        }
        let byte = bytes[cursor.offset];
        cursor.offset += 1;
        value += (byte & 0x7f) as f64 * scale;
        if byte < 0x80 {
            return Ok(value);
        }
        scale *= 128.0;
    }
    Err("Transit protobuf varint is too long".to_string())
}

pub fn read_varint_u64(bytes: &[u8], cursor: &mut Cursor) -> Result<u64, String> {
    let mut value: u64 = 0;
    let mut shift = 0;
    for _ in 0..10 {
        if cursor.offset >= cursor.end {
            return Err("Truncated transit protobuf varint".to_string());
        }
        let byte = bytes[cursor.offset];
        cursor.offset += 1;
        value |= ((byte & 0x7f) as u64) << shift;
        if byte < 0x80 {
            return Ok(value);
        }
        shift += 7;
    }
    Err("Transit protobuf varint is too long".to_string())
}

pub fn span(bytes: &[u8], cursor: &mut Cursor) -> Result<(usize, usize), String> {
    let length = read_varint_u64(bytes, cursor)?;
    let start = cursor.offset;
    let end = start.saturating_add(length as usize);
    if end > cursor.end {
        return Err("Truncated transit protobuf field".to_string());
    }
    cursor.offset = end;
    Ok((start, end))
}

pub struct Field {
    pub number: u64,
    pub wire: u64,
}

pub fn fields<F>(bytes: &[u8], start: usize, end: usize, mut handler: F) -> Result<(), String>
where
    F: FnMut(&Field, &mut Cursor) -> Result<bool, String>,
{
    let mut cursor = Cursor { offset: start, end };
    while cursor.offset < end {
        let key = read_varint_u64(bytes, &mut cursor)?;
        let field = Field { number: key / 8, wire: key & 7 };
        let handled = handler(&field, &mut cursor)?;
        if handled {
            continue;
        }
        match field.wire {
            0 => {
                read_varint_u64(bytes, &mut cursor)?;
            }
            1 => cursor.offset += 8,
            2 => {
                span(bytes, &mut cursor)?;
            }
            5 => cursor.offset += 4,
            other => return Err(format!("Unsupported transit protobuf wire type {other}")),
        }
        if cursor.offset > end {
            return Err("Transit protobuf field exceeds message bounds".to_string());
        }
    }
    Ok(())
}

fn read_text(bytes: &[u8], cursor: &mut Cursor) -> Result<String, String> {
    let (offset, end) = span(bytes, cursor)?;
    Ok(String::from_utf8_lossy(&bytes[offset..end]).into_owned())
}

#[derive(Default, Clone)]
pub struct Position {
    pub lat: Option<f32>,
    pub lon: Option<f32>,
    pub bearing: Option<f32>,
    pub speed: Option<f32>,
}

fn read_position(bytes: &[u8], start: usize, end: usize) -> Result<Position, String> {
    let mut position = Position::default();
    fields(bytes, start, end, |field, cursor| {
        if field.wire != 5 {
            return Ok(false);
        }
        if cursor.offset + 4 > end {
            return Err("Truncated transit coordinate".to_string());
        }
        let value = f32::from_le_bytes([
            bytes[cursor.offset],
            bytes[cursor.offset + 1],
            bytes[cursor.offset + 2],
            bytes[cursor.offset + 3],
        ]);
        cursor.offset += 4;
        match field.number {
            1 => position.lat = Some(value),
            2 => position.lon = Some(value),
            3 => position.bearing = Some(value),
            5 => position.speed = Some(value),
            _ => {}
        }
        Ok(true)
    })?;
    Ok(position)
}

fn read_trip(bytes: &[u8], start: usize, end: usize) -> Result<Option<String>, String> {
    let mut route = None;
    fields(bytes, start, end, |field, cursor| {
        if field.wire == 2 && field.number == 5 {
            route = Some(read_text(bytes, cursor)?);
            return Ok(true);
        }
        Ok(false)
    })?;
    Ok(route)
}

#[derive(Default, Clone)]
pub struct VehicleDescriptor {
    pub id: Option<String>,
    pub label: Option<String>,
}

fn read_vehicle_descriptor(bytes: &[u8], start: usize, end: usize) -> Result<VehicleDescriptor, String> {
    let mut vehicle = VehicleDescriptor::default();
    fields(bytes, start, end, |field, cursor| {
        if field.wire == 2 && field.number == 1 {
            vehicle.id = Some(read_text(bytes, cursor)?);
            return Ok(true);
        }
        if field.wire == 2 && field.number == 2 {
            vehicle.label = Some(read_text(bytes, cursor)?);
            return Ok(true);
        }
        Ok(false)
    })?;
    Ok(vehicle)
}

/// Flattened, validated vehicle — exactly what `readVehicle()` returns in
/// `gateway/routes/transit.js:124-136`. Vehicles without usable coordinates are
/// dropped, matching the JavaScript guard.
#[derive(Default, Clone)]
pub struct Vehicle {
    pub id: String,
    pub label: String,
    pub route: String,
    pub lat: f32,
    pub lon: f32,
    pub bearing: Option<f32>,
    pub speed: Option<f32>,
    pub timestamp: Option<u64>,
}

#[derive(Default, Clone)]
struct RawVehicle {
    route: Option<String>,
    position: Option<Position>,
    timestamp: Option<u64>,
    descriptor: Option<VehicleDescriptor>,
}

fn parse_raw_vehicle(bytes: &[u8], start: usize, end: usize) -> Result<RawVehicle, String> {
    let mut vehicle = RawVehicle::default();
    fields(bytes, start, end, |field, cursor| {
        if field.wire == 2 && field.number == 1 {
            let (o, e) = span(bytes, cursor)?;
            vehicle.route = read_trip(bytes, o, e)?;
            return Ok(true);
        }
        if field.wire == 2 && field.number == 2 {
            let (o, e) = span(bytes, cursor)?;
            vehicle.position = Some(read_position(bytes, o, e)?);
            return Ok(true);
        }
        if field.wire == 0 && field.number == 5 {
            vehicle.timestamp = Some(read_varint_u64(bytes, cursor)?);
            return Ok(true);
        }
        if field.wire == 2 && field.number == 8 {
            let (o, e) = span(bytes, cursor)?;
            vehicle.descriptor = Some(read_vehicle_descriptor(bytes, o, e)?);
            return Ok(true);
        }
        Ok(false)
    })?;
    Ok(vehicle)
}

/// Mirrors `readVehicle()`: flatten + validate, returning `None` when the
/// JavaScript version would `return null`.
pub fn read_vehicle(bytes: &[u8], start: usize, end: usize) -> Result<Option<Vehicle>, String> {
    let raw = parse_raw_vehicle(bytes, start, end)?;

    let position = raw.position.unwrap_or_default();
    let (lat, lon) = match (position.lat, position.lon) {
        (Some(lat), Some(lon)) => (lat, lon),
        _ => return Ok(None),
    };

    let lat_finite = lat.is_finite();
    let lon_finite = lon.is_finite();
    if !lat_finite
        || !lon_finite
        || lat.abs() > 90.0
        || lon.abs() > 180.0
        || (lat == 0.0 && lon == 0.0)
    {
        return Ok(None);
    }

    // JS: vehicle.descriptor?.id || vehicle.descriptor?.label || ''
    let id = raw
        .descriptor
        .as_ref()
        .and_then(|d| d.id.clone().filter(|s| !s.is_empty()))
        .or_else(|| raw.descriptor.as_ref().and_then(|d| d.label.clone()))
        .unwrap_or_default();
    let label = raw
        .descriptor
        .as_ref()
        .and_then(|d| d.label.clone())
        .unwrap_or_default();

    Ok(Some(Vehicle {
        id,
        label,
        route: raw.route.unwrap_or_default(),
        lat,
        lon,
        bearing: position.bearing,
        speed: position.speed,
        timestamp: raw.timestamp,
    }))
}

/// Mirrors `decodeVehicles()`: field 2 (entity) → field 4 (vehicle), dropping
/// invalid vehicles.
pub fn decode_vehicles(bytes: &[u8]) -> Result<Vec<Vehicle>, String> {
    let mut vehicles = Vec::new();
    fields(bytes, 0, bytes.len(), |field, cursor| {
        if field.number != 2 || field.wire != 2 {
            return Ok(false);
        }
        let (entity_offset, entity_end) = span(bytes, cursor)?;
        fields(bytes, entity_offset, entity_end, |entity_field, entity_cursor| {
            if entity_field.number != 4 || entity_field.wire != 2 {
                return Ok(false);
            }
            let (vehicle_offset, vehicle_end) = span(bytes, entity_cursor)?;
            if let Some(decoded) = read_vehicle(bytes, vehicle_offset, vehicle_end)? {
                vehicles.push(decoded);
            }
            Ok(true)
        })?;
        Ok(true)
    })?;
    Ok(vehicles)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn encode_varint(mut value: u64, out: &mut Vec<u8>) {
        loop {
            let byte = (value & 0x7f) as u8;
            value >>= 7;
            if value == 0 {
                out.push(byte);
                return;
            }
            out.push(byte | 0x80);
        }
    }

    fn key(field: u64, wire: u64, out: &mut Vec<u8>) {
        encode_varint((field << 3) | wire, out);
    }

    fn bytes_field(field: u64, payload: &[u8], out: &mut Vec<u8>) {
        key(field, 2, out);
        encode_varint(payload.len() as u64, out);
        out.extend_from_slice(payload);
    }

    fn f32_field(field: u64, value: f32, out: &mut Vec<u8>) {
        key(field, 5, out);
        out.extend_from_slice(&value.to_le_bytes());
    }

    fn sample_feed() -> Vec<u8> {
        let mut position = Vec::new();
        f32_field(1, 40.7128, &mut position);
        f32_field(2, -74.0060, &mut position);
        f32_field(3, 90.0, &mut position);
        f32_field(5, 12.5, &mut position);

        let mut trip = Vec::new();
        bytes_field(5, b"M15", &mut trip);

        let mut descriptor = Vec::new();
        bytes_field(1, b"veh-1", &mut descriptor);
        bytes_field(2, b"Bus 1234", &mut descriptor);

        let mut vehicle = Vec::new();
        bytes_field(1, &trip, &mut vehicle);
        bytes_field(2, &position, &mut vehicle);
        key(5, 0, &mut vehicle);
        encode_varint(1_700_000_000, &mut vehicle);
        bytes_field(8, &descriptor, &mut vehicle);

        let mut entity = Vec::new();
        bytes_field(4, &vehicle, &mut entity);

        let mut feed = Vec::new();
        bytes_field(2, &entity, &mut feed);
        feed
    }

    #[test]
    fn decodes_sample_feed_with_js_parity() {
        let feed = sample_feed();
        let vehicles = decode_vehicles(&feed).expect("decode");
        assert_eq!(vehicles.len(), 1);
        let v = &vehicles[0];
        assert_eq!(v.route, "M15");
        assert_eq!(v.timestamp, Some(1_700_000_000));
        assert_eq!(v.id, "veh-1");
        assert_eq!(v.label, "Bus 1234");
        assert!((v.lat - 40.7128).abs() < 0.0001);
        assert!((v.lon + 74.0060).abs() < 0.0001);
        assert!((v.speed.unwrap() - 12.5).abs() < 0.0001);
    }

    #[test]
    fn drops_vehicles_without_coordinates() {
        // Entity 4 present but with no position submessage -> JS returns null.
        let mut vehicle = Vec::new();
        let mut trip = Vec::new();
        bytes_field(5, b"M1", &mut trip);
        bytes_field(1, &trip, &mut vehicle);

        let mut entity = Vec::new();
        bytes_field(4, &vehicle, &mut entity);

        let mut feed = Vec::new();
        bytes_field(2, &entity, &mut feed);

        assert!(decode_vehicles(&feed).expect("decode").is_empty());
    }

    #[test]
    fn rejects_truncated_varint() {
        let bytes = [0x80u8];
        let mut cursor = Cursor { offset: 0, end: 1 };
        assert!(read_varint_u64(&bytes, &mut cursor).is_err());
    }

    #[test]
    fn empty_feed_is_ok() {
        assert!(decode_vehicles(&[]).expect("decode").is_empty());
    }
}