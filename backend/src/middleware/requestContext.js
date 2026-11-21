const crypto = require('crypto');
const logger = require('../utils/logger');

const VALID_ID = /^[A-Za-z0-9._:-]{8,100}$/;

/**
 * Gives every request an id (honouring a sane incoming X-Request-Id so a
 * client/proxy id can be traced end to end), returns it in the response header,
 * and writes one structured access-log line when the response finishes. With the
 * id in both the log and any 500 body, "something broke at 14:32" is one grep.
 */
function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && VALID_ID.test(incoming) ? incoming : crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/health' || req.path === '/ready') return; // monitors would drown the log
    logger.info('request', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms: Number((process.hrtime.bigint() - start) / 1000000n),
      userId: req.user?.id,
    });
  });
  next();
}

module.exports = { requestContext };
