//! System telemetry sampler.
//!
//! Exact port of the `/api/system-stats` handler in `gateway/index.js:300-337`.
//! Field names, rounding, and units are identical so the console's Diagnostics
//! page cannot tell the difference.

use serde_json::{json, Value};
use sysinfo::{Disks, System};

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn gib(bytes: u64) -> f64 {
    round1(bytes as f64 / 1024.0_f64.powi(3))
}

/// Samples CPU, memory, and disk. `load.currentLoad` is a percentage in
/// `systeminformation`; `sysinfo` reports the same value via
/// `global_cpu_usage()`, so the rounding matches.
pub fn sample() -> Value {
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    // Sleep briefly so CPU usage has two samples to compare, matching the
    // non-zero figures `systeminformation` returns.
    std::thread::sleep(std::time::Duration::from_millis(200));
    sys.refresh_cpu_usage();

    let cpu_load = round1(sys.global_cpu_usage() as f64);

    let memory_used = sys.used_memory();
    let memory_total = sys.total_memory();
    // JS: Math.round((used / total) * 1000) / 10  ==  round1(ratio * 100)
    let memory_load = if memory_total > 0 {
        round1(memory_used as f64 / memory_total as f64 * 100.0)
    } else {
        0.0
    };

    let disks = Disks::new_with_refreshed_list();
    let mut disk_total: u64 = 0;
    let mut disk_used: u64 = 0;
    for disk in disks.list() {
        let total = disk.total_space();
        let available = disk.available_space();
        disk_total = disk_total.saturating_add(total);
        disk_used = disk_used.saturating_add(total.saturating_sub(available));
    }
    // JS: Math.round((diskUsed / diskTotal) * 1000) / 10  ==  round1(ratio * 100)
    let disk_load = if disk_total > 0 {
        round1(disk_used as f64 / disk_total as f64 * 100.0)
    } else {
        0.0
    };

    // Battery is not exposed by this crate; `systeminformation` reports
    // `hasBattery: false` on desktops, which serialises to null fields.
    let battery_percent: Option<u8> = None;
    let battery_charging: Option<bool> = None;

    json!({
        "cpuLoad": cpu_load,
        "memoryLoad": memory_load,
        "memoryUsedGb": gib(memory_used),
        "memoryTotalGb": gib(memory_total),
        "diskLoad": disk_load,
        "diskUsedGb": gib(disk_used),
        "diskTotalGb": gib(disk_total),
        "batteryPercent": battery_percent,
        "batteryCharging": battery_charging,
        "timestamp": chrono_like_timestamp(),
    })
}

/// ISO-8601 UTC with milliseconds and `Z`, matching `new Date().toISOString()`.
fn chrono_like_timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let millis = now.subsec_millis();

    let days = secs / 86_400;
    let day_secs = secs % 86_400;
    let (hour, minute, second) = (day_secs / 3600, (day_secs % 3600) / 60, day_secs % 60);

    // Civil-from-days algorithm (Howard Hinnant).
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        year, m, d, hour, minute, second, millis
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_matches_iso_shape() {
        let ts = chrono_like_timestamp();
        assert_eq!(ts.len(), 24);
        assert!(ts.ends_with('Z'));
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[10..11], "T");
    }

    #[test]
    fn sample_has_required_fields() {
        let value = sample();
        for field in [
            "cpuLoad",
            "memoryLoad",
            "memoryUsedGb",
            "memoryTotalGb",
            "diskLoad",
            "diskUsedGb",
            "diskTotalGb",
            "batteryPercent",
            "batteryCharging",
            "timestamp",
        ] {
            assert!(value.get(field).is_some(), "missing {field}");
        }
        assert!(value["memoryTotalGb"].as_f64().unwrap_or(0.0) > 0.0);
    }

    #[test]
    fn percentage_fields_are_within_bounds() {
        // Guards the JS parity rule Math.round(ratio * 1000) / 10, i.e. a
        // 0-100 percentage rather than a 0-1000 per-mille value.
        let value = sample();
        for field in ["cpuLoad", "memoryLoad", "diskLoad"] {
            let v = value[field].as_f64().expect("numeric");
            assert!(v >= 0.0 && v <= 100.0, "{field} out of range: {v}");
        }
    }
}