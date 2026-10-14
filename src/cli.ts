import { Connection, Client } from '@temporalio/client';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { roamingMvp, statusQuery } from './workflows.js';
const client = new Client({
  connection: await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233' }),
  namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
});
const [command, ...args] = process.argv.slice(2);
const root = resolve(process.env.MVP_ROOT ?? process.cwd());
const format = (v: unknown) => console.log(JSON.stringify(v, null, 2));
if (command === 'start') {
  const id = 'mvp-' + randomUUID().slice(0, 12);
  const handle = await client.workflow.start(roamingMvp, {
    taskQueue: 'repo-harness-mvp', workflowId: id,
    args: [{ root, maxTasks: 2, browserDryRun: !args.includes('--no-browser'), jev: !args.includes('--no-jev') }],
    workflowExecutionTimeout: '20 minutes',
  });
  console.log('WORKFLOW_ID=' + handle.workflowId);
  if (args.includes('--wait')) format(await handle.result());
} else if (command === 'status') {
  const id = args[0];
  if (!id) throw new Error('Use: npm run status -- <workflow-id>');
  const handle = client.workflow.getHandle(id);
  const details = await handle.describe();
  if (details.status.name === 'RUNNING') format({ temporal: details.status.name, ...(await handle.query(statusQuery)) });
  else format({ temporal: details.status.name, result: await handle.result().catch(e => ({ error: String(e) })) });
} else if (command === 'list') {
  const rows: unknown[] = [];
  for await (const row of client.workflow.list({ query: 'WorkflowType="roamingMvp"' })) {
    rows.push({ id: row.workflowId, status: row.status.name, start: row.startTime });
    if (rows.length >= 25) break;
  }
  format(rows);
} else {
  console.error('Usage: node dist/cli.js start [--wait] [--no-browser] [--no-jev] | status <id> | list');
  process.exitCode = 2;
}
