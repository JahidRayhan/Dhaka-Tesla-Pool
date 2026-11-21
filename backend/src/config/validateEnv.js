const PLACEHOLDER_SECRETS = new Set(['change_me_dev_only', 'secret', 'changeme', 'test']);

/**
 * Fail fast at startup if the process is misconfigured, instead of failing
 * later with confusing errors (every login 500s because jsonwebtoken got an
 * undefined secret) or, worse, running with a guessable secret.
 *
 * Pure function over an env object so it can be tested without touching
 * process.env. Returns a list of problems; callers decide whether to exit.
 */
function findEnvProblems(env) {
  const problems = [];

  if (!env.DATABASE_URL) {
    problems.push('DATABASE_URL is not set');
  }

  if (!env.JWT_SECRET) {
    problems.push('JWT_SECRET is not set');
  } else if (env.NODE_ENV === 'production') {
    if (env.JWT_SECRET.length < 32) {
      problems.push('JWT_SECRET must be at least 32 characters in production (generate one with `openssl rand -hex 32`)');
    }
    if (PLACEHOLDER_SECRETS.has(env.JWT_SECRET)) {
      problems.push('JWT_SECRET is still a placeholder value');
    }
  }

  return problems;
}

function assertEnv(env = process.env) {
  const problems = findEnvProblems(env);
  if (problems.length > 0) {
    throw new Error(`Invalid configuration:\n - ${problems.join('\n - ')}`);
  }
}

module.exports = { findEnvProblems, assertEnv };
