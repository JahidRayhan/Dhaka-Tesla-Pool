const jwt = require('jsonwebtoken');
const { ApiError } = require('../utils/ApiError');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Missing or malformed Authorization header'));
  }

  try {
    const payload = /** @type {import('jsonwebtoken').JwtPayload} */ (jwt.verify(token, process.env.JWT_SECRET));
    req.user = { id: payload.sub, role: payload.role };
    next();
  } catch (err) {
    next(new ApiError(401, 'Invalid or expired token'));
  }
}

/**
 * `both` accounts (Section 3 allows a user to be passenger and driver) satisfy
 * either role requirement.
 */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || (req.user.role !== role && req.user.role !== 'both')) {
      return next(new ApiError(403, `This action requires the '${role}' role`));
    }
    next();
  };
}

/**
 * Operators only. Deliberately NOT built on requireRole: that treats role 'both'
 * as a wildcard (a passenger who also drives), and a wildcard must never reach
 * the admin console. Only an exact 'admin' passes.
 */
function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return next(new ApiError(403, 'This action requires an administrator'));
  return next();
}

module.exports = { requireAuth, requireRole, requireAdmin };
