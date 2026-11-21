const logger = require('../utils/logger');

/**
 * Delivers a text message. The provider is chosen by SMS_PROVIDER:
 *   console  (default) log it — fine for development
 *   memory   keep it in `outbox` — used by the tests
 *   webhook  POST {to, message} as JSON to SMS_WEBHOOK_URL (optionally with
 *            `Authorization: Bearer $SMS_WEBHOOK_TOKEN`). Deliberately generic: put
 *            a small adapter in front of whichever Bangladeshi SMS gateway you
 *            contract (SSL Wireless, Banglalink, Twilio, …) rather than baking one
 *            vendor into the app.
 * Message bodies containing codes are never logged in production.
 */
const outbox = [];

async function sendSms(to, message, env = process.env) {
  const provider = env.SMS_PROVIDER || 'console';
  if (provider === 'memory') {
    outbox.push({ to, message });
    return;
  }
  if (provider === 'webhook') {
    const res = await fetch(env.SMS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(env.SMS_WEBHOOK_TOKEN ? { Authorization: `Bearer ${env.SMS_WEBHOOK_TOKEN}` } : {}) },
      body: JSON.stringify({ to, message }),
    });
    if (!res.ok) throw new Error(`SMS gateway answered ${res.status}`);
    return;
  }
  logger.info('SMS (console provider)', { to, message: env.NODE_ENV === 'production' ? '[hidden]' : message });
}

module.exports = { sendSms, outbox };
