//! ADS-B aircraft deduplication.
//!
//! Port of the regional-sweep merge in `loadAircraft()`
//! (`gateway/index.js:188-206`): insert by `hex`, keep the first occurrence,
//! stop once 400 unique aircraft have been collected, then return at most 400.
//!
//! The gateway still performs the network fetches; this only replaces the
//! merge loop, which is where the per-aircraft object churn lives.

use serde_json::Value;
use std::collections::HashSet;

pub const MAX_AIRCRAFT: usize = 400;

/// Accepts a JSON array of aircraft objects and returns the deduped array.
pub fn dedupe(body: &[u8]) -> Result<Value, String> {
    let parsed: Value = serde_json::from_slice(body).map_err(|e| e.to_string())?;
    let array = parsed.as_array().ok_or("expected a JSON array of aircraft")?;

    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<Value> = Vec::new();

    for item in array {
        let hex = item
            .get("hex")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .trim()
            .to_lowercase();

        if !hex.is_empty() && !seen.insert(hex) {
            continue;
        }

        out.push(item.clone());
        if out.len() >= MAX_AIRCRAFT {
            break;
        }
    }

    Ok(Value::Array(out))
}

/// Merges pre-fetched regional batches, mirroring the JS loop that breaks as
/// soon as 400 unique aircraft are reached.
pub fn merge_batches(batches: &[Value]) -> Value {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out: Vec<Value> = Vec::new();

    for batch in batches {
        let Some(items) = batch.as_array() else { continue };
        for item in items {
            let hex = item
                .get("hex")
                .and_then(|value| value.as_str())
                .unwrap_or("")
                .trim()
                .to_lowercase();
            if !hex.is_empty() && !seen.insert(hex) {
                continue;
            }
            out.push(item.clone());
            if out.len() >= MAX_AIRCRAFT {
                return Value::Array(out);
            }
        }
    }

    Value::Array(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn aircraft(hex: &str) -> Value {
        json!({ "hex": hex, "lat": 40.0, "lon": -74.0 })
    }

    #[test]
    fn dedupes_by_hex_case_insensitively() {
        let body = serde_json::to_vec(&vec![aircraft("ABC123"), aircraft("abc123"), aircraft("DEF456")]).unwrap();
        let result = dedupe(&body).expect("dedupe");
        let array = result.as_array().expect("array");
        assert_eq!(array.len(), 2);
        assert_eq!(array[0]["hex"], "ABC123");
        assert_eq!(array[1]["hex"], "DEF456");
    }

    #[test]
    fn caps_at_400() {
        let items: Vec<Value> = (0..500).map(|i| aircraft(&format!("H{i:06X}"))).collect();
        let body = serde_json::to_vec(&items).unwrap();
        let result = dedupe(&body).expect("dedupe");
        assert_eq!(result.as_array().expect("array").len(), 400);
    }

    #[test]
    fn keeps_items_without_hex() {
        let body = serde_json::to_vec(&vec![json!({ "lat": 1.0 }), json!({ "lat": 2.0 })]).unwrap();
        let result = dedupe(&body).expect("dedupe");
        assert_eq!(result.as_array().expect("array").len(), 2);
    }

    #[test]
    fn merge_stops_early_at_400() {
        let batch_a: Vec<Value> = (0..300).map(|i| aircraft(&format!("A{i:06X}"))).collect();
        let batch_b: Vec<Value> = (0..300).map(|i| aircraft(&format!("B{i:06X}"))).collect();
        let merged = merge_batches(&[serde_json::json!(batch_a), serde_json::json!(batch_b)]);
        assert_eq!(merged.as_array().expect("array").len(), 400);
    }

    #[test]
    fn rejects_non_array() {
        assert!(dedupe(br#"{"hex":"a"}"#).is_err());
    }
}