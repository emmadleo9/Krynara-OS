// Kill ALL socialhub-server.js instances (incl. the gateway-spawned stale one),
// then start ONE fresh instance in the tweb dir and wait until it is Ready.
const { execSync, spawn } = require('child_process');

function getBridgePids() {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -like '*socialhub-server.js*' } | Select-Object -ExpandProperty ProcessId"`,
      { encoding: 'utf8' }
    ).trim();
    return out ? out.split(/\r?\n/).map(Number).filter(Boolean) : [];
  } catch { return []; }
}

for (const pid of getBridgePids()) {
  try { process.kill(pid); console.log('killed', pid); } catch (e) { console.log('kill fail', pid, e.message); }
}
setTimeout(() => {
  const child = spawn(process.execPath, ['socialhub-server.js'], {
    cwd: 'D:/Refrences and Codes/tweb',
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.on('exit', (c) => console.log('bridge exited', c));
  console.log('spawned fresh bridge pid', child.pid);
  const t0 = Date.now();
  const poll = setInterval(async () => {
    try {
      const r = await fetch('http://127.0.0.1:2787/api/state');
      const j = await r.json();
      console.log(Date.now() - t0 + 'ms state=' + j.state);
      if (j.state === 'ready') { clearInterval(poll); runTest(); }
    } catch { /* not up yet */ }
    if (Date.now() - t0 > 90000) { clearInterval(poll); console.log('TIMEOUT'); process.exit(1); }
  }, 3000);
}, 4000);

async function runTest() {
  const chats = await (await fetch('http://127.0.0.1:2787/api/chats')).json();
  console.log('CHATS =', chats.chats.length, '| first:', chats.chats[0] && chats.chats[0].title);
  const hist = await (await fetch('http://127.0.0.1:2787/api/history/' + chats.chats[0].id)).json();
  console.log('HISTORY =', hist.messages ? hist.messages.length : hist, 'messages');
  const last = hist.messages && hist.messages[hist.messages.length - 1];
  console.log('LAST MSG:', JSON.stringify(last).slice(0, 300));
  process.exit(0);
}
