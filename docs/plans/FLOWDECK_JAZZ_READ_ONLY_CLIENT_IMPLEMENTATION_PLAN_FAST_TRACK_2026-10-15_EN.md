# Flowdeck — Read-Only Jazz Live Status Client Implementation Plan

**Date:** October 15, 2026  
**For:** Lead architect, `~/Documents/work/temporal-harness-mvp`  
**Upstream plugin:** `/Users/test/Documents/RemoteMCP-Jazz/repositories/RemoteMCP-Jazz`  
**Priority:** Small, parallel integration slice for the one-day autonomous-supervisor MVP. Must not gate the event-triggered supervisor if Jazz is unavailable.

## FAST-TRACK PRIORITY OVERRIDE — minimum functioning client first

The owner now explicitly wants **rapid implementation and a working live demonstration**, not a new reliability or security-hardening project. Start the minimal client and event bridge immediately. The steps below are a technical reference, but **the full test matrix in the original plan is deferred** unless a specific issue blocks basic operation.

**Day-one delivery order:**

1. Add a clearly labelled Flowdeck link to the existing authorized plugin status panel **immediately** as a zero-rewrite fallback. Confirm it actually shows current owner work rows; merely adding a link is not a successful embedded-client implementation.
2. Implement the smallest **owner-authorized read-only Jazz subscriber** in an isolated Flowdeck bundle, using the *actual plugin* `jazz-tools@2.0.0-alpha.53` `JazzProvider`/array-returning `useAll` pattern and deployed schema. Solve the cross-origin session/capability issue only through a narrowly scoped permitted integration, or leave embedding as a documented blocker while the rest continues.
3. Prove one `begin_work → active` and `finish_work → reported` live display update without a manual refresh. Show a visible stale/error state on failure; keep Jazz optional.
4. In parallel, wire the **existing non-Jazz event connector** to a small Temporal wake-up handler and begin the minimum approved ChatGPT Project supervisor loop. Do not wait for the widget to be perfect.

**Defer to later:** exhaustive auth/error-path matrix, latency certification, full cross-feature benchmarks, extensive fault injection, schema upgrades, UI-framework migration, general SDK modernization and production release documentation. Record those items in the deferred backlog.

**Minimal constraints still apply:** no unauthorized Jazz reads, exposed tokens/cookies/private keys, new MCP awaited calls, arbitrary task execution or repeated ChatGPT sends after uncertain outcome. These protect the basic function and are **not** an invitation to build a larger safety subsystem. The implementation must be modular and removable without affecting MCP/Temporal. A simple read-only client can be developed without promising mathematically zero resource overhead.

**First-pass test:** the two real visible status transitions, correct owner scope and stale/failure state, and no visible interruption of existing MCP/Temporal behavior. Full p95≤750ms and MCP performance parity are targets for separate follow-up validation, not prerequisites to the first smoke demonstration.

---

## 1. Decision and architecture

**Build a modular read-only Jazz client in Flowdeck to display the status already projected by RemoteMCP-Jazz. Do not scrape the plugin's dashboard or install a second Jazz projector.** Subscribe to its existing authorized Jazz app, using the same deployed schema and the exact package version `jazz-tools@2.0.0-alpha.53`. Do not create another database or duplicate `begin_work`/`finish_work`.

The existing plugin implementation already provides:

- `begin_work` / `finish_work` → SQLite work reports/notices (`work_started` / `work_reported`), outside Jazz.
- An independent, read-only work-event follower (`control-plane/packages/work-events/`) with a separate checkpoint, including `TemporalSupervisorAdapter` as a callback-only interface.
- A separate Jazz projector writing `workStatusViews` (current sessions) and `workStatusHealth` (publisher freshness).
- An authenticated dashboard using a **short-lived, owner-scoped read-only JWT** and live `useAll()` subscriptions; no browser writes.

**Two separate lanes:**

```text
Control plane SQLite work events
   ├── Independent JSONL / TypeScript event consumer ──> Flowdeck durable inbox
   │                                                   └─> Temporal wake → identify chat
   │                                                       → observe/continue/next task
   └── Existing isolated Jazz projector ──> Jazz Core ──> Flowdeck Jazz client
                                                            └─> live status UI ONLY

   MCP dispatch/command execution ────────────────────────────────────────── unchanged
```

**Do not drive Temporal from `useAll()` row changes.** Jazz is a synchronized latest-state projection, not a guaranteed complete event stream, nor proof a given ChatGPT task is finished. Use the event adapter with durable deduplication for decisions. Do not read `/api/device/notices/pending`: it leases macOS notifications and would interfere with their delivery.

## 2. Compatibility and auth boundaries — solve before embedding

