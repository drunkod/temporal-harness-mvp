import { NativeConnection, Worker } from '@temporalio/worker';
import * as activities from './activities.js';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233' });
const worker = await Worker.create({
  connection,
  namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
  taskQueue: 'repo-harness-mvp',
  workflowsPath: join(here, 'workflows.js'),
  activities,
  maxConcurrentActivityTaskExecutions: 1,
  maxConcurrentWorkflowTaskExecutions: 2,
});
console.log('READY: Temporal worker listening on repo-harness-mvp');
await worker.run();
