#!/usr/bin/env node
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline';
import { resolve, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { readEventConfig, assertManualStart } from './flowdeck-work-events.mjs';
import {inspectAttemptScope} from './flowdeck-attempt-scope.mjs';

const root = resolve(import.meta.dirname, '..');
export const usage = 'Usage: node scripts/flowdeck-launch.mjs PROJECT_ID /absolute/event-config.json [--attempt NAME]\nUses existing dist build. An attempt gets workflow flowdeck-supervisor-PROJECT_ID--NAME and an isolated inbox. Never retries or reuses a start.';
const exec = promisify(execFile);

export async function launch(projectId, configPath, deps = {}, attempt) {
  if (!/^[-a-zA-Z0-9_]{1,80}$/.test(projectId ?? '') || !isAbsolute(configPath ?? '')
    || (attempt !== undefined && !/^[-a-zA-Z0-9_]{1,80}$/.test(attempt))) throw Error(usage);
  const originalConfig = await (deps.readConfig ?? readEventConfig)({ config: configPath });
  const workflowId = 'flowdeck-supervisor-' + projectId + (attempt === undefined ? '' : '--' + attempt);
  const legacyWorkflowId = 'flowdeck-supervisor-' + projectId;
  if (originalConfig['workflow-id'] !== workflowId && !(attempt !== undefined && originalConfig['workflow-id'] === legacyWorkflowId)) {
    throw Error('Config workflow must match ' + workflowId);
  }
  const config = attempt === undefined ? originalConfig : {
    ...originalConfig, 'project-id': projectId, 'workflow-id': workflowId,
    directory: join(originalConfig.directory, 'attempt-' + attempt),
  };
  // The authoritative dist loader checks enrollment and approved active-plan tasks before spawning anything.
  const loadProject = deps.loadProject ?? (await import('../dist/flowdeck-projects.js')).createSupervisorProjectLoader({ base: root });
  const project = await loadProject(projectId);
  if (project.id !== projectId || project.ownerId !== config.owner || project.deviceId !== config.device) {
    throw Error('Event config owner/device must match project enrollment');
  }
  // Read-only early rejection. The raw CLI start owns the atomic exclusive claim,
  // even when two launcher processes pass this check at the same instant.
  if ((await (deps.inspectScope ?? inspectAttemptScope)(root,project)).occupied)
    throw Error('Browser-owner scope already claimed; audited reconciliation required');
  // Never start the 30-minute attended timer without an independently created,
  // read-only-verified empty Project target. Old sessions cannot serve as P1 tabs.
  if (project.id.startsWith('sashai-fresh-attended-'))
    await (deps.verifyPrepared ?? (await import('./flowdeck-prepare-manual-start.mjs')).verifyPreparedSurface)(project);
  const env = { ...process.env, TEMPORAL_ADDRESS: config.address ?? '127.0.0.1:7233',
    TEMPORAL_NAMESPACE: config.namespace ?? 'default' };
  const spawnChild = deps.spawn ?? spawn, execute = deps.exec ?? exec;
  const signals = deps.signals ?? process, log = deps.log ?? console.log;
  const children = [], readers = [];
  const controller = new AbortController();
  const deadline = Date.now() + 30_000;
  let rejectFailure, resolveStopped, stopping = false;
  const failure = new Promise((_, reject) => { rejectFailure = reject; });
  const stopped = new Promise(resolve => { resolveStopped = resolve; });
  // Keep failures observed even during synchronous transitions between waits.
  failure.catch(() => {});
  const fail = error => { controller.abort(); rejectFailure(error); };
  const stop = () => { stopping = true; controller.abort(); resolveStopped(); };
  signals.once('SIGINT', stop);
  signals.once('SIGTERM', stop);
  const timer = setTimeout(() => fail(Error('Startup exceeded 30 seconds; inspect workflow before any relaunch')), 30_000);
  const guard = promise => Promise.race([failure, stopped.then(() => { throw Error('Launch interrupted'); }), promise]);
  function child(script, args, name, accepts) {
    const proc = spawnChild(process.execPath, [join(root, 'scripts', script), ...args], {
      cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const entry = { proc, exited: false, closed: null };
    children.push(entry);
    entry.closed = new Promise(resolve => {
      proc.once('exit', (code, signal) => {
        entry.exited = true;
        resolve();
        if (!stopping) fail(Error(`${name} exited (code ${code}, signal ${signal}); no automatic restart`));
      });
      proc.once('error', error => { entry.exited = true; resolve(); fail(Error(`${name}: ${error.message}`)); });
    });
    proc.stderr.on('data', chunk => (deps.stderr ?? process.stderr).write(chunk));
    const lines = createInterface({ input: proc.stdout });
    readers.push(lines);
    const ready = new Promise(resolve => {
      lines.on('line', line => {
        log(`[${name}] ${line}`);
        if (accepts(line)) resolve();
      });
    });
    return guard(ready);
  }
  async function cli(action) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Error('Startup exceeded 30 seconds; inspect workflow before any relaunch');
    const supervisorArgs = [join(root, 'scripts/flowdeck-supervisor.mjs'), action, projectId,
      ...(attempt === undefined ? [] : ['--attempt', attempt])];
    const result = await guard(execute(process.execPath, supervisorArgs, {
      cwd: root, env, timeout: Math.min(5000, remaining), killSignal: 'SIGKILL',
      signal: controller.signal, maxBuffer: 1024 * 1024,
    }));
    return JSON.parse(result.stdout);
  }
  try {
    // Fail before spawning a sender if any run (including a closed run) already exists.
    const existing = await cli('workflow-status');
    if (existing.exists !== false || existing.workflowId !== workflowId) throw Error('Workflow already exists; inspect it rather than relaunching');
    await child('flowdeck-supervisor.mjs', ['worker'], 'worker', line => line.startsWith('READY:'));
    await cli('start'); // Exactly one attempt. Existing script enforces reject-duplicate/conflict and sender claims.
    while (true) {
      const status = await cli('workflow-status');
      if (status.workflowId !== workflowId || status.temporal !== 'RUNNING' || status.state?.projectId !== projectId) {
        throw Error('Started workflow is not RUNNING for the requested project');
      }
      if (status.state.phase === 'waiting_for_manual_start') { assertManualStart(status, workflowId, projectId); break; }
      if (status.state.phase !== 'loading') throw Error('Workflow left startup: ' + status.state.phase);
      await guard((deps.delay ?? delay)(200));
    }
    await child('flowdeck-work-events.mjs', ['follow', '--config', configPath,
      // Pin validated values so an edited config cannot redirect this child after validation.
      ...['plugin-repo', 'db', 'owner', 'device', 'workflow-id', 'directory', 'project-id']
              .filter(key => config[key] !== undefined).flatMap(key => ['--' + key, config[key]]),
      '--address', env.TEMPORAL_ADDRESS, '--namespace', env.TEMPORAL_NAMESPACE], 'follower', line => {
      try {
        const value = JSON.parse(line);
        return value.type === 'flowdeck.work-events.ready' && value.workflowId === workflowId &&
          value.ownerId === config.owner && value.deviceId === config.device && value.snapshot === null &&
          value.pending === 0 && (value.blocked ?? 0) === 0;
      } catch { return false; }
    });
    clearTimeout(timer);
    log('ALL COMPONENTS READY MANUAL START NOW');
    await Promise.race([failure, stopped]);
  } catch (error) {
    if (!stopping) throw error;
  } finally {
    stopping = true;
    controller.abort();
    clearTimeout(timer);
    for (const { proc, exited } of children) if (!exited) proc.kill('SIGTERM');
    const closed = Promise.all(children.map(entry => entry.closed));
    let escalation;
    await Promise.race([closed, new Promise(resolve => {
      escalation = setTimeout(() => {
        for (const entry of children) if (!entry.exited) entry.proc.kill('SIGKILL');
        resolve();
      }, 2000);
    })]);
    clearTimeout(escalation);
    for (const reader of readers) reader.close();
    signals.removeListener('SIGINT', stop);
    signals.removeListener('SIGTERM', stop);
  }
}

export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(usage); return; }
  if (args.length !== 2 && args.length !== 4 || (args.length === 4 && (args[2] !== '--attempt' || !/^[-a-zA-Z0-9_]{1,80}$/.test(args[3])))) throw Error(usage);
  await launch(args[0], args[1], {}, args[3]);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(String(error)); process.exitCode = 1; });
}
