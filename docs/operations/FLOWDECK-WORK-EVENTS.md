# Flowdeck work-event inbox and Temporal bridge

Independent opt-in bridge. No Jazz dependency, plugin changes, source publisher/schema,
OS notice consumption, leases, dashboard registration, or worker changes.

## Contract and ownership

`src/flowdeck-work-events.ts` copies the SDK-free `WorkEventV1` DTO from
RemoteMCP-Jazz `control-plane/packages/work-events/src/contracts.ts` with attribution.
The plugin remains the sole owner of the source ledger, reader, pump, and checkpoint.
The script imports its actual `SqliteWorkEventReader`, `WorkStatusPump`, and
`FileProjectionCheckpoint` through the plugin's installed `tsx/cjs/api`, resolved by
`createRequire(<explicit plugin repo>/package.json)`. It does not fork their SQL,
create source tables, or call begin/finish or `/notices/pending`.
Run with a Node supporting `node:sqlite` (verified locally: Node 26.10.0 at the
current shell's Node executable). Node is the caller-selected executable; no
unverified global Node/tsx path is embedded and no dependency installation occurs.

Events preserve `source: remote-mcp-jazz`, owner/device/event/work IDs,
`work_started` revision 1 or `work_reported` revision 2, origin `event|snapshot`,
and `executionVerified: false`. A report is agent-reported evidence, **not proof of
execution**, process exit, or successful task completion. No task or workflow is
selected from an event. The plugin supervisor adapter was inspected but deliberately
is not used: it reduces the payload to a wake envelope, whereas this bridge must
send the **entire event**.

## Explicit configuration

Use flags or an explicit absolute `--config` JSON file with the same hyphenated keys.
Flags override the file. No credential discovery, environment-based scope inference,
or owner/device search is performed. All six flags below are required, including
for read-only commands. Paths must be absolute. Supply real values locally; this
example is a command template, not a live-activity instruction:

```sh
node scripts/flowdeck-work-events.mjs status \
  --plugin-repo /absolute/plugin-repository \
  --db /absolute/plugin-ledger.sqlite \
  --owner EXPLICIT_OWNER --device EXPLICIT_DEVICE \
  --workflow-id EXISTING_WORKFLOW_ID \
  --directory /absolute/private-flowdeck-inbox
```

- **`status` (default):** read inbox only; no source open, writes, Temporal
  connection, retry, checkpoint lock, or follower. Missing inbox returns empty state.
- **`once`:** one read-only source head plus at most 64 startup snapshots and inbox
  status; returns the plugin snapshot continuation token. No durable mutation or signals.
- **`follow`:** the only long-running/action mode. Persists source projection and
  inbox; sends eligible live events and retries pending deliveries. SIGINT/SIGTERM
  stops after the current operation. No workflow start, signal-with-start, or worker.
- Optional `--address` defaults to `127.0.0.1:7233`; `--namespace` to `default`.
  Temporal credentials/TLS are not discovered or implemented by this local bridge.

The directory must be private, outside the source ledger's location (the source
must not be contained in the inbox directory). Reserved files cannot be symlinks
or hard-link aliases. One writer per inbox directory; the CLI holds the plugin's
exclusive checkpoint SQLite process lock. Do not use this directory with another
writer/API instance, manually remove a live lock, or edit persisted files.

## Durability and admission

`createWorkEventInbox({ directory, ownerId, deviceId, wake: async event => ... })`
returns:

- `ingest(event, { live?: boolean })`: snapshots return `{ disposition: 'snapshot' }`;
  events return `accepted|duplicate` plus `delivery: historical|pending|delivered`.
  **Default admission is historical**, even for origin `event`. Only a caller with
  a proven live boundary should explicitly pass `{ live: true }`.
- `status()`: read-only full persisted state plus `pending` count.
- `retryPending()`: attempt only already-admitted pending deliveries; returns
  `{ pending: number }`. It never promotes historical records or snapshots.

