const { pool } = require('../config/db');
const logger = require('../utils/logger');
const { afterCommit } = require('../utils/tx');
const { render } = require('./notificationTemplates');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Test hook: when PUSH_PROVIDER=memory, pushes land here instead of the network. */
const pushOutbox = [];

async function sendPush(messages, env = process.env) {
  const provider = env.PUSH_PROVIDER || 'expo';
  if (messages.length === 0 || provider === 'off') return [];
  if (provider === 'memory') {
    pushOutbox.push(...messages);
    return messages.map(() => ({ status: 'ok' }));
  }
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Expo push answered ${res.status}`);
  const body = /** @type {{ data?: any[] }} */ (await res.json());
  return body.data || [];
}

/**
 * Tell people something happened. Always writes the in-app inbox row (so nothing
 * is lost if a phone is offline or push is not set up) and then tries a push to
 * each of the person's devices. Best effort by design: a notification failing
 * must never break the ride flow that triggered it, so errors are logged and
 * swallowed.
 *
 * @param {string[]} userIds
 * @param {string} type    a key of notificationTemplates
 * @param {Record<string, any>} [data]  template inputs, also delivered to the app for deep links
 */
async function notify(userIds, type, data = {}) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return;
  try {
    const { rows: users } = await pool.query('SELECT id, locale FROM users WHERE id = ANY($1::uuid[])', [unique]);
    const rendered = users.map((u) => ({ userId: u.id, ...render(type, data, u.locale) }));

    await pool.query(
      `INSERT INTO notifications (user_id, type, title, body, data)
       SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::jsonb[])`,
      [rendered.map((r) => r.userId), rendered.map(() => type), rendered.map((r) => r.title), rendered.map((r) => r.body), rendered.map(() => JSON.stringify({ type, ...data }))],
    );

    const { rows: tokens } = await pool.query('SELECT token, user_id FROM push_tokens WHERE user_id = ANY($1::uuid[])', [unique]);
    if (tokens.length === 0) return;
    const byUser = new Map(rendered.map((r) => [r.userId, r]));
    const messages = tokens.map((t) => ({
      to: t.token,
      title: byUser.get(t.user_id).title,
      body: byUser.get(t.user_id).body,
      data: { type, ...data },
      sound: 'default',
    }));
    const results = await sendPush(messages);
    // Expo tells us when a token is dead (app uninstalled); stop sending to it.
    const dead = results.map((r, i) => (r?.details?.error === 'DeviceNotRegistered' ? tokens[i].token : null)).filter(Boolean);
    if (dead.length) await pool.query('DELETE FROM push_tokens WHERE token = ANY($1::text[])', [dead]);
  } catch (err) {
    logger.warn('notification failed', { type, err });
  }
}

/** Queue a notification to go out only if the surrounding transaction commits. */
function notifyAfterCommit(client, userIds, type, data) {
  afterCommit(client, () => notify(userIds, type, data));
}

async function list(userId, { limit = 30, unreadOnly = false } = {}) {
  const { rows } = await pool.query(
    `SELECT id, type, title, body, data, read_at, created_at FROM notifications
     WHERE user_id = $1 AND ($3 = false OR read_at IS NULL)
     ORDER BY created_at DESC, id DESC LIMIT $2`,
    [userId, limit, unreadOnly],
  );
  const { rows: unread } = await pool.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]);
  return { notifications: rows, unreadCount: unread[0].n };
}

async function markRead(userId, ids) {
  if (ids === 'all') await pool.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
  else await pool.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL', [userId, ids]);
}

async function registerPushToken(userId, token, platform) {
  // A device token belongs to whoever signed in last on that device.
  await pool.query(
    `INSERT INTO push_tokens (token, user_id, platform) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id = $2, platform = $3, last_seen_at = now()`,
    [token, userId, platform],
  );
}

async function removePushToken(userId, token) {
  await pool.query('DELETE FROM push_tokens WHERE token = $1 AND user_id = $2', [token, userId]);
}

module.exports = { notify, notifyAfterCommit, list, markRead, registerPushToken, removePushToken, pushOutbox };
