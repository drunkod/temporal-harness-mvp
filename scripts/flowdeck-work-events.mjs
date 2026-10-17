#!/usr/bin/env node
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { isAbsolute, join, resolve, relative } from 'node:path';
import { realpath, mkdir, lstat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

export const usage = `Usage: node scripts/flowdeck-work-events.mjs [status|once|follow] [--config /absolute/config.json] [flags]
Required: --plugin-repo --db --owner --device --workflow-id --directory (all explicit). Optional: --project-id for attempt IDs.
Optional: --address (127.0.0.1:7233), --namespace (default).
status (default): read inbox only. once: read source head/snapshot page only.
Only follow writes inbox/checkpoint or signals Temporal. No workflow/worker is started.
follow requires a RUNNING flowdeck-supervisor-PROJECT_ID in waiting_for_manual_start.
Emits JSON type flowdeck.work-events.ready only after the initial drain and pending delivery check.`;

export function parseOptions(args) {
  const action = args[0] && !args[0].startsWith('--') ? args.shift() : 'status';
  if (!['status', 'once', 'follow'].includes(action)) throw Error(usage);
  const flags = {};
  const names = ['config', 'plugin-repo', 'db', 'owner', 'device', 'workflow-id', 'directory', 'project-id', 'address', 'namespace'];
  while (args.length) {
    const name = args.shift();
    if (!name?.startsWith('--') || !names.includes(name.slice(2)) || !args.length || args[0].startsWith('--')) throw Error(usage);
    if (flags[name.slice(2)] !== undefined) throw Error('Duplicate flag: ' + name);
    flags[name.slice(2)] = args.shift();
  }
  return { action, flags };
}

export async function readEventConfig(flags) {
  const { readFile } = await import('node:fs/promises');
  if (flags.config && !isAbsolute(flags.config)) throw Error('Config must be absolute');
  const config = { ...(flags.config ? JSON.parse(await readFile(flags.config, 'utf8')) : {}), ...flags };
  for (const name of ['plugin-repo', 'db', 'owner', 'device', 'workflow-id', 'directory']) {
    if (typeof config[name] !== 'string' || !config[name].trim()) throw Error('Explicit --' + name + ' required');
  }
  for (const name of ['plugin-repo', 'db', 'directory']) if (!isAbsolute(config[name])) throw Error('--' + name + ' must be absolute');
    if (config['project-id'] !== undefined && (!/^[-a-zA-Z0-9_]{1,80}$/.test(config['project-id']) || config['project-id'].includes('--'))) throw Error('Invalid --project-id');
  return config;
}

export function workflowProjectId(workflowId, configuredProjectId) {
  const prefix = 'flowdeck-supervisor-';
  if (typeof workflowId !== 'string' || !workflowId.startsWith(prefix)) throw Error('Expected flowdeck-supervisor-PROJECT_ID[--ATTEMPT] workflow');
  const body = workflowId.slice(prefix.length);
  const delimiter = body.indexOf('--');
  const projectId = delimiter < 0 ? body : body.slice(0, delimiter);
  const attempt = delimiter < 0 ? undefined : body.slice(delimiter + 2);
  if (!/^[-a-zA-Z0-9_]{1,80}$/.test(projectId) || projectId.includes('--')
    || (attempt !== undefined && !/^[-a-zA-Z0-9_]{1,80}$/.test(attempt))) {
    throw Error('Expected flowdeck-supervisor-PROJECT_ID[--ATTEMPT] workflow');
  }
  if (configuredProjectId !== undefined && configuredProjectId !== projectId) throw Error('Configured project-id does not match workflow');
  return configuredProjectId ?? projectId;
}

export async function classifySignalFailure(error, handle) {
  const { WorkflowNotFoundError } = await import('@temporalio/client');
  if (!(error instanceof WorkflowNotFoundError)) return false;
  try {
    const description = await handle.describe();
    return description.status?.name !== 'RUNNING';
  } catch (describeError) {
    if (describeError instanceof WorkflowNotFoundError) return true;
    throw describeError;
  }
}

export function assertManualStart(status, workflowId, projectId) {
  if (status.workflowId !== workflowId || status.temporal !== 'RUNNING' ||
      status.state?.projectId !== projectId || status.state?.phase !== 'waiting_for_manual_start') {
    throw Error('Workflow must be RUNNING and waiting_for_manual_start for the configured project');
  }
}

export async function preflightWorkflow(config, connect = async () => {
  const { Connection, Client } = await import('@temporalio/client');
  const connection = await Connection.connect({ address: config.address ?? '127.0.0.1:7233', connectTimeout: '5s' });
  return { connection, client: new Client({ connection, namespace: config.namespace ?? 'default' }) };
}) {
  const workflowId = config['workflow-id'];
  const projectId = workflowProjectId(workflowId, config['project-id']);
  const { connection, client } = await connect();
  try {
    await connection.withDeadline(Date.now() + 5000, async () => {
      const handle = client.workflow.getHandle(workflowId);
      const description = await handle.describe();
      if (description.status.name !== 'RUNNING') throw Error('Configured workflow is not RUNNING');
      assertManualStart({ workflowId, temporal: description.status.name,
        state: await handle.query('flowdeckSupervisorStatus') }, workflowId, projectId);
    });
  } finally { await connection.close(); }
}

// A drained snapshot alone is insufficient: the first live drain and pending delivery check must finish.
export async function drainForReadiness(pump, checkpoint, inbox) {
  const more = await pump.drainOnce();
  const { pending, blocked = 0 } = await inbox.retryPending();
  const state = checkpoint.get();
  return { more, pending, blocked, ready: more === false && state.cursor !== null && state.cursor !== undefined &&
    state.snapshot === null && pending === 0 && blocked === 0 };
}

export async function main(args = process.argv.slice(2)) {
  if (args.includes('--help')) { console.log(usage); return; }
  const { action, flags } = parseOptions([...args]);
  const config = await readEventConfig(flags);
  if (action === 'follow') await preflightWorkflow(config);
  // Resolve the installed TS runtime from the explicitly configured plugin, never credentials or global paths.
  const pluginRequire = createRequire(join(config['plugin-repo'], 'package.json'));
  const runtime = pluginRequire('tsx/cjs/api');
  const tsImport = async specifier => runtime.require(specifier, import.meta.url);
  const { createWorkEventInbox } = await tsImport(resolve(import.meta.dirname, '../src/flowdeck-work-events.ts'));
  let connection;
  const inbox = createWorkEventInbox({ directory: config.directory, ownerId: config.owner, deviceId: config.device,
    async wake(event) {
      const { Connection, Client } = await import('@temporalio/client');
      try {
        connection ??= await Connection.connect({ address: config.address ?? '127.0.0.1:7233' });
        const client = new Client({ connection, namespace: config.namespace ?? 'default' });
        const handle = client.workflow.getHandle(config['workflow-id']);
        try { await handle.signal('supervisorWorkEvent', event); }
        catch (error) {
          if (!(await classifySignalFailure(error, handle))) throw error;
          const terminal = Error('Temporal target is missing or terminal; retained for reconciliation');
          terminal.code = 'FLOWDECK_TARGET_CLOSED';
          throw terminal;
        }
      } catch (error) {
        await connection?.close().catch(() => undefined);
        connection = undefined;
        throw error;
      }
    },
  });
  if (action === 'status') { console.log(JSON.stringify(await inbox.status(), null, 2)); return; }
  const source = join(config['plugin-repo'], 'control-plane/packages/work-events/src');
  const { SqliteWorkEventReader } = await tsImport(join(source, 'sqlite-reader.ts'));
  const reader = new SqliteWorkEventReader(config.db, config.owner, config.device);
  let checkpoint;
  try {
    if (action === 'once') {
      console.log(JSON.stringify({ head: await reader.head(), snapshots: await reader.snapshots(null, 64), inbox: await inbox.status(), readOnly: true }, null, 2));
      return;
    }
    await mkdir(config.directory, { recursive: true, mode: 0o700 });
    const directory = await realpath(config.directory);
    const sourcePath = await realpath(config.db);
    const inside = relative(directory, sourcePath);
    if (!inside.startsWith('..') && !isAbsolute(inside)) throw Error('Source ledger must be outside the inbox directory');
    for (const name of ['inbox.json', 'source-checkpoint.json', 'source-checkpoint.json.lock.sqlite',
      'source-checkpoint.json.lock.sqlite-wal', 'source-checkpoint.json.lock.sqlite-shm', 'source-checkpoint.json.lock.sqlite-journal']) {
      const stat = await lstat(join(directory, name)).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)) {
        throw Error('Inbox/checkpoint files must be private regular files, not aliases');
      }
    }
    const [{ FileProjectionCheckpoint }, { WorkStatusPump }] = await Promise.all([
      tsImport(join(source, 'checkpoint.ts')), tsImport(join(source, 'pump.ts')),
    ]);
    // Binding also prevents pending delivery from being redirected to another workflow/source.
    const scope = JSON.stringify([sourcePath, config.owner, config.device, config['workflow-id'], config.address ?? '127.0.0.1:7233', config.namespace ?? 'default']);
    checkpoint = new FileProjectionCheckpoint(join(directory, 'source-checkpoint.json'), scope);
    // Never reset a checkpoint implicitly: an attempt directory is durable history, not a restart token.
    const terminalReported = new Set();
    const reportTerminal = async () => {
      const current = await inbox.status();
      for (const [id, record] of Object.entries(current.events)) {
        if (record.delivery === 'target_closed' && !terminalReported.has(id)) {
          terminalReported.add(id);
          console.error(JSON.stringify({ type: 'flowdeck.work-events.target_closed', workflowId: config['workflow-id'],
            eventId: record.event.eventId, attempts: record.attempts, message: 'Event retained; target is closed or missing; no automatic retry' }));
        }
      }
    };
    const pump = new WorkStatusPump(reader, {
      async publish(event) { await inbox.ingest(event, { live: event.origin === 'event' }); },
    }, checkpoint, () => 0); // MVP: disable periodic snapshot cursor jumps; preserve startup and gap handling.
    let stopping = false;
    const stop = () => { stopping = true; };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    let ready = false;
    try {
      while (!stopping) {
        // Source/persistence failures exit rather than reuse an uncertain barrier.
        // Temporal failures are retained by the inbox and retried on subsequent iterations.
        const result = await drainForReadiness(pump, checkpoint, inbox);
        await reportTerminal();
        if (!ready && result.ready && !stopping) {
          // Recheck after delivery: old pending events may have moved the workflow out of manual wait.
          await preflightWorkflow(config);
          if (!stopping) {
            console.log(JSON.stringify({ type: 'flowdeck.work-events.ready', workflowId: config['workflow-id'],
              ownerId: config.owner, deviceId: config.device, snapshot: null, pending: result.pending, blocked: result.blocked }));
            ready = true;
          }
        }
        if (!result.more) await delay(1000);
      }
    } finally {
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  } finally {
    reader.close();
    checkpoint?.close();
    await connection?.close();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(String(error)); process.exitCode = 1; });
}
