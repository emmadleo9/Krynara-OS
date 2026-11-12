const fs = require('fs');
const p = 'D:/Refrences and Codes/tweb/socialhub-server.js';
let s = fs.readFileSync(p, 'utf8');
const oldLoop = `    for (const m of slimmed) {
      if (m.sender) {
        const chat = await chats.getChat(BigInt(m.sender));
        m.senderName = chat && chat.title ? chat.title : String(m.sender);
      }
    }`;
const newLoop = `    await Promise.all(slimmed.map(async (m) => {
      if (!m.sender) return;
      const chat = await chats.getChat(BigInt(m.sender));
      m.senderName = chat && chat.title ? chat.title : String(m.sender);
    }));`;
// normalize CRLF just in case
if (!s.includes(oldLoop)) {
  s = s.replace(/\r\n/g, '\n');
  fs.writeFileSync(p, s);
  if (!s.includes(oldLoop)) throw new Error('loop not found');
}
s = s.replace(oldLoop, newLoop);
fs.writeFileSync(p, s);
console.log('sender lookup parallelized');
