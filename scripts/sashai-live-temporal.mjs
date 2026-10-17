#!/usr/bin/env node
/**
 * Explicit, approved one-off report pilot. Nothing starts automatically.
 * From the repository root, after the installation gate/build has passed:
 *   node scripts/sashai-live-temporal.mjs status   (default; read-only)
 *   node scripts/sashai-live-temporal.mjs worker   (foreground, user-operated)
 *   node scripts/sashai-live-temporal.mjs start    (ONE approved workflow)
 *
 * No resume, reset, retry, workflow-ID override, or next-task command is exposed.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {
  Client, Connection, WorkflowIdConflictPolicy, WorkflowIdReusePolicy, WorkflowNotFoundError,
} from '@temporalio/client';

const root = resolve(import.meta.dirname, '..');
const workflowId = 'sashai-task-routing-report-live-v1';
const taskQueue = 'oracle-sashai-live-report';
const contractPath = join(root, 'docs', 'SASHAI-LIVE-TEMPORAL-REPORT-TASK.md');
const address = process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233';
const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
const command = process.argv[2] || 'status';
const usage = `Usage: node scripts/sashai-live-temporal.mjs [status|worker|start|help]
Default: status (read-only). Build and pass the installation gate before worker/start.
worker: foreground worker on ${taskQueue}; does not start a workflow.
start: explicitly starts the single approved report workflow; refuses existing executions.
Contract: docs/SASHAI-LIVE-TEMPORAL-REPORT-TASK.md (SHA-256 passed to preparation).
No retries/resume/reset, general dispatch, or next tasks are permitted.`;
const print = value => console.log(JSON.stringify(value, null, 2));

async function approvedContractSha256() {
  const bytes = await readFile(contractPath);
  const text = bytes.toString('utf8');
  for (const required of [
    'Approval: APPROVED, report-only',
    'Scope: ONE initial',
    'Task ID: `' + workflowId + '`',
    'After final acceptance, stop at `verified_approval_boundary`',
  ]) {
    if (!text.includes(required)) throw Error('Approved one-off contract mismatch: ' + required);
  }
  return createHash('sha256').update(bytes).digest('hex');
}

async function describeOrAbsent(handle) {
  try {
    return await handle.describe();
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) return null;
    throw error; // Connection/auth failures must never authorize a new execution.
  }
}

async function main() {
  if (process.argv.length > 3 || !['status', 'worker', 'start', 'help', '--help', '-h'].includes(command)) {
    throw Error(usage);
  }
  if (['help', '--help', '-h'].includes(command)) {
    console.log(usage);
    return;
  }
  if (command === 'worker') {
    // Activities use repository-relative durable storage; never inherit an arbitrary cwd.
    process.chdir(root);
    const {NativeConnection, Worker} = await import('@temporalio/worker');
    const {liveReportActivities: activities} = await import('../dist/sashai-live-report-activities.js');
    if (!activities || typeof activities !== 'object') throw Error('Build/install gate incomplete: missing liveReportActivities');
    for (const name of ['prepareLiveAttempt', 'submitLiveOnce', 'observeLive', 'verifyLiveReport',
      'correctLiveOnce', 'reconcileLiveSend', 'recordLiveAcceptance']) {
      if (typeof activities[name] !== 'function') throw Error('Build/install gate incomplete: missing activity ' + name);
    }
    const connection = await NativeConnection.connect({address});
    try {
      const worker = await Worker.create({
        connection, namespace, taskQueue,
        workflowsPath: join(root, 'dist', 'sashai-live-report-workflow.js'),
        activities, maxConcurrentActivityTaskExecutions: 1, maxConcurrentWorkflowTaskExecutions: 2,
      });
      console.log('READY: approved report-only worker on ' + taskQueue + '; no workflow auto-started.');
      await worker.run();
    } finally {
      await connection.close();
    }
    return;
  }

  const expectedContractSha256 = command === 'start' ? await approvedContractSha256() : null;
  const connection = await Connection.connect({address});
  try {
    const client = new Client({connection, namespace});
    const handle = client.workflow.getHandle(workflowId);
    const description = await describeOrAbsent(handle);
    if (command === 'start') {
      if (description) throw Error('One-off workflow execution already exists; reuse is forbidden: ' + workflowId);
      const started = await client.workflow.start('liveSashaiReportLifecycle', {
        workflowId, taskQueue, args: [expectedContractSha256],
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        workflowIdConflictPolicy: WorkflowIdConflictPolicy.FAIL,
        // Activity timeouts and both 60-poll loops are also independently bounded.
        workflowExecutionTimeout: '3 hours',
        retry: {maximumAttempts: 1},
      });
      print({started: true, workflowId: started.workflowId, runId: started.firstExecutionRunId,
        taskQueue, expectedContractSha256, dispatchPermitted: false, nextTaskPermitted: false});
    } else if (!description) {
      print({exists: false, workflowId, taskQueue, dispatchPermitted: false, nextTaskPermitted: false});
    } else {
      const pinned = client.workflow.getHandle(workflowId, description.runId);
      const temporalStatus = description.status.name;
      const state = temporalStatus === 'RUNNING' ? await pinned.query('liveSashaiReportStatus')
        : temporalStatus === 'COMPLETED' ? await pinned.result() : null;
      print({exists: true, workflowId, runId: description.runId, taskQueue, temporalStatus, state,
        dispatchPermitted: false, nextTaskPermitted: false});
    }
  } finally {
    await connection.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