The installed RemoteMCP-Jazz package is **exactly `jazz-tools@2.0.0-alpha.53`**. Current upstream Jazz documentation is evolving; some newest examples return `{ data, isLoading, error }` from `useAll`, but the **actual plugin alpha.53 panel returns an array or `undefined`**. Copy/test the *installed* API, not the latest snippets blindly. Match the app/schema migration, JWT issuer/audience, permissions, and package lock; never silently upgrade Jazz or redeploy schema as part of this Flowdeck task.

The existing bootstrap is **`POST /api/dashboard/work-status/config`** at the **plugin's web origin**, authenticated with the plugin's Better Auth dashboard session. It issues the owner identifier, Jazz app ID, sync URL and a **120-second dashboard capability** (the server holds the ES256 signing key). The current panel calls it with `credentials: "same-origin"`; the client uses an in-memory Jazz driver and refreshes the token on expiry. The server enforces owner-scoped read permissions and denies writes on status tables.

**Important blocker:** Flowdeck is currently a Node HTTP dashboard at `127.0.0.1:4319` serving plain HTML, not the plugin's authenticated origin. A direct relative `fetch('/api/dashboard/work-status/config')` from Flowdeck is **not** a valid integration. Do not assume cross-origin cookies/CORS or iframe embedding are allowed. Never put the Jazz admin secret, private JWK, session cookie or backend credentials in Flowdeck's HTML or JS.

Choose one of these explicit, consented approaches:

1. **Fastest no-change pilot:** link from Flowdeck to the plugin's existing authorized *Work sessions · Jazz projection* panel. This exercises real-time visibility today, but it is **not** an embedded Flowdeck client. Keep the main orchestration lane moving.
2. **Preferred embedded Flowdeck client:** implement a small authorized capability-bootstrap arrangement for the Flowdeck origin, preserving the plugin's existing login, owner scope and short expiry, with strict origin, session, CSRF and permission checks. Coordinate any unavoidable, narrowly scoped endpoint/interface change with the RemoteMCP-Jazz architect. Validate the actual browser hosting/Tailscale/HTTPS arrangement first. No ad-hoc cookie forwarding or open CORS.
3. **If authorized same-origin hosting is readily available:** host the status widget under the plugin's authenticated origin and link/open it from Flowdeck; an iframe is optional **only** if CSP, authentication and embedding policies explicitly permit it.

**Stop here if auth cannot be solved without a larger project:** display a link and a clear `External status — open plugin dashboard` indicator. Do not sacrifice the one-day automation MVP or weaken authentication.

## 3. Narrow implementation steps for the main codebase

**Step A — prove subscriber compatibility (about 30–60 minutes, estimate only).** Read the plugin files listed below and its installed `node_modules` exports. Determine the reachable Jazz Core URL in the browser and owner-scoped bootstrap strategy. Build a disposable *read-only* subscriber using the plugin's pinned version and observe two real known work rows under an authorized owner session. Do not write or alter plugin tables. Defer a separate exhaustive wrong-owner automated test suite; retain existing server-enforced owner permissions.

**Step B — modularize the UI (about 1–2 hours, estimate only).** Add a self-contained `flowdeck-jazz-status` web widget and build output served by the existing Flowdeck dashboard server. The main dashboard is currently plain HTML; avoid migrating it to React/Next.js. A tiny, isolated React island is acceptable because the plugin already has a working `JazzProvider`/`useAll` implementation; a verified vanilla TypeScript client is also fine if it avoids extra dependencies. Only the widget bundle imports Jazz. Keep a shared, versioned read-only schema definition matching the existing plugin, or generate a contract from the source; never fork application authority or duplicate publishing logic.

**Step C — display actual status.** Subscribe to `workStatusViews.where({ ownerId })` (sorted/limited, e.g. 30) and `workStatusHealth.where({ ownerId })`. Render work ID, device, `active` vs `reported`, reported `success|partial|failed`, revision, source-recorded/projection/client-observed timestamps, and fresh/stale state. Clearly label the outcome **"agent reported"**, not "task verified". Show an owner-scoped empty state and an auth/reconnect/error state. Disconnect cleanly on widget unmount/logout.

**Step D — protect performance and lifecycle.** Run subscription entirely in the browser widget; no Jazz imports in the Temporal Worker, MCP dispatch process or macOS notifier. Do not add a status polling HTTP loop. A one-second **UI-only** clock is fine for health freshness labels. Treat health `observedAt` older than **45 seconds** as **freshness unconfirmed**, not process exit, idle-task failure or verified stopped status. Use `memory` driver if matching the plugin's existing practice and avoiding local sensitive cache is preferred. No writes to the plugin's Jazz tables.

