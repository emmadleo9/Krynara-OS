const fs = require('fs');
const p = 'D:/Refrences and Codes/tweb/socialhub-server.js';
let s = fs.readFileSync(p, 'utf8');
const subs = [
  ["    id: m.id,", "    id: String(m.id),"],
  ["    chat_id: m.chat_id,", "    chat_id: String(m.chat_id),"],
  ["    sender: m.sender_id && m.sender_id.user_id ? m.sender_id.user_id : null,",
    "    sender: m.sender_id && m.sender_id.user_id ? String(m.sender_id.user_id) : null,"],
];
for (const [oldS, newS] of subs) {
  if (!s.includes(oldS)) throw new Error('not found: ' + oldS);
  s = s.replace(oldS, newS);
}
fs.writeFileSync(p, s);
console.log('slim BigInt fix applied');
