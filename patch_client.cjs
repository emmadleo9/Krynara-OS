const fs = require('fs');
const p = 'D:/Refrences and Codes/tweb/src/telegram/client.js';
let s = fs.readFileSync(p, 'utf8');
const count = (s.match(/JSON\.stringify\(obj\)/g) || []).length;
if (count < 2) throw new Error('expected 2 stringify sites, found ' + count);
// BigInt-safe serializer for every TDLib request (chat_id etc. are BigInt).
s = s.replace(/JSON\.stringify\(obj\)/g, "bigJson(obj)");
if (!s.includes('function bigJson')) {
  s += `\n// TDLib ids are BigInts — JSON.stringify throws on them, so stringify safely.\nfunction bigJson(obj) {\n  return JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? String(v) : v));\n}\n`;
}
fs.writeFileSync(p, s);
console.log('client.js patched,', count, 'sites');
