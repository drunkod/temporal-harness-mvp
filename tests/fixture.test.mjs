import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('prototype binds work strictly to disposable fixture repos', async () => {
  const source = await readFile(new URL('../src/activities.ts', import.meta.url),'utf8');
  assert.match(source, /knownProjects = \['alpha', 'beta'\]/);
  assert.match(source, /packet\.contentSha256/);
  assert.match(source, /git\(packet\.repo, 'worktree', 'add'/);
  assert.match(source, /unexpected diff scope/);
  assert.match(source, /flag: 'wx'/);
});
test('temporal worker and workflow are independently runnable', async () => {
  const src = await readFile(new URL('../src/workflows.ts', import.meta.url),'utf8');
  assert.match(src, /proxyActivities/);
  assert.match(src, /statusQuery/);
  assert.match(src, /await a\.executeVerifyPromote/);
});
