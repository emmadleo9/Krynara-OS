/**
 * Read saved-logins metadata (origin_url + username) from Profile 16's Login Data SQLite copy.
 * NOTE: passwords themselves are encrypted with DPAPI tied to the OS user — Chrome 80+ uses
 * AES-GCM with a key in Local State encrypted via DPAPI. We decrypt via PowerShell DPAPI.
 * This reads only what the user's own Chrome already stores for their own account.
 */
import { createRequire } from 'node:module';
import { execSync, exec } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { STORAGE_ROOT } from './storage-path.mjs';

const DB = process.env.TEMP + '\\LD-copy';
if (!existsSync(DB)) { console.log('copy Login Data first'); process.exit(1); }

// better-sqlite3 may not be present globally; use node:sqlite if Node >= 22
let rows;
try {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(DB, { readOnly: true });
  rows = db.prepare('SELECT origin_url, username_value, password_value FROM logins').all();
} catch (error) {
  console.log('node:sqlite unavailable:', error.message.slice(0, 60));
  process.exit(1);
}
console.log('saved logins found:', rows.length);

// decrypt: chrome v80+ = AES-256-GCM, key = "DPAPI" prefixed key in Local State → decrypt with PowerShell
function getMasterKey() {
  const localState = JSON.parse(readFileSync('C:/Users/User/AppData/Local/Google/Chrome/User Data/Local State', 'utf8'));
  const encrypted = localState.os_crypt?.encrypted_key;
  if (!encrypted) return null;
  const blob = Buffer.from(encrypted, 'base64').slice(5); // strip DPAPI prefix
  // PowerShell: Unprotect via [Security.Cryptography.ProtectedData]
  const b64 = blob.toString('base64');
  const ps = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${b64}'), $null, 'CurrentUser'))`;
  const out = execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf8' }).trim();
  return Buffer.from(out, 'base64');
}

function decryptGcm(buffer, masterKey) {
  try {
    if (buffer.slice(0, 3).toString() === 'v10' || buffer.slice(0, 3).toString() === 'v11') {
      const nonce = buffer.slice(3, 15);
      const payload = buffer.slice(15, -16);
      const tag = buffer.slice(-16);
      // WebCrypto AES-GCM decrypt
      return crypto.subtle.importKey('raw', masterKey, 'AES-GCM', false, ['decrypt']).then((key) =>
        crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, Buffer.concat([payload, tag])));
    }
    return null;
  } catch { return null; }
}

const masterKey = getMasterKey();
if (!masterKey) { console.log('no master key'); process.exit(1); }
console.log('master key unlocked ✓');

const creds = {};
for (const row of rows) {
  if (!row.username_value) continue;
  const host = new URL(row.origin_url ?? 'http://x').hostname;
  const decrypted = await decryptGcm(row.password_value, masterKey);
  creds[host] = creds[host] ?? [];
  creds[host].push({ user: row.username_value, pass: decrypted ? Buffer.from(await decrypted).toString('utf8') : '(undecryptable)' });
}
mkdirSync(path.join(STORAGE_ROOT, 'config'), { recursive: true });
writeFileSync(path.join(STORAGE_ROOT, 'config', 'chrome-logins.json'), JSON.stringify(creds, null, 2));
for (const [host, entries] of Object.entries(creds)) {
  console.log(`${host}: ${entries.map((e) => e.user).join(', ')}`);
}
console.log('full creds →', path.join(STORAGE_ROOT, 'config', 'chrome-logins.json'), '(gitignored, local only)');
process.exit(0);
