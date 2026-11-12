const fs = require('fs');
const p = 'D:/Refrences and Codes/tweb/socialhub-server.js';
let s = fs.readFileSync(p, 'utf8');
const oldFn = `function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
}`;
const newFn = `function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', ...CORS });
  // TDLib ids are BigInts — stringify them safely on EVERY response.
  const safe = JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? String(v) : v));
  res.end(safe);
}`;
if (!s.includes(oldFn)) throw new Error('json fn not found');
s = s.replace(oldFn, newFn);
// revert the redundant double-stringify on history
s = s.replace("return json(res, 200, JSON.parse(JSON.stringify({ messages: slimmed })));",
  "return json(res, 200, { messages: slimmed });");
fs.writeFileSync(p, s);
console.log('json() BigInt-safe');