**Step E — integrate with separate event-led automation.** Implement independent work events → durable consumer inbox → Temporal signal/wake via JSONL or custom sink. Deduplicate `(source,ownerId,deviceId,eventId)`; respect source revisions and snapshot reconciliation; map `workId` to project/chat/attempt only if uniquely established. On `work_reported`, observe the actual ChatGPT turn before deciding. The Jazz widget is an auxiliary view of the same work session, not a second scheduler.

**Step F — fast smoke acceptance and later hardening.** **For day one**, demonstrate one owner-authorized `begin_work`/`finish_work` row updating without refresh (or label the plugin-panel link as an interim fallback), correct owner-scoped display, and a stale/error state when Jazz is unavailable. Confirm the status client can be disabled independently and that the ordinary MCP work session still functions. **Defer** the full wrong-owner/auth lifecycle matrix, stale-revision replay/fault suites, end-to-end latency certification, reconnect soak, and controlled paired MCP p50/p95/p99 latency/throughput runs. The previous p95 **≤750 ms** source-to-render objective remains an unverified future target; the small native-subscriber numbers do not certify browser paint or production parity.

## 4. Code sketches: based on *deployed plugin alpha.53*, not generic latest docs

### 4.1 React live subscription — read-only model

Reuse or adapt the **working plugin** `work-status-panel.tsx`, not latest upstream return shapes:

```tsx
// Sketch only: supply `app`, `ownerId` and provider from authorized bootstrap.
// `app` must match the existing plugin's deployed status schema.
import { useAll, useDb } from "jazz-tools/react";

export function FlowdeckWorkStatus({ ownerId }: { ownerId: string }) {
  // alpha.53 useAll() returns Row[] | undefined, NOT {data,isLoading,error}.
  const rows = useAll(
    app.workStatusViews.where({ ownerId }).orderBy("projectedAt", "desc").limit(30),
    { tier: "global" }
  );
  const health = useAll(app.workStatusHealth.where({ ownerId }).limit(1),
    { tier: "global" });
  const db = useDb();
  const observedAt = health?.[0]?.observedAt;
  const fresh = Boolean(observedAt) &&
    Date.now() - Date.parse(observedAt!) <= 45_000 &&
    !db.getAuthState().error && navigator.onLine;

  return <section aria-label="RemoteMCP work status">
    <p>{fresh ? "Recently projected" : "Status stale/unconfirmed"}</p>
    {rows === undefined ? <p>Waiting for authorized rows...</p> :
      rows.map(row => <p key={row.id}>
        {row.workId} · {row.state} · revision {row.revision}
        {row.state === "reported" ? ` · ${row.outcome} (agent reported)` : ""}
      </p>)}
  </section>;
}
```

This is a **structural sketch**, not a compiled drop-in file: the `app` import, owner JWT bootstrap, bundling, cleanup and type checks must be resolved in the implementation. The production plugin widget additionally has an error boundary and a one-second UI-only freshness ticker; reuse those patterns.

### 4.2 Provider configuration — use only an authenticated, owner-scoped token

```tsx
// `config` must come from an approved, authenticated owner-only bootstrap.
// It must NOT be embedded in public static HTML.
const providerConfig = {
  appId: config.appId,
  serverUrl: config.serverUrl,
  jwtToken: config.token,                // short-lived owner capability
  driver: { type: "memory" as const },
  devMode: false,
};

<JazzProvider
  config={providerConfig}
  fallback={<p>Connecting to Jazz...</p>}
  onJWTExpired={refreshOwnerToken}      // recreate through approved auth flow
  autoAttachDevTools={false}
>
  <FlowdeckWorkStatus ownerId={config.ownerId} />
</JazzProvider>
```

This matches the plugin's **alpha.53** pattern. The latest Jazz documentation may use `JazzSessionProvider`, `createJazzSession()` and different token handling; do not mix versions without upgrading and verifying the *plugin first*.

### 4.3 Independent work event consumer — orchestration lane (pseudocode)

```ts
// Not a Jazz callback. Runs separately with its own durable inbox/checkpoint.
async function onWorkEvent(e: WorkEventV1) {
  assertExpectedOwnerAndDevice(e);
  const wasNew = await inbox.insertOnce({
    key: [e.source, e.ownerId, e.deviceId, e.eventId].join(":"),
    event: e,
  });
  if (!wasNew) return;
  if (e.origin === "snapshot") return reconcileLatestState(e.workId);
  // A work event is only a wake-up, never permission to send a browser message.
  const binding = await lookupUniquelyBoundChat(e.workId);
  if (!binding) return markNeedsCorrelation(e.workId);
  await temporalSignalBoundWorkflow(binding.workflowId, e.kind, e.eventId);
}
```

