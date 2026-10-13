/**
 * CORS_ORIGINS is a comma-separated allow-list, e.g.
 *   CORS_ORIGINS=https://dhaka-tesla-pool.netlify.app,http://localhost:3000
 *
 * Unset = allow any origin. That keeps local development and docker compose
 * working with no setup; production deployments should set it. Auth uses a
 * bearer token (not cookies), so the allow-list is defence in depth rather
 * than the main protection.
 */
function parseOrigins(value) {
  return (value || '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function buildCorsOptions(env = process.env) {
  const allowed = parseOrigins(env.CORS_ORIGINS);
  if (allowed.length === 0) return {};

  return {
    origin(origin, callback) {
      // Requests with no Origin header (curl, server-to-server, health checks)
      // are not browser cross-origin requests, so CORS does not apply to them.
      if (!origin || allowed.includes(origin.replace(/\/+$/, ''))) {
        return callback(null, true);
      }
      return callback(null, false);
    },
  };
}

module.exports = { buildCorsOptions, parseOrigins };
