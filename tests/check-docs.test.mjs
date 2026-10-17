import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkMarkdownLinks, inlineDestinations } from '../scripts/check-docs.mjs';

async function fixture(t, content) {
  const root = await mkdtemp(join(tmpdir(), 'flowdeck-docs-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'docs'));
  await writeFile(join(root, 'README.md'), 'Home');
  await writeFile(join(root, 'docs', 'guide.md'), content);
  return root;
}

test('extracts links/images and ignores fenced and inline code examples', () => {
  const text = '[guide](guide.md) ![image](image.png) ` [fake](missing.md) `\n```md\n[example](not-real.md)\n```\n~~~\n[example](also-not-real.md)\n~~~';
  assert.deepEqual(inlineDestinations(text), ['guide.md', 'image.png']);
});

test('resolves relative paths, titles, encoded spaces and skips external URLs and anchors', async t => {
  const root = await fixture(t, '[home](../README.md#intro) [named](<a file.md>) [encoded](a%20file.md "title") [web](https://example.com) [mail](mailto:example@example.com) [section](#local)');
  await writeFile(join(root, 'docs', 'a file.md'), 'Example');
  assert.deepEqual(await checkMarkdownLinks(root, ['docs/guide.md']), { errors: [], localEvidence: [] });
});

test('missing destinations and missing input documents are errors', async t => {
  const root = await fixture(t, '[missing](absent.md)');
  const result = await checkMarkdownLinks(root, ['docs/guide.md', 'docs/absent.md']);
  assert.deepEqual(result.errors.map(e => e.reason), ['missing_destination', 'document_unreadable']);
});

test('local evidence is reported even if absent, not claimed as public validation', async t => {
  const root = await fixture(t, '[evidence](../.state/private-result.md)');
  const result = await checkMarkdownLinks(root, ['docs/guide.md']);
  assert.equal(result.errors.length, 0);
  assert.equal(result.localEvidence.length, 1);
});

test('a misplaced nested .state link is a missing destination, not root-local evidence', async t => {
  const root = await fixture(t, '[misplaced](.state/private-result.md)');
  const result = await checkMarkdownLinks(root, ['docs/guide.md']);
  assert.equal(result.localEvidence.length, 0);
  assert.equal(result.errors[0].reason, 'missing_destination');
});

test('rejects machine-local links, traversal, and malformed URL encoding', async t => {
  const root = await fixture(t, '[local](file:///private/report.md) [absolute](/private/report.md) [escape](../../outside.md) [bad](bad%ZZ.md)');
  const result = await checkMarkdownLinks(root, ['docs/guide.md']);
  assert.deepEqual(result.errors.map(e => e.reason), [
    'machine_specific_link', 'machine_specific_link', 'outside_repository', 'invalid_url_encoding',
  ]);
});
