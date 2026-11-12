const fs = require('fs');
const p = 'D:/Refrences and Codes/tweb/socialhub-server.js';
let s = fs.readFileSync(p, 'utf8');
const oldBlock = `    const chatId = BigInt(p.split('/').pop());
    const msgs = await messages.getHistory(chatId, 50);
    const slimmed = msgs.map(slim).reverse();
    // Resolve sender display names (getChat on a user id returns the private
    // chat whose title is the user's name). Cached inside TelegramChats.
    for (const m of slimmed) {
      if (m.sender) {
        const chat = await chats.getChat(BigInt(m.sender));
        m.senderName = chat && chat.title ? chat.title : String(m.sender);
      }
    }
    return json(res, 200, { messages: slimmed });`;
const newBlock = `    const chatId = BigInt(p.split('/').pop());
    const msgs = await messages.getHistory(chatId, 50);
    const slimmed = msgs.map(slim).reverse();
    // Resolve sender display names (getChat on a user id returns the private
    // chat whose title is the user's name). Cached inside TelegramChats.
    // NOTE: never return raw TDLib objects to json() — BigInts crash stringify.
    for (const m of slimmed) {
      if (m.sender) {
        const chat = await chats.getChat(BigInt(m.sender));
        m.senderName = chat && chat.title ? chat.title : String(m.sender);
      }
    }
    return json(res, 200, JSON.parse(JSON.stringify({ messages: slimmed })));`;
if (!s.includes(oldBlock)) throw new Error('history block not found');
s = s.replace(oldBlock, newBlock);
fs.writeFileSync(p, s);
console.log('history serialization hardened');
