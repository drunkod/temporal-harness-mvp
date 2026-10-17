import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const helperSource = await read('src/jazz-status-config.ts');
const helperJs = ts.transpileModule(helperSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { getJazzStatusConfig, isJazzStatusFresh, JAZZ_STATUS_VERSION } = await import(`data:text/javascript;base64,${Buffer.from(helperJs).toString('base64')}`);
const pluginRoot = process.env.FLOWDECK_JAZZ_PLUGIN_ROOT ?? '/Users/test/Documents/RemoteMCP-Jazz/repositories/RemoteMCP-Jazz';
const upstreamSchema = resolve(pluginRoot, 'control-plane/packages/protocol/src/work-status-schema.ts');
const pinnedSchemaHash = '090820bcb6073624b90bc83dc4f80ce3bd07a8071394e99118b99de60642d6d8';
const canonicalSchema = text => text.slice(text.indexOf('import { schema as s }')).replace(/\r\n/g, '\n');

test('cross-origin and default config are link-only, with a real plugin panel link', () => {
  const config = getJazzStatusConfig({ pageOrigin: 'http://127.0.0.1:4319', authorizedSameOriginBootstrap: true });
  assert.equal(config.mode, 'link-only');
  assert.equal(config.bootstrapUrl, null);
  assert.match(config.authBlocker, /different origins/);
  assert.equal(config.fallbackPanelUrl, 'https://tests-macbook-air.tail70b8a.ts.net/dashboard/devices');
  assert.deepEqual(config.assets, { loader: '/jazz-status-loader.js', module: '/widgets/jazz-status/dist/jazz-status.js', stylesheet: '/widgets/jazz-status/dist/jazz-status.css' });
});

test('bootstrap requires explicit authorization AND exact same origin', () => {
  const pageOrigin = 'https://tests-macbook-air.tail70b8a.ts.net';
  assert.equal(getJazzStatusConfig({ pageOrigin }).bootstrapUrl, null);
  const config = getJazzStatusConfig({ pageOrigin, authorizedSameOriginBootstrap: true });
  assert.equal(config.mode, 'subscription');
  assert.equal(config.bootstrapUrl, `${pageOrigin}/api/dashboard/work-status/config`);
  assert.equal(config.authBlocker, null);
  for (const pluginOrigin of ['javascript:alert(1)', 'https://user:pass@example.com', 'https://example.com/?token=secret', 'https://example.com/#token', 'https://example.com/path']) {
    assert.throws(() => getJazzStatusConfig({ pageOrigin, pluginOrigin }), /origin/);
  }
});

test('45-second freshness clock handles absent health, skew, offline and auth error', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  const at = delta => new Date(now + delta).toISOString();
  assert.equal(isJazzStatusFresh(at(-45_000), now, true, false), true);
  for (const signal of [undefined, 'invalid', at(-45_001), at(5_001)]) assert.equal(isJazzStatusFresh(signal, now, true, false), false);
  assert.equal(isJazzStatusFresh(at(0), now, false, false), false);
  assert.equal(isJazzStatusFresh(at(0), now, true, true), false);
});

test('versioned schema snapshot and SDK dependency stay exactly alpha.53', async () => {
  const schema = canonicalSchema(await read('widgets/jazz-status/work-status-schema.alpha53.ts'));
  assert.equal(createHash('sha256').update(schema).digest('hex'), pinnedSchemaHash);
  const pkg = JSON.parse(await read('widgets/jazz-status/package.json'));
  assert.equal(pkg.dependencies['jazz-tools'], '2.0.0-alpha.53');
  assert.equal(pkg.dependencies['jazz-tools'], JAZZ_STATUS_VERSION);
  assert.match(await read('widgets/jazz-status/THIRD_PARTY_LICENSE.txt'), /MIT License[\s\S]*Eduard Ruzga/);
});

test('copied schema has not drifted from local plugin source', { skip: !existsSync(upstreamSchema) && 'Plugin checkout absent; pinned snapshot is still tested' }, async () => {
  assert.equal(canonicalSchema(await read('widgets/jazz-status/work-status-schema.alpha53.ts')), canonicalSchema(await readFile(upstreamSchema, 'utf8')));
  const require = createRequire(resolve(pluginRoot, 'control-plane/apps/control-plane/package.json'));
  assert.equal(require('jazz-tools/package.json').version, JAZZ_STATUS_VERSION);
});

test('subscriber uses alpha.53 arrays, owner-scoped global queries and memory only', async () => {
  const source = await read('widgets/jazz-status/index.tsx');
  assert.match(source, /const rows = useAll\(query, \{ tier: 'global' \}\)/);
  assert.match(source, /const health = useAll\(healthQuery, \{ tier: 'global' \}\)/);
  assert.match(source, /workStatusViews.where\(\{ ownerId \}\)/);
  assert.match(source, /workStatusHealth.where\(\{ ownerId \}\)/);
  assert.match(source, /driver: \{ type: 'memory'/);
  assert.match(source, /credentials: 'same-origin'.*redirect: 'error'/);
  assert.match(source, /root.unmount\(\)/);
  assert.match(source, /controller.abort\(\)/);
  assert.match(source, /clearInterval\(timer\)/);
  assert.match(source, /agent reported/);
  assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage)\b|\bdb\.(?:insert|update|delete|transaction)\s*\(/);
  assert.doesNotMatch(helperSource, /from ['"]jazz-tools/);
});

test('loader leaves a functioning external link without fetching assets or bootstrap', async () => {
  const loader = await read('public/jazz-status-loader.js');
  const { mountJazzStatus } = await import(`data:text/javascript;base64,${Buffer.from(loader).toString('base64')}`);
  const priorDocument = globalThis.document;
  const priorLocation = globalThis.location;
  const nodes = [];
  globalThis.document = {
    createElement(tag) { return { tag, children: [], append(...children) { this.children.push(...children); }, remove() { this.removed = true; } }; },
    createTextNode(text) { return { text }; },
  };
  globalThis.location = { origin: 'http://127.0.0.1:4319' };
  try {
    const cleanup = mountJazzStatus({ append(node) { nodes.push(node); } }, { authorizedSameOriginBootstrap: true });
    const link = nodes[0].children[0];
    assert.equal(link.tag, 'a');
    assert.equal(link.href, 'https://tests-macbook-air.tail70b8a.ts.net/dashboard/devices');
    assert.equal(link.rel, 'noopener noreferrer');
    cleanup(); cleanup();
    assert.equal(nodes[0].removed, true);
  } finally {
    if (priorDocument === undefined) delete globalThis.document; else globalThis.document = priorDocument;
    if (priorLocation === undefined) delete globalThis.location; else globalThis.location = priorLocation;
  }
});

test('built assets and metadata match the exact widget dependencies', async t => {
  if (!existsSync(new URL('widgets/jazz-status/dist/build-meta.json', root))) return t.skip('Run isolated widget build first');
  const meta = JSON.parse(await read('widgets/jazz-status/dist/build-meta.json'));
  assert.equal(meta.versions['jazz-tools'], JAZZ_STATUS_VERSION);
  for (const file of ['jazz-status.js', 'jazz-status.css']) assert.ok((await stat(new URL(`widgets/jazz-status/dist/${file}`, root))).size > 0);
  assert.ok(Object.keys(meta.metafile.inputs).some(path => path.includes('jazz-tools@2.0.0-alpha.53') || path.includes('node_modules/jazz-tools/')));
});