`inbox.json` is a local delivery journal, not a new source event schema. Event dedup
key is the tuple `(source, ownerId, deviceId, eventId)`. Snapshots are held separately
by `(source, ownerId, deviceId, workId)` and reconcile non-decreasing revisions;
a repeated synthetic snapshot ID with a later revision **is not deduplicated away**.
Snapshots never schedule, even when `live: true` is passed. Snapshot IDs cannot
poison event deduplication. Historical duplicates cannot be promoted to live.

Every accepted event is written to a private temporary file, fsynced, renamed, and
the directory fsynced **before wake**, and before the sink promise resolves to the
plugin pump. A delivery exception is recorded as pending with attempts/error rather
than discarding the record; pump acknowledgement is safe because the inbox now
owns retry. Persistence exceptions reject ingestion and prevent checkpoint advance.
Operations in one inbox instance serialize to avoid duplicate concurrent admission.

Delivery is **at least once**: if Temporal accepts a signal but the process crashes
before the delivered marker is persisted, retry may signal it again. The parent
workflow must durably deduplicate the same identity tuple. Successful delivery
means Temporal accepted the signal, not that downstream execution was verified.
The journal currently retains all event identities; no retention/compaction policy
is introduced in this fast-track implementation.

## Bootstrap, replay, and reconnect

`source-checkpoint.json` and its plugin-owned SQLite lock are separate from
`inbox.json`; neither source snapshots nor checkpoint progress constitute scheduling
admission. The checkpoint scope includes canonical source path, owner, device,
workflow ID, address, and namespace; changing a binding requires a different inbox
directory rather than redirecting existing pending records.

Every explicit follow session resets only the source checkpoint to startup mode.
The real plugin pump captures a fresh scoped head, reconciles snapshots, then reads
events strictly after that head. Old checkpoint cursors and offline/startup history
are **never replayed as live**. Events committed after that captured head can signal,
including while the startup snapshot pagination is finishing. Pending inbox records
from earlier sessions still retry, even if their source events are now historical.

The plugin pump also owns periodic reconciliation (30 seconds), pruning/generation
gap handling, pagination, and checkpoint advancement. These snapshots do not wake.
Its source history is best-effort: reconciliation can move the cursor to a newer
head, and offline events are intentionally represented by latest state, not scheduled
retroactively. This is not a guaranteed complete source-event stream.

The explicit follower polls the existing pump every second (draining additional
pages without a delay). Temporal send/connect errors remain pending; the next
iteration establishes a fresh Temporal connection and retries. Source/persistence
errors exit and release resources; restart explicitly for a fresh bootstrap barrier.
No automatic source reconnect using a potentially historical cursor is attempted.

## Parent workflow integration

The script calls exactly:

```ts
await client.workflow.getHandle(configuredWorkflowId)
  .signal('supervisorWorkEvent', entireWorkEventV1);
```

The parent must register `supervisorWorkEvent` with a single `WorkEventV1` argument,
validate scope, durably deduplicate identities, and keep reported completion separate
from verified execution. No workflow implementation or worker registration is included
here. Until the configured workflow exists, live deliveries remain pending. A signal
is a wake/reconciliation input, not authorization for browser sends or task dispatch.

## Safe validation

```sh
node --test tests/flowdeck-work-events.test.mjs
./node_modules/.bin/tsc --noEmit -p tsconfig.json
node scripts/flowdeck-work-events.mjs --help
```

To additionally exercise the actual installed plugin pump against a fake source (no ledger):

```sh
FLOWDECK_TEST_PLUGIN_REPO=/absolute/plugin-repository node --test tests/flowdeck-work-events.test.mjs
```

The installed plugin loader uses `tsx/cjs/api` to avoid Node 26's native strip-only
loader taking over plugin TypeScript parameter properties. No plugin build is required.

Tests use temporary inboxes and fake wake callbacks only: dedup, revisions, scope,
pre-wake persistence, failed delivery/restart/retry, snapshots, historical admission,
concurrency, and persistence failure. No real begin/finish calls, followers, workers,
source writes, or Temporal signals are needed for validation.
