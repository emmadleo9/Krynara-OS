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

#[derive(Default, Clone)]
pub struct Vehicle {
    pub route: Option<String>,
    pub position: Option<Position>,
    pub timestamp: Option<u64>,
    pub descriptor: Option<VehicleDescriptor>,
}

pub fn read_vehicle(bytes: &[u8], start: usize, end: usize) -> Result<Vehicle, String> {
    let mut vehicle = Vehicle::default();
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

/// Mirrors `decodeVehicles()`: field 2 (entity) → field 4 (vehicle).
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
            let decoded = read_vehicle(bytes, vehicle_offset, vehicle_end)?;
            vehicles.push(decoded);
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
        assert_eq!(v.route.as_deref(), Some("M15"));
        assert_eq!(v.timestamp, Some(1_700_000_000));
        let d = v.descriptor.as_ref().expect("descriptor");
        assert_eq!(d.id.as_deref(), Some("veh-1"));
        assert_eq!(d.label.as_deref(), Some("Bus 1234"));
        let p = v.position.as_ref().expect("position");
        assert!((p.lat.unwrap() - 40.7128).abs() < 0.0001);
        assert!((p.lon.unwrap() + 74.0060).abs() < 0.0001);
        assert!((p.speed.unwrap() - 12.5).abs() < 0.0001);
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