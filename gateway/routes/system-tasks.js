/**
 * KRYNARA Task Control Center — running processes + hardware stats + ADB phone devices.
 */
const { execFile } = require('node:child_process');
const si = require('systeminformation');
const native = require('../native/client');

let listCache = null;
let listCacheTime = 0;

async function processList() {
  if (listCache && Date.now() - listCacheTime < 2500) return listCache;

  // Fast path: Rust sysinfo sampler (no wmic subprocess). Falls back to
  // systeminformation below on any failure.
  if (native.isEnabled()) {
    try {
      const result = await native.call('/system-processes', undefined, 5000);
      if (result && Array.isArray(result.processes)) {
        listCache = result;
        listCacheTime = Date.now();
        return listCache;
      }
    } catch (error) {
      console.warn(`[system-tasks] native process list unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const [load, mem] = await Promise.all([si.currentLoad(), si.mem()]);
  const cpuTotal = load.currentLoad || 0;
  const procs = await si.processes();
  const rows = procs.list
    .map((p) => ({
      pid: p.pid,
      name: p.name,
      cpu: Math.round((p.cpu || 0) * 10) / 10,
      memory: Math.round((p.mem || 0) * 10) / 10,
      memMb: Math.round(((p.memRss || 0) * mem.total) / 100 / 1024 / 1024),
      status: p.state || 'running',
      user: p.user || '',
    }))
    .sort((a, b) => b.cpu - a.cpu || b.memory - a.memory)
    .slice(0, 200);
  listCache = {
    processes: rows,
    total: procs.all,
    cpuTotal: Math.round(cpuTotal * 10) / 10,
    memUsedGb: Math.round((mem.used / 1024 ** 3) * 10) / 10,
    memTotalGb: Math.round((mem.total / 1024 ** 3) * 10) / 10,
    updatedAt: new Date().toISOString(),
  };
  listCacheTime = Date.now();
  return listCache;
}

function adbDevices() {
  return new Promise((resolve) => {
    execFile('adb', ['devices'], { timeout: 4000 }, (error, stdout) => {
      if (error) return resolve([]);
      const ids = String(stdout).split(/\r?\n/).slice(1)
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 2 && parts[1] === 'device')
        .map((parts) => parts[0]);
      resolve(ids);
    });
  });
}

function adbProcesses(deviceId) {
  return new Promise((resolve) => {
    execFile('adb', ['-s', deviceId, 'shell', 'ps', '-A'], { timeout: 6000 }, (error, stdout) => {
      if (error) return resolve([]);
      const rows = String(stdout).split(/\r?\n/).slice(1).map((line) => {
        const parts = line.trim().split(/\s+/);
        return { pid: Number(parts[1]) || 0, user: parts[0] || '', name: parts[parts.length - 1] || '', cpu: 0, memory: 0, status: 'device' };
      }).filter((row) => row.name).slice(0, 200);
      resolve(rows);
    });
  });
}

module.exports = {
  register(app) {
    app.get('/api/system-tasks', async (_req, res) => {
      try {
        res.json(await processList());
      } catch (error) {
        res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.get('/api/system-tasks/devices', async (_req, res) => {
      try {
        const ids = await adbDevices();
        res.json({ devices: ids.map((id) => ({ id, platform: 'android' })) });
      } catch (error) {
        res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.get('/api/system-tasks/device/:id', async (req, res) => {
      try {
        const rows = await adbProcesses(String(req.params.id).slice(0, 64));
        res.json({ device: req.params.id, processes: rows });
      } catch (error) {
        res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
      }
    });

    app.post('/api/system-tasks/kill', (req, res) => {
      const pid = Number(req.body?.pid);
      if (!Number.isInteger(pid) || pid <= 0) return res.status(400).json({ error: 'Valid pid required.' });
      const { exec } = require('node:child_process');
      const command = process.platform === 'win32' ? `taskkill /PID ${pid} /F` : `kill -9 ${pid}`;
      exec(command, { timeout: 5000 }, (error) => {
        if (error) return res.status(500).json({ error: error.message });
        res.json({ killed: pid });
      });
    });
  },
};
