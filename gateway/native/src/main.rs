//! Krynara-OS native compute sidecar.
//!
//! A zero-dependency HTTP server on 127.0.0.1:2790 that offloads the four
//! CPU-heavy jobs the Node gateway used to do in-process:
//!
//!   GET  /health            -> {"ok":true}
//!   GET  /system-stats      -> same JSON shape as /api/system-stats
//!   POST /gdelt/parse       -> body: raw .zip bytes  -> GeoJSON FeatureCollection
//!   POST /transit/decode    -> body: raw .pb bytes   -> [vehicle, ...]
//!   POST /adsb/dedupe       -> body: JSON array      -> deduped array (max 400)
//!
//! The Node gateway keeps every existing code path and falls back to it on any
//! error, so this binary is strictly additive: if it is missing, fails to bind,
//! or returns a malformed answer, behaviour is identical to today.

mod adsb;
mod gdelt;
mod stats;
mod transit;

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::Duration;

const HOST: &str = "127.0.0.1";
pub const PORT: u16 = 2790;

fn main() {
    let listener = match TcpListener::bind((HOST, PORT)) {
        Ok(listener) => listener,
        Err(error) => {
            eprintln!("[krynara-native] cannot bind {HOST}:{PORT}: {error}");
            std::process::exit(1);
        }
    };
    println!("[krynara-native] listening on http://{HOST}:{PORT}");

    for stream in listener.incoming() {
        match stream {
            Ok(stream) => {
                std::thread::spawn(move || {
                    let _ = handle(stream);
                });
            }
            Err(error) => eprintln!("[krynara-native] accept failed: {error}"),
        }
    }
}

struct Request {
    method: String,
    path: String,
    body: Vec<u8>,
}

fn read_request(stream: &mut TcpStream) -> Result<Request, String> {
    stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 8192];

    // Read headers.
    let header_end = loop {
        let read = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if read == 0 {
            return Err("connection closed before headers".to_string());
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(position) = find_subsequence(&buffer, b"\r\n\r\n") {
            break position + 4;
        }
        if buffer.len() > 64 * 1024 {
            return Err("headers too large".to_string());
        }
    };

    let header_text = String::from_utf8_lossy(&buffer[..header_end]).into_owned();
    let mut lines = header_text.split("\r\n");
    let request_line = lines.next().ok_or("missing request line")?;
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();

    let mut content_length = 0usize;
    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            if name.trim().eq_ignore_ascii_case("content-length") {
                content_length = value.trim().parse().unwrap_or(0);
            }
        }
    }

    let mut body = buffer[header_end..].to_vec();
    while body.len() < content_length {
        let read = stream.read(&mut chunk).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);

    Ok(Request { method, path, body })
}

fn find_subsequence(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|window| window == needle)
}

fn handle(mut stream: TcpStream) -> Result<(), String> {
    let request = read_request(&mut stream)?;
    let path = request.path.split('?').next().unwrap_or("").to_string();

    let (status, content_type, body) = match (request.method.as_str(), path.as_str()) {
        ("GET", "/health") => (200, "application/json", br#"{"ok":true}"#.to_vec()),
        ("GET", "/system-stats") => {
            let value = stats::sample();
            (200, "application/json", serde_json::to_vec(&value).map_err(|e| e.to_string())?)
        }
        ("POST", "/gdelt/parse") => match gdelt::parse_events_zip(&request.body) {
            Ok(value) => (200, "application/json", serde_json::to_vec(&value).map_err(|e| e.to_string())?),
            Err(error) => {
                let payload = serde_json::json!({ "error": error });
                (400, "application/json", serde_json::to_vec(&payload).map_err(|e| e.to_string())?)
            }
        },
        ("POST", "/transit/decode") => match transit::decode_vehicles(&request.body) {
            Ok(vehicles) => {
                // Already flattened by the decoder, matching readVehicle() in
                // transit.js: { id, label, route, lat, lon, bearing, speed, timestamp }.
                let json: Vec<serde_json::Value> = vehicles
                    .iter()
                    .map(|v| {
                        let mut map = serde_json::Map::new();
                        map.insert("id".to_string(), serde_json::Value::String(v.id.clone()));
                        map.insert("label".to_string(), serde_json::Value::String(v.label.clone()));
                        map.insert("route".to_string(), serde_json::Value::String(v.route.clone()));
                        map.insert("lat".to_string(), serde_json::json!(v.lat as f64));
                        map.insert("lon".to_string(), serde_json::json!(v.lon as f64));
                        if let Some(bearing) = v.bearing {
                            map.insert("bearing".to_string(), serde_json::json!(bearing as f64));
                        }
                        if let Some(speed) = v.speed {
                            map.insert("speed".to_string(), serde_json::json!(speed as f64));
                        }
                        if let Some(timestamp) = v.timestamp {
                            map.insert("timestamp".to_string(), serde_json::json!(timestamp));
                        }
                        serde_json::Value::Object(map)
                    })
                    .collect();
                (200, "application/json", serde_json::to_vec(&json).map_err(|e| e.to_string())?)
            }
            Err(error) => {
                let payload = serde_json::json!({ "error": error });
                (400, "application/json", serde_json::to_vec(&payload).map_err(|e| e.to_string())?)
            }
        },
        ("POST", "/adsb/dedupe") => match adsb::dedupe(&request.body) {
            Ok(value) => (200, "application/json", serde_json::to_vec(&value).map_err(|e| e.to_string())?),
            Err(error) => {
                let payload = serde_json::json!({ "error": error });
                (400, "application/json", serde_json::to_vec(&payload).map_err(|e| e.to_string())?)
            }
        },
        ("GET", "/") => (200, "text/plain", b"krynara-native".to_vec()),
        _ => (404, "application/json", br#"{"error":"not found"}"#.to_vec()),
    };

    let header = format!(
        "HTTP/1.1 {status} OK\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(header.as_bytes()).map_err(|e| e.to_string())?;
    stream.write_all(&body).map_err(|e| e.to_string())?;
    stream.flush().ok();
    Ok(())
}