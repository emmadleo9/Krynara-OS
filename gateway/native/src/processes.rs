//! Process list sampler.
//!
//! Replacement for `systeminformation`'s `si.processes()`, which shells out to
//! `wmic` on Windows and costs seconds per call. `sysinfo` reads the same data
//! from the OS APIs.
//!
//! Output matches the shape the gateway already consumes in
//! `gateway/routes/system-tasks.js`:
//! `{ processes: [{pid, name, cpu, memory, memMb, status, user}], total, cpuTotal, memUsedGb, memTotalGb, updatedAt }`

use serde_json::{json, Value};
use sysinfo::System;

const MAX_ROWS: usize = 200;

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

pub fn sample() -> Value {
    // refresh_processes + memory, but not CPU lists (not needed here).
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);

    let mem_total = sys.total_memory();
    let mem_used = sys.used_memory();

    let mut rows: Vec<Value> = sys
        .processes()
        .iter()
        .map(|(pid, process)| {
            // sysinfo 0.33 reports memory in bytes; si reports RSS in bytes too.
            let mem_rss = process.memory();
            let mem_mb = mem_rss / 1024 / 1024;
            // si reports process.cpu as a percentage of a single core.
            let cpu = process.cpu_usage();
            // si's `mem` is percent of total RAM.
            let memory_percent = if mem_total > 0 { mem_rss as f64 / mem_total as f64 * 100.0 } else { 0.0 };

            let status = match process.status() {
                sysinfo::ProcessStatus::Run => "running",
                sysinfo::ProcessStatus::Sleep => "sleeping",
                sysinfo::ProcessStatus::Idle => "idle",
                sysinfo::ProcessStatus::Stop => "stopped",
                sysinfo::ProcessStatus::Zombie => "zombie",
                sysinfo::ProcessStatus::Dead => "dead",
                sysinfo::ProcessStatus::LockBlocked => "blocked",
                sysinfo::ProcessStatus::Parked => "parked",
                sysinfo::ProcessStatus::UninterruptibleDiskSleep => "disk-sleep",
                _ => "unknown",
            };

            json!({
                "pid": pid.as_u32(),
                "name": process.name().to_string_lossy(),
                "cpu": round1(cpu as f64),
                "memory": round1(memory_percent),
                "memMb": mem_mb,
                "status": status,
                "user": process.user_id().map(|u| u.to_string()).unwrap_or_default(),
            })
        })
        .collect();

    // Sort by cpu desc, then memory desc — same as the JS comparator.
    rows.sort_by(|a, b| {
        let cpu_cmp = b["cpu"].as_f64().unwrap_or(0.0).partial_cmp(&a["cpu"].as_f64().unwrap_or(0.0));
        match cpu_cmp {
            Some(std::cmp::Ordering::Equal) | None => b["memory"]
                .as_f64()
                .unwrap_or(0.0)
                .partial_cmp(&a["memory"].as_f64().unwrap_or(0.0))
                .unwrap_or(std::cmp::Ordering::Equal),
            Some(ordering) => ordering,
        }
    });
    rows.truncate(MAX_ROWS);

    json!({
        "processes": rows,
        "total": sys.processes().len(),
        "cpuTotal": round1(sys.global_cpu_usage() as f64),
        "memUsedGb": round1(mem_used as f64 / 1024.0_f64.powi(3)),
        "memTotalGb": round1(mem_total as f64 / 1024.0_f64.powi(3)),
        "updatedAt": crate::stats::now_iso8601(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sample_has_expected_shape() {
        let value = sample();
        assert!(value["processes"].is_array());
        assert!(value["total"].as_u64().unwrap_or(0) > 0);
        assert!(value["memTotalGb"].as_f64().unwrap_or(0.0) > 0.0);
        assert!(value["updatedAt"].as_str().unwrap_or("").ends_with('Z'));
    }

    #[test]
    fn rows_are_capped_and_sorted() {
        let value = sample();
        let rows = value["processes"].as_array().expect("processes");
        assert!(rows.len() <= MAX_ROWS);
        for pair in rows.windows(2) {
            let a = pair[0]["cpu"].as_f64().unwrap_or(0.0);
            let b = pair[1]["cpu"].as_f64().unwrap_or(0.0);
            assert!(a >= b, "rows not sorted by cpu desc: {a} < {b}");
        }
    }
}