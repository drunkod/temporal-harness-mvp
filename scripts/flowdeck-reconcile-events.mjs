#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

export const usage = `Usage: node scripts/flowdeck-reconcile-events.mjs [--config /absolute/config.json] [--apply --approve-reconciliation]
Required config/flags: --plugin-repo --db --owner --device --audit-directory --workflow-id --project-id --task-id --work-id --chat-url --tab-id --execution-id --start-event-id --report-event-id --worktree
Optional paths: --flowdeck-root and --inbox-directory default to the trusted main Flowdeck cwd and its .state/flowdeck-supervisor inbox.
Default: preview only. --apply requires the separate literal --approve-reconciliation flag.
Reads the authoritative origin:event pair and verifies enrollment, binding, browser, and the selected RUNNING Temporal execution.
Only missing exact events are eligible; no inbox/plugin writes, workers, ChatGPT sends, snapshots, or unrelated history are used.`;

const names = ['config', 'plugin-repo', 'db', 'owner', 'device', 'audit-directory', 'flowdeck-root', 'inbox-directory', 'workflow-id', 'project-id', 'task-id', 'work-id', 'chat-url', 'tab-id', 'execution-id', 'start-event-id', 'report-event-id', 'worktree', 'address', 'namespace', 'apply', 'approve-reconciliation'];
export function parseOptions(args) {
  const flags = {};
  while (args.length) {
    const name = args.shift();
    if (!name?.startsWith('--') || !names.includes(name.slice(2))) throw Error(usage);
    const key = name.slice(2);
    if (flags[key] !== undefined) throw Error('Duplicate flag: ' + name);
    if (key === 'apply' || key === 'approve-reconciliation') flags[key] = true;
    else if (!args.length || args[0].startsWith('--')) throw Error(usage);
    else flags[key] = args.shift();
  }
  return flags;
}
export async function readConfig(flags) {
  if (flags.config && !isAbsolute(flags.config)) throw Error('Config must be absolute');
  const config = { ...(flags.config ? JSON.parse(await readFile(flags.config, 'utf8')) : {}), ...flags };
  for (const name of ['plugin-repo', 'db', 'audit-directory', 'workflow-id', 'project-id', 'task-id', 'work-id', 'chat-url', 'tab-id', 'execution-id', 'start-event-id', 'report-event-id', 'worktree', 'owner', 'device'])
    if (typeof config[name] !== 'string' || !config[name].trim()) throw Error('Explicit --' + name + ' required');
  config['flowdeck-root'] ??= resolve(import.meta.dirname, '..');
  config['inbox-directory'] ??= join(config['flowdeck-root'], '.state', 'flowdeck-supervisor', 'event-inbox');
  for (const name of ['plugin-repo', 'db', 'audit-directory', 'flowdeck-root', 'inbox-directory', 'worktree']) if (!isAbsolute(config[name])) throw Error('--' + name + ' must be absolute');
  if (config.apply && !config['approve-reconciliation']) throw Error('--apply requires --approve-reconciliation');
  if (config['approve-reconciliation'] && !config.apply) throw Error('--approve-reconciliation is valid only with --apply');
  return config;
}
const normalizeComposerText = value => value.normalize('NFC').replace(/\s+/gu, ' ').trim();
const importedConfig = c => ({ pluginRepo: c['plugin-repo'], db: c.db, owner: c.owner, device: c.device,
  auditDirectory: c['audit-directory'], flowdeckRoot: c['flowdeck-root'], inboxDirectory: c['inbox-directory'], workflowId: c['workflow-id'], projectId: c['project-id'], taskId: c['task-id'],
  workId: c['work-id'], chatUrl: c['chat-url'], tabId: c['tab-id'], executionId: c['execution-id'],
  startEventId: c['start-event-id'], reportEventId: c['report-event-id'], worktree: c.worktree });

export async function main(argv = process.argv.slice(2), deps = {}) {
  if (argv.includes('--help')) { console.log(usage); return; }
  const flags = parseOptions([...argv]);
  const c = await readConfig(flags);
  const root = resolve(import.meta.dirname, '..');
  const reconcile = deps.reconcile ?? (await import('../dist/flowdeck-event-reconciliation.js')).reconcileEvents;
  const loader = deps.loader ?? (await import('../dist/flowdeck-projects.js')).createSupervisorProjectLoader;
  const project = await (loader({ base: root }))(c['project-id']);
  const pluginRequire = createRequire(join(c['plugin-repo'], 'package.json'));
  const runtime = pluginRequire('tsx/cjs/api');
  const source = join(c['plugin-repo'], 'control-plane/packages/work-events/src');
  const { SqliteWorkEventReader } = runtime.require(join(source, 'sqlite-reader.ts'), import.meta.url);
  const reader = new SqliteWorkEventReader(c.db, c.owner, c.device);
  let connection;
  const temporal = deps.temporal ?? (() => {
    let client, handle, initialized = false;
    return {
      async init() {
        if (initialized) return;
        const { Connection, Client } = await import('@temporalio/client');
        connection = await Connection.connect({ address: c.address ?? '127.0.0.1:7233', connectTimeout: '5s' });
        client = new Client({ connection, namespace: c.namespace ?? 'default' });
        handle = client.workflow.getHandle(c['workflow-id'], c['execution-id']);
        initialized = true;
      },
      async describe() { const d = await handle.describe(); return { status: d.status.name, runId: d.runId }; },
      async query() { return handle.query('flowdeckSupervisorStatus'); },
      async history() { return handle.fetchHistory(); },
      async signal(name, event) { return handle.signal(name, event); },
      async close() { await connection?.close(); },
    };
  })();

  const browser = deps.browser ?? {
    async observe(chatUrl, tabId) {
      const { browserPages, browserEvaluate } = await import('../dist/sashai-live-browser.js');
      const { supervisorIdentityExpression, supervisorAnswerExpression } = await import('../dist/flowdeck-supervisor-activities.js');
            const { observeSashaiConversation } = await import('../dist/sashai-observer.js');
      const state = await observeSashaiConversation(chatUrl);
      const page = (await browserPages()).find(p => p.id === tabId && p.url.split('?')[0] === chatUrl);
      if (!page) throw Error('Original owned browser tab is not present at the exact chat URL');
      const identity = await browserEvaluate(page, supervisorIdentityExpression(chatUrl));
      const answer = await browserEvaluate(page, supervisorAnswerExpression(chatUrl));
      const latestUserHash = typeof identity?.latestUserText === 'string'
        ? createHash('sha256').update(normalizeComposerText(identity.latestUserText)).digest('hex') : null;
      return { ...identity, latestUserHash, turnState: state.turnState, lastAssistant: answer };
    },
  };
  try {
    if (temporal.init) await temporal.init();
    const result = await reconcile(importedConfig(c), { project, reader, temporal, browser }, c.apply === true);
    console.log(JSON.stringify(result, null, 2));
  } finally { reader.close(); await temporal.close?.(); }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(error => { console.error(error.message); console.error(usage); process.exitCode = 2; });
