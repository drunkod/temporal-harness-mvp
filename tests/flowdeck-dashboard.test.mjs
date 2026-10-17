import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const serverPath = fileURLToPath(new URL('../dist/dashboard-server.js', import.meta.url));

for (const updatedAt of ['2026-10-16T00:00:00.000Z', undefined, 'invalid']) {
  test(`projection UI never presents a received snapshot as live workflow status (${updatedAt})`, async () => {
    const elements = new Map();
    const handlers = new Map();
    const document = {
      getElementById(id) {
        if (id === 'flowdeck-jazz-status') return null;
        if (!elements.has(id)) elements.set(id, {textContent:'',className:'',replaceChildren(){}});
        return elements.get(id);
      },
    };
    const source = (await readFile(new URL('../public/supervisor-status.js', import.meta.url), 'utf8'))
      .replace("import {mountJazzStatus} from '/jazz-status-loader.js';", '');
    await runInNewContext(`(async () => {${source}\n})()`, {
      document, window:{addEventListener(){}},
      EventSource:class {addEventListener(name, handler){handlers.set(name, handler);}},
    });
    handlers.get('status')({data:JSON.stringify({phase:'working',tasks:[],updatedAt})});
    const connection = elements.get('supervisor-connection');
    assert.match(connection.textContent, /live workflow freshness unconfirmed/);
    assert.equal(connection.className, 'small warning');
    if (updatedAt?.startsWith('2026')) assert.ok(connection.textContent.includes(updatedAt));
    else assert.match(connection.textContent, /timestamp unavailable/);
  });
}

async function freePort() {
  const reservation = createServer();
  await new Promise((resolve, reject) => {
    reservation.once('error', reject);
    reservation.listen(0, '127.0.0.1', resolve);
  });
  const { port } = reservation.address();
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForStartup(child, output, url) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    assert.equal(child.exitCode, null, `Dashboard exited before startup: ${output()}`);
    assert.equal(child.signalCode, null, `Dashboard terminated before startup: ${output()}`);
    if (output().split(/\r?\n/).includes(`MVP_DASHBOARD_URL=${url}`)) return;
    await delay(25);
  }
  assert.fail(`Dashboard startup timed out (requires the existing local Temporal connection): ${output()}`);
}

// Parse actual SSE frames on one HTTP response; comments/heartbeats are not events.
function statusEvents(reader) {
  const decoder = new TextDecoder();
  let pending = '';
  return async function nextStatus() {
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(pending);
      if (boundary) {
        const frame = pending.slice(0, boundary.index);
        pending = pending.slice(boundary.index + boundary[0].length);
        const lines = frame.split(/\r?\n/);
        if (!lines.includes('event: status')) continue;
        const data = lines.filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).replace(/^ /, '')).join('\n');
        return JSON.parse(data);
      }
      const { done, value } = await reader.read();
      assert.equal(done, false, 'SSE connection closed before the next status event');
      pending += decoder.decode(value, { stream: true });
    }
  };
}

async function stopChild(child, closed) {
  if (child.exitCode !== null || child.signalCode !== null) {
    await closed;
    return;
  }
  child.kill('SIGTERM');
  let timer;
  try {
    await Promise.race([
      closed,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Dashboard did not stop after SIGTERM')), 2_000);
      }),
    ]);
  } catch (error) {
    child.kill('SIGKILL');
    await closed;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

test('isolated dashboard serves fixture status and pushes atomic projection changes over one SSE connection',
  { timeout: 25_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'flowdeck-dashboard-test-'));
    let child, closed, reader, streamTimer;
    const requests = new AbortController();
    try {
      const directory = join(root, '.state', 'flowdeck-supervisor');
      await mkdir(directory, { recursive: true });
      // Explicitly synthetic projection: no real tasks, workflows, browser, or dispatch.
      const initial = {
        fixture: true,
        label: 'SYNTHETIC dashboard integration test fixture; not production status',
        projectId: 'fixture-dashboard-only',
        status: 'fixture_waiting',
        phase: 'waiting_for_fixture',
        dispatchStarted: false,
        tasks: [],
      };
      const updated = { ...initial, status: 'fixture_updated', phase: 'fixture_observed', revision: 2 };
      const projection = join(directory, 'status.json');
      await writeFile(projection, JSON.stringify(initial));
      const port = await freePort();
      const url = `http://127.0.0.1:${port}`;
      child = spawn(process.execPath, [serverPath], {
        cwd: root,
        env: { ...process.env, MVP_DASHBOARD_PORT: String(port) },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', chunk => { output = (output + chunk).slice(-16_384); });
      child.stderr.on('data', chunk => { output = (output + chunk).slice(-16_384); });
      child.on('error', error => { output += `\n${error.stack}`; });
      closed = new Promise(resolve => child.once('close', resolve));
      // Only contact this child after its own listen callback, never an existing dashboard.
      await waitForStartup(child, () => output, url);
      streamTimer = setTimeout(() => requests.abort(new Error('Dashboard HTTP/SSE test timed out')), 8_000);
      const status = await fetch(`${url}/api/supervisor/status`, { signal: requests.signal });
      assert.equal(status.status, 200);
      assert.match(status.headers.get('content-type'), /^application\/json\b/);
      assert.equal(status.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await status.json(), initial);

      const stream = await fetch(`${url}/api/supervisor/stream`, {
        headers: { Accept: 'text/event-stream' }, signal: requests.signal,
      });
      assert.equal(stream.status, 200);
      assert.match(stream.headers.get('content-type'), /^text\/event-stream\b/);
      assert.equal(stream.headers.get('cache-control'), 'no-store');
      reader = stream.body.getReader();
      const nextStatus = statusEvents(reader);
      assert.deepEqual(await nextStatus(), initial);

      const replacement = join(directory, 'status.next.json');
      await writeFile(replacement, JSON.stringify(updated));
      await rename(replacement, projection);
      // Same reader/response: no reconnect, polling, or manual refresh can deliver this event.
      assert.deepEqual(await nextStatus(), updated);

      const latest = await fetch(`${url}/api/supervisor/status`, { signal: requests.signal });
      assert.equal(latest.status, 200);
      assert.deepEqual(await latest.json(), updated);
    } finally {
      clearTimeout(streamTimer);
      requests.abort();
      try {
        if (reader) await reader.cancel().catch(() => {});
        if (child) await stopChild(child, closed);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });
