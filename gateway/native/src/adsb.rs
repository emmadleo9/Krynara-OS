//! ADS-B aircraft deduplication.
//!
//! Exact port of the regional-sweep merge in `loadAircraft()`
//! (`gateway/index.js:188-206`). The JavaScript uses a `Map`:
//!
//! ```js
//! for (const item of data.ac || []) {
//!   if (item.hex) aircraft.set(item.hex, item);
//!   if (aircraft.size >= 400) break;
//! }
//! return { ac: [...aircraft.values()].slice(0, 400), total: aircraft.size, ... };
//! ```
//!
//! `Map` semantics that matter for parity:
//!   * keys are the raw `hex` string — case-sensitive, no normalisation
//!   * a repeated `hex` overwrites the value but keeps the first position
//!   * entries without a truthy `hex` are never inserted, so they are dropped
//!   * iteration is insertion order, capped at 400 entries
//!
//! The gateway still performs the network fetches; this replaces only the merge.

use serde_json::Value;
use std::collections::HashMap;

pub const MAX_AIRCRAFT: usize = 400;

/// Merges a flat array of aircraft into the deduped array.
pub fn dedupe(body: &[u8]) -> Result<Value, String> {
    let parsed: Value = serde_json::from_slice(body).map_err(|e| e.to_string())?;
    let array = parsed.as_array().ok_or("expected a JSON array of aircraft")?;

    let mut index: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<Value> = Vec::new();

    for item in array {
        // JS: if (item.hex) — a non-string or empty hex is skipped entirely.
        let hex = match item.get("hex").and_then(|value| value.as_str()) {
            Some(hex) if !hex.is_empty() => hex.to_string(),
            _ => continue,
        };

        match index.get(&hex) {
            Some(&position) => out[position] = item.clone(),
            None => {
                index.insert(hex, out.len());
                out.push(item.clone());
                if out.len() >= MAX_AIRCRAFT {
                    break;
                }
            }
        }
    }

    Ok(Value::Array(out))
}

/// Merges pre-fetched regional batches with the same semantics, stopping as
/// soon as 400 unique aircraft have been collected.
pub fn merge_batches(batches: &[Value]) -> Value {
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut out: Vec<Value> = Vec::new();

    'outer: for batch in batches {
        let Some(items) = batch.as_array() else { continue };
        for item in items {
            let hex = match item.get("hex").and_then(|value| value.as_str()) {
                Some(hex) if !hex.is_empty() => hex.to_string(),
                _ => continue,
            };
            match index.get(&hex) {
                Some(&position) => out[position] = item.clone(),
                None => {
                    index.insert(hex, out.len());
                    out.push(item.clone());
                    if out.len() >= MAX_AIRCRAFT {
                        break 'outer;
                    }
                }
            }
        }
    }

    Value::Array(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn aircraft(hex: &str, marker: &str) -> Value {
        json!({ "hex": hex, "marker": marker })
    }

    #[test]
    fn dedupes_and_keeps_last_value_at_first_position() {
        let body = serde_json::to_vec(&vec![
            aircraft("ABC123", "first"),
            aircraft("DEF456", "other"),
            aircraft("ABC123", "second"),
        ])
        .unwrap();

        let result = dedupe(&body).expect("dedupe");
        let array = result.as_array().expect("array");

        assert_eq!(array.len(), 2);
        assert_eq!(array[0]["hex"], "ABC123");
        assert_eq!(array[0]["marker"], "second");
        assert_eq!(array[1]["hex"], "DEF456");
    }

    #[test]
    fn hex_is_case_sensitive() {
        let body = serde_json::to_vec(&vec![aircraft("abc123", "lower"), aircraft("ABC123", "upper")]).unwrap();
        let result = dedupe(&body).expect("dedupe");
        assert_eq!(result.as_array().expect("array").len(), 2);
    }

    #[test]
    fn drops_items_without_hex() {
        let body = serde_json::to_vec(&vec![
            json!({ "lat": 1.0 }),
            aircraft("ABC123", "kept"),
            json!({ "hex": "" }),
            json!({ "hex": 42 }),
        ])
        .unwrap();

        let result = dedupe(&body).expect("dedupe");
        let array = result.as_array().expect("array");
        assert_eq!(array.len(), 1);
        assert_eq!(array[0]["hex"], "ABC123");
    }

    #[test]
    fn caps_at_400_unique() {
        let items: Vec<Value> = (0..500).map(|i| aircraft(&format!("H{i}"), "x")).collect();
        let body = serde_json::to_vec(&items).unwrap();
        let result = dedupe(&body).expect("dedupe");
        assert_eq!(result.as_array().expect("array").len(), 400);
    }

    #[test]
    fn merge_stops_early_at_400() {
        let batch_a: Vec<Value> = (0..300).map(|i| aircraft(&format!("A{i}"), "x")).collect();
        let batch_b: Vec<Value> = (0..300).map(|i| aircraft(&format!("B{i}"), "x")).collect();
        let merged = merge_batches(&[json!(batch_a), json!(batch_b)]);
        assert_eq!(merged.as_array().expect("array").len(), 400);
    }

    #[test]
    fn rejects_non_array() {
        assert!(dedupe(br#"{"hex":"a"}"#).is_err());
    }
}