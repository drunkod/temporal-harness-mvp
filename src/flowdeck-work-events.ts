import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** SDK-free DTO copied from RemoteMCP-Jazz control-plane/packages/work-events/src/contracts.ts. */
export type WorkEventV1 = Readonly<{
  schema: 'remote-mcp.work-event/v1';
  source: 'remote-mcp-jazz';
  eventId: string; workId: string; ownerId: string; deviceId: string;
  kind: 'work_started' | 'work_reported'; revision: 1 | 2;
  sourceCommittedAt: string; startedAt: string; reportedAt?: string;
  timestampEvidence: 'recorded_in_source_transaction';
  completionEvidence: 'none' | 'agent_report_only';
  executionVerified: false; backgroundProcesses: 'unknown';
  outcome?: 'success' | 'partial' | 'failed'; origin: 'event' | 'snapshot';
}>;
type RecordEntry = { event: WorkEventV1; delivery: 'historical' | 'pending' | 'delivered' | 'target_closed'; attempts: number; lastError?: string };

type State = {
  schema: 'flowdeck.work-inbox/v1'; ownerId: string; deviceId: string;
  events: Record<string, RecordEntry>; snapshots: Record<string, WorkEventV1>;
};
const key = (event: WorkEventV1) => JSON.stringify([event.source, event.ownerId, event.deviceId, event.eventId]);

function validate(event: WorkEventV1, ownerId: string, deviceId: string): void {
  if (!event || event.schema !== 'remote-mcp.work-event/v1' || event.source !== 'remote-mcp-jazz'
    || event.ownerId !== ownerId || event.deviceId !== deviceId) throw new Error('Work event scope/schema mismatch');
  if (![event.eventId, event.workId].every(value => typeof value === 'string' && value.trim())
    || !['event', 'snapshot'].includes(event.origin)
    || event.executionVerified !== false || event.backgroundProcesses !== 'unknown'
    || event.timestampEvidence !== 'recorded_in_source_transaction'
    || ![event.startedAt, event.sourceCommittedAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))) {
    throw new Error('Invalid WorkEventV1');
  }
  const started = event.kind === 'work_started' && event.revision === 1 && event.completionEvidence === 'none'
    && event.outcome === undefined && event.reportedAt === undefined;
  const reported = event.kind === 'work_reported' && event.revision === 2 && event.completionEvidence === 'agent_report_only'
    && ['success', 'partial', 'failed'].includes(event.outcome ?? '')
    && typeof event.reportedAt === 'string' && Number.isFinite(Date.parse(event.reportedAt));
  if (!started && !reported) throw new Error('Invalid work kind/revision/evidence');
}

/** One writer per directory. The CLI holds the plugin checkpoint's exclusive process lock. */
export function createWorkEventInbox(options: {
  directory: string; ownerId: string; deviceId: string; wake: (event: WorkEventV1) => Promise<void>;
}) {
  const { directory, ownerId, deviceId, wake } = options;
  if (![directory, ownerId, deviceId].every(value => typeof value === 'string' && value.trim())) {
    throw new Error('Explicit directory, ownerId and deviceId required');
  }
  const path = join(directory, 'inbox.json');
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation);
    queue = result.catch(() => undefined);
    return result;
  }
  async function load(): Promise<State> {
    let bytes: string;
    try { bytes = await readFile(path, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { schema: 'flowdeck.work-inbox/v1', ownerId, deviceId, events: {}, snapshots: {} };
    }
    const state = JSON.parse(bytes) as State;
    if (state.schema !== 'flowdeck.work-inbox/v1' || state.ownerId !== ownerId || state.deviceId !== deviceId
      || !state.events || !state.snapshots) throw new Error('Inbox scope/schema mismatch');
    for (const [id, record] of Object.entries(state.events)) {
      validate(record.event, ownerId, deviceId);
      if (record.event.origin !== 'event' || id !== key(record.event)
        || !['pending', 'historical', 'delivered', 'target_closed'].includes(record.delivery)
        || !Number.isInteger(record.attempts) || record.attempts < 0) throw new Error('Invalid inbox record');
    }
    for (const event of Object.values(state.snapshots)) validate(event, ownerId, deviceId);
    return state;
  }
  async function persist(state: State): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temporary, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify(state)); await file.sync(); } finally { await file.close(); }
      await rename(temporary, path);
      const folder = await open(directory, 'r');
      try { await folder.sync(); } finally { await folder.close(); }
    } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
  async function deliver(state: State, record: RecordEntry): Promise<void> {
    // The pending record is already fsynced before any external side effect.
    record.attempts += 1;
    try {
      await wake(structuredClone(record.event));
      record.delivery = 'delivered';
      delete record.lastError;
    } catch (error) {
      record.lastError = String(error);
      if ((error as { code?: string })?.code === 'FLOWDECK_TARGET_CLOSED') record.delivery = 'target_closed';
    }
    await persist(state);
  }
  return {
    ingest(event: WorkEventV1, admission: { live?: boolean } = {}) {
      const copy = structuredClone(event);
      return serial(async () => {
        validate(copy, ownerId, deviceId);
        const state = await load();
        if (copy.origin === 'snapshot') {
          const id = JSON.stringify([copy.source, ownerId, deviceId, copy.workId]);
          const previous = state.snapshots[id];
          if (!previous || copy.revision >= previous.revision) state.snapshots[id] = copy;
          await persist(state);
          return { disposition: 'snapshot' as const };
        }
        const id = key(copy);
        const previous = state.events[id];
        if (previous) return { disposition: 'duplicate' as const, delivery: previous.delivery };
        const record: RecordEntry = { event: copy, delivery: admission.live === true ? 'pending' : 'historical', attempts: 0 };
        state.events[id] = record;
        await persist(state);
        if (record.delivery === 'pending') await deliver(state, record);
        return { disposition: 'accepted' as const, delivery: record.delivery };
      });
    },
    retryPending() {
      return serial(async () => {
        const state = await load();
        for (const record of Object.values(state.events)) if (record.delivery === 'pending') await deliver(state, record);
        return { pending: Object.values(state.events).filter(record => record.delivery === 'pending').length,
                  blocked: Object.values(state.events).filter(record => record.delivery === 'target_closed').length };
      });
    },
    status() {
      return serial(async () => {
        const state = await load();
        return structuredClone({ ...state, pending: Object.values(state.events).filter(record => record.delivery === 'pending').length });
      });
    },
  };
}
