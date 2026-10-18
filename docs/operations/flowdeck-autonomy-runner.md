# Flowdeck autonomy runner — developer reference

**Status:** Offline and synthetic checks are available. Autonomous production execution is **blocked**: the ordinary live CLI has no production composition wired in. The corrective implementation is versioned in Git; this is not live-operation acceptance or activation.

## Commands

Run from the repository root with dependencies installed. These commands do not contact the live sender or click Send:

```sh
npm run build
node scripts/flowdeck-check.mjs --profile offline --non-interactive
node scripts/flowdeck-check.mjs --profile synthetic --non-interactive
```

`offline` requires 171 passing fixture tests with no skips. `synthetic` runs seven stages: 85 fixture tests, five synthetic workflow scenarios, and the four-case production-composition suite. Reports include expected/executed stages, test counts and artifact digests under `.state/verification-runs/autonomy-checks/`.

Before the synthetic command, provision a disposable test-only Temporal server and set `FLOWDECK_TEST_TEMPORAL_ADDRESS` to its actual `127.0.0.1:PORT` endpoint (not 7233). Set `FLOWDECK_TEST_TEMPORAL_ISOLATED=1` only for an actually isolated server. The runner checks reachability and otherwise exits setup-blocked; it does not create the server. For the direct composition command below, set `TEMPORAL_ADDRESS` to that same isolated endpoint.

The actual production-composition test command is:

```sh
npm run build && node --test tests/flowdeck-autonomy-production-composition.test.mjs
```

It uses isolated temporary state and synthetic adapters; it is not live acceptance. Other focused suites remain runnable with `node --test tests/<suite>.test.mjs` after building.

Do not rebuild mutable live `dist` as part of these checks or use it as deployment/release evidence. Do not run a live workflow from this reference.

## Current implementation boundary

The codebase includes a durable controller and production-shaped components, including production source cursor storage, process identity/witness checks, ownership, inbox/follower wiring, Temporal adapters, production activities and evidence/closeout helpers. Their focused tests and the composition test use synthetic/local fixtures. Presence of these modules does not establish a usable production launch path.

**The composition test now uses the actual disk cursor, follower ownership and process-witness factories together**, with real Temporal, synthetic browser/source actions and a test-owned process. The production follower requires ownership; checks cover startup, admission and checkpointing. Upstream or ownership-release failures remain unresponsive instead of being reported as successful drain. This does not prove real upstream cursor semantics, complete machine-wide sender registration, stale-owner recovery or live Helium operation.

The ordinary `scripts/flowdeck-run.mjs` CLI remains fail-closed because the production composition is missing; it reports blockers rather than launching autonomous work. No valid policy or preflight result removes that blocker. Existing attended/manual workflows are separate and are not substitutes for autonomous launch or validation.

## References

- Canonical MVP plan: [FLOWDECK_AUTONOMOUS_MVP_PROGRAMMER_GUIDE.md](../plans/FLOWDECK_AUTONOMOUS_MVP_PROGRAMMER_GUIDE.md)
- Manual Mac testing: [manual-mac-testing/README.md](manual-mac-testing/README.md)

Offline, synthetic, and composition checks are not production acceptance. The reported corrective campaign passed 171 offline tests, seven synthetic stages, four composition cases, 447 portable tests with one skip, and replay of 129 history events. Those are prior operator-reported results, not reruns performed for this Git handoff. Fresh commit preflight passed TypeScript checking, isolated compilation and 18 cursor/process/ownership/runtime tests. No real browser submissions were made by commit preflight.
