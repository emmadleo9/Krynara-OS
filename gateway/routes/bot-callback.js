// bot-callback.js – registers Telegram bot callback query endpoint (stub)
module.exports.register = function (app) {
  // Expect getAuthClient is not needed for stub; simply acknowledge
  app.post('/api/telegram/callback-query', (req, res) => {
    const { callback_query_id, data } = req.body || {};
    if (!callback_query_id) {
      return res.status(400).json({ error: 'callback_query_id required' });
    }
    // Stub: just log and respond ok
    console.log('Bot callback received', { callback_query_id, data });
    res.json({ ok: true });
  });
};