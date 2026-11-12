// One-shot patcher: fixes Telegram chat loading in the tweb TDLib bridge.
const fs = require('fs');

// ---- 1. Rewrite src/telegram/chats.js: getChats + getChat per id (no loadChats race) ----
const chatsPath = 'D:/Refrences and Codes/tweb/src/telegram/chats.js';
const chatsNew = `// Telegram chats module for Social Hub.
// Lists chats and fetches chat history via the awaited TDLib client.
// FIX: use getChats (chat_list main) then getChat for EVERY returned id.
// The old loadChats + 700ms-sleep approach failed because TDLib only emits
// updateNewChat for chats not already in its local database, so after the
// first session the list came back permanently empty.
export class TelegramChats {
  constructor(client) {
    this.client = client;
    this.chatInfo = new Map(); // chatId -> full chat object
    this.onChats = () => {};
    this.onLog = () => {};
  }
  log(msg) {
    console.log(\`[telegram chats] \${msg}\`);
    this.onLog(msg);
  }
  // Fetch the main chat list (limit 50), then full details for each chat id.
  async listChats(limit = 50) {
    this.log(\`Fetching chat list (limit \${limit})...\`);
    let res;
    try {
      res = await this.client.sendAndWait({
        '@type': 'getChats',
        chat_list: { '@type': 'chatListMain' },
        limit,
      });
    } catch (err) {
      this.log(\`getChats FAILED: \${err.message}\`);
      return this.getAllChats();
    }
    this.log(\`getChats response: \${JSON.stringify(res).slice(0, 2000)}\`);
    if (res && res['@type'] === 'error') {
      this.log(\`getChats TDLib error: \${res.message}\`);
      return this.getAllChats();
    }
    const ids = (res && Array.isArray(res.chat_ids)) ? res.chat_ids : [];
    this.log(\`getChats returned \${ids.length} chat ids\`);
    if (!ids.length) return this.getAllChats();
    // getChat for every id: title, photo, last_message, unread_count, type.
    await Promise.all(ids.map((id) => this.getChat(id)));
    return this.getAllChats();
  }
  async getChat(chatId) {
    try {
      const chat = await this.client.sendAndWait({ '@type': 'getChat', chat_id: chatId });
      if (chat && chat['@type'] === 'chat') {
        this.log(\`getChat(\${chatId}): title="\${chat.title || '(no title)'}" type=\${chat.type ? chat.type['@type'] : '?'} unread=\${chat.unread_count || 0}\`);
        this.chatInfo.set(chat.id, chat);
      } else if (chat && chat['@type'] === 'error') {
        this.log(\`getChat(\${chatId}) TDLib error: \${chat.message}\`);
      }
      return chat;
    } catch (err) {
      this.log(\`getChat(\${chatId}) failed: \${err.message}\`);
      return null;
    }
  }
  /** Keep chat info fresh from live TDLib updates. */
  handle(update) {
    if (update['@type'] === 'updateNewChat' && update.chat) {
      this.chatInfo.set(update.chat.id, update.chat);
      this.onChats(this.getAllChats());
      return true;
    }
    if (update['@type'] === 'updateChatLastMessage' || update['@type'] === 'updateChatUnreadCount' || update['@type'] === 'updateChatPosition') {
      const info = this.chatInfo.get(update.chat_id);
      if (info) {
        if (update['@type'] === 'updateChatLastMessage' && update.last_message) info.last_message = update.last_message;
        if (update['@type'] === 'updateChatUnreadCount') info.unread_count = update.unread_count;
        this.onChats(this.getAllChats());
      }
      return true;
    }
    return false;
  }
  _sort() {
    return [...this.chatInfo.values()].sort((a, b) => {
      const la = a.last_message ? a.last_message.date : 0;
      const lb = b.last_message ? b.last_message.date : 0;
      return lb - la;
    });
  }
  getAllChats() {
    return this._sort().map((c) => ({
      id: c.id,
      title: c.title || \`Chat \${c.id}\`,
      type: c.type ? c.type['@type'] : 'unknown',
      unread_count: c.unread_count || 0,
      last_message: c.last_message ? this.summarize(c.last_message) : null,
    }));
  }
  summarize(m) {
    const text = m.content && m.content['@type'] === 'messageText' ? m.content.text.text : '[non-text]';
    return { id: m.id, date: m.date, text: String(text).slice(0, 80), outgoing: m.is_outgoing };
  }
  search(query) {
    const q = String(query || '').toLowerCase();
    if (!q) return this.getAllChats();
    return this.getAllChats().filter((c) => c.title.toLowerCase().includes(q));
  }
}
export default TelegramChats;
`;
fs.writeFileSync(chatsPath, chatsNew, 'utf8');
console.log('chats.js rewritten');

// ---- 2. socialhub-server.js: history limit 50 + resolve sender display names ----
const serverPath = 'D:/Refrences and Codes/tweb/socialhub-server.js';
let srv = fs.readFileSync(serverPath, 'utf8');
const oldBlock = `    const chatId = BigInt(p.split('/').pop());
    const msgs = await messages.getHistory(chatId, 30);
    return json(res, 200, { messages: msgs.map(slim).reverse() });`;
const newBlock = `    const chatId = BigInt(p.split('/').pop());
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
if (!srv.includes(oldBlock)) throw new Error('history block not found in socialhub-server.js');
srv = srv.replace(oldBlock, newBlock);
fs.writeFileSync(serverPath, srv, 'utf8');
console.log('socialhub-server.js patched');
