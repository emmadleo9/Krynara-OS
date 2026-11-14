/**
 * TDLib-backed `chats` and `messages` implementations.
 *
 * The previous bridge referenced these objects but never defined them, so every
 * chat/history/send endpoint threw. These are the missing implementations.
 */

/** Normalises a TDLib chat into the shape the console expects. */
function slimChat(chat) {
  const type = chat.type || {};
  let kind = 'private';
  if (type['@type'] === 'chatTypeBasicGroup') kind = 'group';
  else if (type['@type'] === 'chatTypeSupergroup') kind = type.is_channel ? 'channel' : 'group';
  else if (type['@type'] === 'chatTypeSecret') kind = 'private';

  return {
    id: String(chat.id),
    title: chat.title || '',
    type: kind,
    isChannel: Boolean(type.is_channel),
    verified: Boolean(chat.verification_status?.is_verified),
    lastMessage: chat.last_message?.content?.text || '',
    unreadCount: chat.unread_count || 0,
  };
}

export function createChats(client) {
  const userCache = new Map();

  async function listChats(limit = 100) {
    const result = await client.sendAndWait(
      { '@type': 'getChats', chat_list: { '@type': 'chatListMain' }, limit: Math.min(Math.max(limit, 1), 200) },
      20000,
    );
    const ids = result?.chat_ids || [];
    const chats = [];
    for (const id of ids) {
      try {
        const chat = await client.sendAndWait({ '@type': 'getChat', chat_id: id }, 10000);
        if (chat && chat['@type'] === 'chat') chats.push(slimChat(chat));
      } catch {
        /* skip chats that vanish mid-listing */
      }
    }
    return chats;
  }

  async function getUser(id) {
    const key = String(id);
    if (userCache.has(key)) return userCache.get(key);
    try {
      const user = await client.sendAndWait({ '@type': 'getUser', user_id: Number(id) }, 10000);
      if (user && user['@type'] === 'user') {
        userCache.set(key, user);
        return user;
      }
    } catch {
      /* unknown user */
    }
    return null;
  }

  async function createGroup(title, userIds = []) {
    const features = [
      { '@type': 'chatFeature', name: 'Member limit', max_members: 200000 },
    ];
    const result = await client.sendAndWait(
      {
        '@type': 'createNewBasicGroupChat',
        user_ids: userIds.map(Number).filter((n) => Number.isFinite(n)),
        title: String(title),
        message_auto_delete_time: 0,
        ...({ features } ? {} : {}),
      },
      20000,
    );
    return slimChat(result);
  }

  async function createChannel(title, description = '') {
    const result = await client.sendAndWait(
      {
        '@type': 'createNewSupergroupChat',
        title: String(title),
        is_forum: false,
        is_channel: true,
        description: String(description),
        location: null,
        message_auto_delete_time: 0,
      },
      20000,
    );
    return slimChat(result);
  }

  return { listChats, getUser, slimChat };
}

export function createMessages(client) {
  async function getHistory(chatId, limit = 60) {
    const result = await client.sendAndWait(
      {
        '@type': 'getChatHistory',
        chat_id: Number(chatId),
        from_message_id: 0,
        offset: 0,
        limit: Math.min(Math.max(limit, 1), 100),
        only_local: false,
      },
      20000,
    );
    return result?.messages || [];
  }

  async function sendMessage(chatId, text, replyToId) {
    const request = {
      '@type': 'sendMessage',
      chat_id: Number(chatId),
      message_thread_id: 0,
      reply_to: replyToId
        ? { '@type': 'inputMessageReplyToMessage', message_id: Number(replyToId) }
        : null,
      options: null,
      reply_markup: null,
      input_message_content: {
        '@type': 'inputMessageText',
        text: { '@type': 'formattedText', text: String(text ?? '') },
        link_preview_options: null,
      },
    };
    const result = await client.sendAndWait(request, 20000);
    if (result?.['@type'] === 'message') return result;
    // TDLib often returns an UpdateMessageSent wrapper.
    return result?.message || null;
  }

  async function editMessage(chatId, messageId, text) {
    return client.sendAndWait(
      {
        '@type': 'editMessageText',
        chat_id: Number(chatId),
        message_id: Number(messageId),
        reply_markup: null,
        input_message_content: {
          '@type': 'inputMessageText',
          text: { '@type': 'formattedText', text: String(text ?? '') },
          link_preview_options: null,
        },
      },
      20000,
    );
  }

  async function deleteMessages(chatId, messageIds, revoke = true) {
    const ids = (Array.isArray(messageIds) ? messageIds : [messageIds]).map(Number).filter(Number.isFinite);
    return client.sendAndWait(
      { '@type': 'deleteMessages', chat_id: Number(chatId), message_ids: ids, revoke: Boolean(revoke) },
      20000,
    );
  }

  async function pinMessage(chatId, messageId, silent = false) {
    return client.sendAndWait(
      {
        '@type': 'pinChatMessage',
        chat_id: Number(chatId),
        message_id: Number(messageId),
        disable_notification: Boolean(silent),
        only_for_self: false,
      },
      20000,
    );
  }

  async function forwardMessages(toChatId, fromChatId, messageIds) {
    const ids = (Array.isArray(messageIds) ? messageIds : [messageIds]).map(Number).filter(Number.isFinite);
    return client.sendAndWait(
      {
        '@type': 'forwardMessages',
        chat_id: Number(toChatId),
        from_chat_id: Number(fromChatId),
        message_ids: ids,
        disable_notification: false,
        only_preview: false,
      },
      25000,
    );
  }

  async function addReaction(chatId, messageId, emoji) {
    return client.sendAndWait(
      {
        '@type': 'addMessageReaction',
        chat_id: Number(chatId),
        message_id: Number(messageId),
        reaction_type: { '@type': 'reactionTypeEmoji', emoji: String(emoji) },
        is_big: false,
        update_recent_reactions: true,
      },
      20000,
    );
  }

  async function getCallbackQueryAnswer(chatId, messageId, data) {
    return client.sendAndWait(
      {
        '@type': 'getCallbackQueryAnswer',
        chat_id: Number(chatId),
        message_id: Number(messageId),
        payload: { '@type': 'callbackQueryPayloadData', data: String(data ?? '') },
      },
      20000,
    );
  }

  async function downloadFile(fileId) {
    const id = Number(fileId);
    if (!Number.isFinite(id)) throw new Error('A numeric file id is required');
    return client.sendAndWait(
      { '@type': 'downloadFile', file_id: id, priority: 1, offset: 0, limit: 0, synchronous: true },
      120000,
    );
  }

  async function getFile(fileId) {
    const id = Number(fileId);
    if (!Number.isFinite(id)) return null;
    try {
      const file = await client.sendAndWait({ '@type': 'getFile', file_id: id }, 10000);
      return file && file['@type'] === 'file' ? file : null;
    } catch {
      return null;
    }
  }

  return {
    getHistory,
    sendMessage,
    editMessage,
    deleteMessages,
    pinMessage,
    forwardMessages,
    addReaction,
    getCallbackQueryAnswer,
    downloadFile,
    getFile,
  };
}