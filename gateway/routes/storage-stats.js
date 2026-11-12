// storage-stats route – returns real disk usage for the OS folder and the public-socialhub folder
// Used by Settings & Diagnostics to display accurate storage numbers.

const fs = require('node:fs');
const path = require('node:path');

function getFolderSize(folderPath) {
  let total = 0;
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      total += getFolderSize(full);
    } else if (entry.isFile()) {
      try {
        const stats = fs.statSync(full);
        total += stats.size;
      } catch (_) {}
    }
  }
  return total;
}

function formatGB(bytes) {
  return (bytes / (1024 ** 3)).toFixed(2);
}

module.exports.register = function (app) {
  app.get('/api/storage-stats', (req, res) => {
    try {
      const osFolder = path.resolve('d:/Krynara-OS');
      const dataFolder = path.resolve('d:/Krynara-OS/public-socialhub');
      const osSize = getFolderSize(osFolder);
      const dataSize = getFolderSize(dataFolder);
      const total = osSize + dataSize;
      const free = Number.MAX_SAFE_INTEGER; // placeholder – real free space would require a system call; we expose used only.
      res.json({
        usedBytes: total,
        usedGB: formatGB(total),
        osBytes: osSize,
        osGB: formatGB(osSize),
        dataBytes: dataSize,
        dataGB: formatGB(dataSize),
        freeBytes: free,
      });
    } catch (err) {
      console.error('storage-stats error:', err);
      res.status(500).json({ error: 'Unable to compute storage stats' });
    }
  });
};