Ensure cursor/checkpoint advancement only follows durable ingestion; the **stock JSONL stdout follower does not prove downstream acknowledgement**. For stronger delivery use the plugin's `WorkStatusSink` and `WorkStatusPump`, acknowledging a durable Flowdeck inbox before the pump advances. `TemporalSupervisorAdapter` is only a callback wrapper, **not** a Temporal client.

## 5. Exact plugin source references (verified in the local MacBook working tree)

- `control-plane/apps/control-plane/app/dashboard/devices/work-status-panel.tsx` — real alpha.53 `JazzProvider`, owner bootstrap, `useAll()` arrays, token refresh, freshness UX.
- `control-plane/apps/control-plane/app/api/dashboard/work-status/config/route.ts` — dashboard auth required; owner-scoped bootstrap.
- `control-plane/apps/control-plane/lib/jazz-capability.ts` — scoped 120s dashboard JWT; no private signing key in clients.
- `control-plane/apps/control-plane/permissions.ts` — owner-scoped read, status table writes denied.
- `control-plane/packages/protocol/src/work-status-schema.ts` — `workStatusViews` / `workStatusHealth` fields.
- `control-plane/apps/control-plane/lib/jazz-work-status-projection.ts` — independent single-writer projector.
- `control-plane/packages/work-events/src/{contracts,sqlite-reader,pump,checkpoint,watch,supervisor-adapter}.ts` — source event reader, own checkpoint and orchestration-neutral wake-up.
- `control-plane/apps/control-plane/scripts/work-events.ts` — CLI `events`, `snapshot`, `follow`; separate from Jazz when `REMOTE_MCP_JAZZ_STATUS=0`.
- `docs/live-status/{EXTERNAL-INTEGRATION,README}.md` — implemented contracts, cross-process isolation, incomplete production verification and restart semantics.

## 6. Official Jazz documentation and examples — reference only; check alpha.53 compatibility

- [How Sync Works](https://jazz.tools/docs/concepts/how-sync-works): subscriptions, local replica, reconnect, eventual consistency; not a guaranteed event queue.
- [Reading: Queries](https://jazz.tools/docs/reading/queries): live subscriptions and query options.
- [Durability Tiers](https://jazz.tools/docs/reference/durability-tiers): `tier: "global"` for stronger initial remote read.
- [Permissions](https://jazz.tools/docs/auth/permissions): server-enforced per-row owner access.
- [Client Setup](https://jazz.tools/docs/getting-started/client-setup): current session/connection lifecycle; API may differ from alpha.53.
- [Framework Patterns](https://jazz.tools/docs/reference/framework-patterns): current framework hooks; **different `useAll` result shape**.
- [React local-first example](https://github.com/garden-co/jazz/tree/main/examples/todo-client-localfirst-react): React query subscriptions.
- [Vanilla TypeScript example](https://github.com/garden-co/jazz/tree/main/examples/todo-client-localfirst-ts): non-React subscriber patterns.
- [Next.js SSR/CSR example](https://github.com/garden-co/jazz/tree/main/examples/nextjs-csr-ssr): separate browser vs backend runtimes; **do not migrate Flowdeck to Next.js**.

## 7. Fast-track acceptance checklist and deferred testing

**Day-one smoke gate (must be observable, but lightweight):**

- Owner-authorized Jazz status can be viewed immediately through the existing plugin panel; the embedded Flowdeck client, if authorized bootstrap is available, shows `active → reported` **without manual refresh**. Clearly label any linked-only fallback.
- Display the correct work/device/owner scope; mark outcomes `agent reported` and missing health `stale/unconfirmed`. Never expose signing credentials or allow status writes.
- With the client closed/disabled, normal MCP work and Temporal event processing still function; no Jazz operation is awaited on the MCP execution path.
- Flowdeck records what actually worked and what is still blocked, then proceeds with the core autonomous-supervisor MVP.

**Defer:** complete token-expiry/reconnect matrix, adversarial wrong-owner tests (existing authorization must still remain enforced), full revision/fault-injection matrix, browser-latency certification, paired p50/p95/p99/throughput runs, and any production-readiness claim. Perform these before claiming a fully validated production deployment, not before the first minimal live demonstration.

**Scope rule:** implement the Flowdeck display client as an *isolated parallel feature*. Do not turn this into a general Jazz migration, new authentication system, or new prerequisite for the one-day autonomous ChatGPT supervision cycle.

**Status of this memo:** architectural implementation instructions only; no MacBook code or services were changed while drafting it.
