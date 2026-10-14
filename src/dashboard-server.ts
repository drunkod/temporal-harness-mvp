import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { Connection, Client } from '@temporalio/client';
import { roamingMvp, statusQuery } from './workflows.js';
import { sashaiOverview, listSashaiTabs, adoptSashaiConversation } from './sashai-observer.js';
import { readReportReviewStatus, browserReportPath } from './sashai-report-status.js';

const exec = promisify(execFile);
const base = resolve(process.cwd());
const runsRoot = join(base, '.state', 'demo-runs');
const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233' });
const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? 'default' });
const host = '127.0.0.1';
const port = Number(process.env.MVP_DASHBOARD_PORT || 4319);
await mkdir(runsRoot, { recursive: true });
interface RunManifest { id: string; root: string; createdAt: string }
let launching: Promise<RunManifest> | null = null;
let activeId: string | null = null;

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
}
async function workflowStatus(id: string) {
  const handle = client.workflow.getHandle(id);
  const described = await handle.describe();
  const temporal = described.status.name;
  if (temporal === 'RUNNING') {
    const state = await handle.query(statusQuery);
    return { id, temporal, ...state };
  }
  const result = await handle.result().catch((err: unknown) => ({
    stage: temporal.toLowerCase(), message: String(err), processed: 0, expected: 2,
    current: null, events: [], receipts: [],
  }));
  return { id, temporal, ...result };
}
async function getRuns(): Promise<RunManifest[]> {
  const entries = await readdir(runsRoot, { withFileTypes: true });
  const results: RunManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const p = join(runsRoot, entry.name, 'manifest.json');
    if (!existsSync(p)) continue;
    try {
      const parsed = JSON.parse(await readFile(p, 'utf8')) as RunManifest;
      if (parsed.id && parsed.root) results.push(parsed);
    } catch {}
  }
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
}
async function beginRun(): Promise<RunManifest> {
  if (activeId) {
    try {
      const status = await workflowStatus(activeId);
      if (status.temporal === 'RUNNING') {
        const found = (await getRuns()).find(r => r.id === activeId);
        if (found) return found;
      }
    } catch {}
  }
  const token = randomUUID().slice(0, 12);
  const root = join(runsRoot, token);
  await mkdir(root, { recursive: true });
  // The fixture seeder has no access to real user repositories.
  await exec(process.execPath, [join(base, 'dist', 'seed.js')], {
    cwd: root, timeout: 30000, maxBuffer: 1024 * 1024,
  });
  const id = 'mvp-' + token;
  await client.workflow.start(roamingMvp, {
    taskQueue: 'repo-harness-mvp', workflowId: id,
    args: [{ root, maxTasks: 2, browserDryRun: true, jev: true, demoPacingMs: 850 }],
    workflowExecutionTimeout: '15 minutes',
  });
  activeId = id;
  const manifest: RunManifest = { id, root, createdAt: new Date().toISOString() };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
const staticHtml = join(base, 'public', 'index.html');
const sashaiHtml = join(base, 'public', 'sashai.html');
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || '/', 'http://' + host + ':' + port);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/sashai')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(await readFile(sashaiHtml, 'utf8'));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/fixtures') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(await readFile(staticHtml, 'utf8'));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sashai/status') {
      json(res, 200, await sashaiOverview()); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sashai/report') {
      const report=await readReportReviewStatus();
      if (!report?.reportReady) {json(res,409,{error:'Report not independently verified or changed since verification'});return;}
      const markdown=await readFile(browserReportPath,'utf8');
      res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Cache-Control':'no-store',
        'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"});
      res.end(markdown);return;
    }
    if (req.method === 'GET' && url.pathname === '/api/sashai/tabs') {
      json(res, 200, { tabs: await listSashaiTabs() }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sashai/adopt') {
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString();
        if (body.length > 4096) { json(res, 413, { error: 'Input too large' }); return; }
      }
      const supplied = body.trim() ? JSON.parse(body) as { url?: string } : {};
      let chosen = supplied.url ?? null;
      if (!chosen) {
        const tabs = await listSashaiTabs();
        if (tabs.length !== 1) {
          json(res, 409, { error: 'Open exactly one Sashai chat tab or provide its URL explicitly', count: tabs.length }); return;
        }
        chosen = tabs[0].url;
      }
      json(res, 200, { observation: await adoptSashaiConversation(chosen) }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      json(res, 200, { status: 'ok', temporal: 'connected', activeId }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/runs') {
      json(res, 200, { runs: await getRuns() }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const id = url.searchParams.get('id') ?? '';
      if (!/^mvp-[a-f0-9-]{8,40}$/.test(id)) { json(res, 400, { error: 'Invalid workflow ID' }); return; }
      json(res, 200, await workflowStatus(id)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/start') {
      // Repo Harness fixture lane is historical, not part of the Oracle-only supervisor.
      // Prevent new runs from accidentally invoking that legacy browser adapter.
      json(res, 410, { error: 'Legacy Repo Harness fixture disabled. Use /api/sashai/adopt for read-only Sashai supervision.' }); return;
    }
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('Dashboard request failed:', err);
    json(res, 500, { error: err instanceof Error ? err.message : 'Internal failure' });
  }
});
server.listen(port, host, () => console.log('MVP_DASHBOARD_URL=http://' + host + ':' + port));
