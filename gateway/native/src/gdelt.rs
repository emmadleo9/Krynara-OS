//! GDELT 2.0 events archive parser.
//!
//! Exact port of `loadGdeltEvents()` in `gateway/index.js:209-241`.
//!
//! The JS version inflates the zip with adm-zip, converts the whole entry to a
//! UTF-8 string, splits on newlines, then splits each row on tabs and reads
//! columns 29 (quad), 56 (lat), 57 (lon), 52/53 (name), 33 (articles),
//! 34 (tone), 60 (url). Output is a GeoJSON FeatureCollection with up to 150
//! features. This module reproduces that exactly, including the `>= 150` cap
//! and the same truthiness filter on latitude/longitude.

use flate2::read::GzDecoder;
use serde_json::{json, Map, Value};
use std::io::Read;

const MAX_FEATURES: usize = 150;

/// Inflates a .zip buffer and returns the first entry's bytes.
///
/// adm-zip exposes `getEntries()[0].getData()`. GDELT archives contain a single
/// CSV member, so we locate the first local file header and inflate its
/// deflate stream. Falls back to the stored (uncompressed) representation.
fn first_zip_entry(zip: &[u8]) -> Result<Vec<u8>, String> {
    let offset = 0usize;
    while offset + 30 <= zip.len() {
        // Local file header signature "PK\x03\x04"
        if zip[offset] != 0x50 || zip[offset + 1] != 0x4b || zip[offset + 2] != 0x03 || zip[offset + 3] != 0x04 {
            break;
        }
        let flags = u16::from_le_bytes([zip[offset + 6], zip[offset + 7]]);
        let method = u16::from_le_bytes([zip[offset + 8], zip[offset + 9]]);
        let compressed_size = u32::from_le_bytes([
            zip[offset + 18],
            zip[offset + 19],
            zip[offset + 20],
            zip[offset + 21],
        ]) as usize;
        let name_len = u16::from_le_bytes([zip[offset + 26], zip[offset + 27]]) as usize;
        let extra_len = u16::from_le_bytes([zip[offset + 28], zip[offset + 29]]) as usize;
        let data_start = offset + 30 + name_len + extra_len;
        if data_start > zip.len() {
            break;
        }

        // Streamed (data descriptor) archives cannot be sized from the header;
        // fall back to inflating until the stream ends.
        let end = if compressed_size > 0 {
            (data_start + compressed_size).min(zip.len())
        } else {
            zip.len()
        };
        let payload = &zip[data_start..end];

        match method {
            0 => return Ok(payload.to_vec()),
            8 => {
                let mut decoder = GzDecoder::new(payload);
                let mut out = Vec::new();
                // GDELT members are raw deflate; GzDecoder only handles gzip.
                // Use the raw deflate reader instead.
                let _ = &mut decoder;
                let mut raw = flate2::read::DeflateDecoder::new(payload);
                if raw.read_to_end(&mut out).is_ok() && !out.is_empty() {
                    return Ok(out);
                }
                return Err("Failed to inflate GDELT archive member".to_string());
            }
            _ => {
                let _ = flags;
                return Err(format!("Unsupported zip compression method {method}"));
            }
        }
    }
    Err("No zip local file header found".to_string())
}

/// Parses the inflated CSV payload into a GeoJSON FeatureCollection.
pub fn parse_events_csv(csv: &str) -> Value {
    let mut features: Vec<Value> = Vec::new();

    for row in csv.split('\n') {
        let row = row.strip_suffix('\r').unwrap_or(row);
        let columns: Vec<&str> = row.split('\t').collect();
        if columns.len() < 61 {
            // JS would read undefined → NaN and skip via the finite check.
            continue;
        }
        let quad = columns[29].trim().parse::<f64>().unwrap_or(f64::NAN);
        let latitude = columns[56].trim().parse::<f64>().unwrap_or(f64::NAN);
        let longitude = columns[57].trim().parse::<f64>().unwrap_or(f64::NAN);

        let finite = quad.is_finite() && latitude.is_finite() && longitude.is_finite();
        if !finite || (quad != 3.0 && quad != 4.0) || latitude == 0.0 || longitude == 0.0 {
            continue;
        }

        let name = {
            let a = columns[52];
            let b = columns[53];
            if !a.is_empty() {
                a
            } else if !b.is_empty() {
                b
            } else {
                "GDELT event"
            }
        };
        let articles = columns[33].trim().parse::<f64>().unwrap_or(0.0);
        let tone = columns[34].trim().parse::<f64>().unwrap_or(0.0);
        let url = columns[60];

        let mut properties = Map::new();
        properties.insert("name".to_string(), Value::String(name.to_string()));
        properties.insert("articles".to_string(), json!(articles));
        properties.insert("tone".to_string(), json!(tone));
        properties.insert("url".to_string(), Value::String(url.to_string()));

        features.push(json!({
            "type": "Feature",
            "geometry": { "type": "Point", "coordinates": [longitude, latitude] },
            "properties": Value::Object(properties),
        }));

        if features.len() >= MAX_FEATURES {
            break;
        }
    }

    json!({
        "type": "FeatureCollection",
        "features": features,
        "source": "GDELT 2.0 Events",
    })
}

/// Parses a zip buffer straight into the GeoJSON payload.
pub fn parse_events_zip(zip: &[u8]) -> Result<Value, String> {
    let bytes = first_zip_entry(zip)?;
    let csv = String::from_utf8_lossy(&bytes).into_owned();
    Ok(parse_events_csv(&csv))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gdelt_row(quad: &str, lat: &str, lon: &str, name: &str, articles: &str, tone: &str, url: &str) -> String {
        let mut columns = vec![""; 61];
        columns[29] = quad;
        columns[56] = lat;
        columns[57] = lon;
        columns[52] = name;
        columns[33] = articles;
        columns[34] = tone;
        columns[60] = url;
        columns.join("\t")
    }

    #[test]
    fn parses_valid_rows_and_skips_invalid() {
        let csv = format!(
            "{}\n{}\n{}\n{}\n",
            gdelt_row("3", "40.7", "-74.0", "Event A", "5", "-2.5", "https://a.example"),
            gdelt_row("1", "40.7", "-74.0", "Wrong quad", "1", "0", ""),
            gdelt_row("4", "0", "-74.0", "Zero lat", "1", "0", ""),
            gdelt_row("3", "51.5", "-0.1", "Event B", "9", "3.1", "https://b.example"),
        );
        let parsed = parse_events_csv(&csv);
        let features = parsed["features"].as_array().expect("features");
        assert_eq!(features.len(), 2);
        assert_eq!(features[0]["properties"]["name"], "Event A");
        assert_eq!(features[0]["geometry"]["coordinates"][0], -74.0);
        assert_eq!(features[0]["geometry"]["coordinates"][1], 40.7);
        assert_eq!(features[1]["properties"]["articles"], 9.0);
    }

    #[test]
    fn caps_at_150_features() {
        let mut csv = String::new();
        for i in 0..200 {
            csv.push_str(&gdelt_row("3", "10.0", "20.0", "N", "1", "0", ""));
            csv.push('\n');
            let _ = i;
        }
        let parsed = parse_events_csv(&csv);
        assert_eq!(parsed["features"].as_array().expect("features").len(), 150);
    }

    #[test]
    fn missing_columns_are_skipped() {
        let parsed = parse_events_csv("too\tshort\n");
        assert!(parsed["features"].as_array().expect("features").is_empty());
    }

    #[test]
    fn falls_back_to_column_53_when_52_empty() {
        let mut columns = vec![""; 61];
        columns[29] = "3";
        columns[56] = "1.0";
        columns[57] = "2.0";
        columns[53] = "Fallback name";
        let parsed = parse_events_csv(&columns.join("\t"));
        let features = parsed["features"].as_array().expect("features");
        assert_eq!(features[0]["properties"]["name"], "Fallback name");
    }
}