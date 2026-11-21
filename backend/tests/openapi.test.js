const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const app = require('../src/app');

const spec = YAML.parse(fs.readFileSync(path.join(__dirname, '..', 'openapi.yaml'), 'utf8'));

// Express keeps mounted routers as layers whose regexp encodes the mount path,
// e.g. '^\/api\/v1\/?(?=\/|$)' -> '/api/v1'.
function mountPath(layer) {
  const source = layer.regexp.source;
  const withoutAnchor = source.startsWith('^') ? source.slice(1) : source;
  const tail = '\\/?(?=\\/|$)';
  const body = withoutAnchor.endsWith(tail) ? withoutAnchor.slice(0, -tail.length) : withoutAnchor;
  return body.split('\\/').join('/');
}
function collect(stack, prefix = '') {
  const out = [];
  for (const layer of stack) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods)) out.push(`${method.toUpperCase()} ${prefix}${layer.route.path === '/' ? '' : layer.route.path}`);
    } else if (layer.name === 'router' && layer.handle.stack) {
      out.push(...collect(layer.handle.stack, prefix + mountPath(layer)));
    }
  }
  return out;
}
const toOpenApiPath = (p) => p.replace(/:(\w+)/g, '{$1}');

const implemented = new Set(
  collect(app._router.stack)
    .filter((r) => /^[A-Z]+ \/(api\/v1|health|ready)/.test(r))
    .map((r) => { const [m, p] = r.split(' '); return `${m} ${toOpenApiPath(p)}`; }),
);
const documented = new Set(Object.entries(spec.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`)));

test('every implemented route is documented, and every documented route exists', () => {
  const undocumented = [...implemented].filter((r) => !documented.has(r));
  const phantom = [...documented].filter((r) => !implemented.has(r));
  assert.deepEqual(undocumented, [], 'routes missing from openapi.yaml');
  assert.deepEqual(phantom, [], 'routes in openapi.yaml that do not exist');
  assert.ok(implemented.size >= 60, `found ${implemented.size} routes`);
});

test('every operation has a summary, a tag, a unique id, declared path parameters and a success response', () => {
  const ids = new Set();
  for (const [p, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const where = `${method.toUpperCase()} ${p}`;
      assert.ok(op.summary && op.tags?.length, `${where}: summary and tag`);
      assert.ok(!ids.has(op.operationId), `${where}: duplicate operationId`);
      ids.add(op.operationId);
      for (const name of [...p.matchAll(/\{(\w+)\}/g)].map((m) => m[1])) {
        assert.ok(op.parameters?.some((x) => x.name === name && x.in === 'path'), `${where}: path parameter ${name} not declared`);
      }
      assert.ok(Object.keys(op.responses).some((c) => /^2\d\d$/.test(c)), `${where}: no success response`);
      assert.ok(Array.isArray(op.security), `${where}: security must be stated explicitly (use [] for public)`);
    }
  }
});

test('all request-body schemas referenced actually exist, and the security-sensitive routes are marked as needing a token', () => {
  const refs = JSON.stringify(spec).match(/#\/components\/schemas\/\w+/g) || [];
  for (const ref of new Set(refs)) assert.ok(spec.components.schemas[ref.split('/').pop()], `dangling ${ref}`);

  const needsToken = (m, p) => spec.paths[p][m].security.length > 0;
  for (const [m, p] of [['get', '/api/v1/admin/stats'], ['post', '/api/v1/wallet/topup'], ['post', '/api/v1/ride-requests'], ['get', '/api/v1/auth/me'], ['post', '/api/v1/auth/logout-all']]) {
    assert.ok(needsToken(m, p), `${m} ${p} must require a token`);
  }
  for (const [m, p] of [['post', '/api/v1/auth/login'], ['get', '/api/v1/trips/{token}'], ['get', '/api/v1/zones'], ['post', '/api/v1/auth/refresh']]) {
    assert.ok(!needsToken(m, p), `${m} ${p} is public`);
  }
  assert.equal(spec.paths['/api/v1/admin/stats'].get.description, 'Requires role: admin.');
});
