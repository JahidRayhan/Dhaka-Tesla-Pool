/**
 * Minimal structured logger: one JSON object per line, which every log platform
 * can parse and search by field. Outside production it prints a readable line.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(env = process.env) {
  if (env.LOG_LEVEL && LEVELS[env.LOG_LEVEL]) return LEVELS[env.LOG_LEVEL];
  return env.NODE_ENV === 'test' ? LEVELS.error + 1 : LEVELS.info;
}

function serialiseError(err) {
  if (!(err instanceof Error)) return err;
  return { name: err.name, message: err.message, code: /** @type {any} */ (err).code, stack: err.stack };
}

function write(level, msg, fields = {}) {
  if (LEVELS[level] < threshold()) return;
  /** @type {Record<string, any>} */
  const entry = { ts: new Date().toISOString(), level, msg, ...fields };
  if (entry.err) entry.err = serialiseError(entry.err);
  const line =
    process.env.NODE_ENV === 'production'
      ? JSON.stringify(entry)
      : `${entry.ts} ${level.toUpperCase()} ${msg}${Object.keys(fields).length ? ' ' + JSON.stringify({ ...fields, err: entry.err ? entry.err.message : undefined }) : ''}`;
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line + '\n');
}

module.exports = {
  debug: (m, f) => write('debug', m, f),
  info: (m, f) => write('info', m, f),
  warn: (m, f) => write('warn', m, f),
  error: (m, f) => write('error', m, f),
};
