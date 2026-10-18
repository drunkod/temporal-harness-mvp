# 07 — Record the result, stop your launcher, and test non-intervention

**Goal:** distinguish a working bounded prototype from a merely active process, and finish the test without accidentally launching it again.

## 1. Read the authoritative result

In B:

```sh
node scripts/flowdeck-supervisor.mjs workflow-status "$PROJECT_ID"
node scripts/flowdeck-work-events.mjs status --config "$EVENT_CONFIG"
```

A successful attended cycle can report `approved_cycle_finished` / `implementation_done_review_pending`. The exact queried result, tasks, chat bindings and budget are more meaningful than a dashboard badge. Temporal `COMPLETED` alone does not prove business success; the workflow can return a paused/blocked business result.

Record:

- Both task identities and final implementation/review status.
- P1 and P2 chat URLs/tab IDs.
- Work IDs for each actual turn.
- Manual and automated submission counts.
- Workflow phase/status/blocker and Temporal status.
- Whether source events and inbox delivery match observed work.
- Screenshots of the final answers and copied Terminal A output.

Implementation done is not independent review or code acceptance. Do not mark dependent review work passed just because the browser agent says it finished.

## 2. Stop only the launcher you started

Once the bounded run has reached its result, press **Ctrl+C in Terminal A**. The launcher requests its own children stop and may escalate after two seconds. Wait for the shell prompt.

Then query status again in B and inspect process state:

```sh
node scripts/flowdeck-supervisor.mjs workflow-status "$PROJECT_ID"
ps -axo pid,ppid,lstart,command | grep -E 'flowdeck|temporal|sashai'
```

Distinguish your child processes from pre-existing ones recorded in 00. Do not use `pkill node`, kill all browser processes or target historical PIDs.

**Ctrl+C is not Temporal cancellation or proof that all external work stopped.** If stopped early, the workflow may remain RUNNING, activities may be unresolved and browser work may continue. Record that state as interrupted/unresolved. Do not restart the worker blindly: it may resume pending actions. The programmer must reconcile the exact run before reuse.

If you started `caffeinate -i` in C, Ctrl+C stops that process. Do not stop a shared Temporal server. A disposable server you started for this test can be stopped after evidence and runtime state have been accounted for.

## 3. Preserve the test state

Do not delete `.state`, prepared records, inbox checkpoints or owner claims to make another attempt work. Manual prototype closeout can be deferred, but the result must then say `cleanup pending`; it must not imply the browser scope is available for another campaign.

Give the programmer the evidence sheet and the first failing output. Ask for correction of the specific failed stage. Do not rerun historical date-specific retirement scripts against a new project.

## 4. Your next non-intervention test

After this run is reconciled and a fresh scope is provisioned:

1. Repeat 00–02 once.
2. After the one attended initial Send, do not scroll, refresh, continue, submit P2 or help the browser agent.
3. Keep the Mac powered, lid open and connected.
4. Use only read-only status observations.
5. Confirm the bounded sequence finishes without further input.

This proves **attended startup followed by unattended continuation**, not fully automatic startup.

After [04](04-automatic-initial-send.md) passes with a wired automatic runner, repeat with **zero manual Sends**. Use the runner's actual status command, its explicit campaign policy and its automatic budget (initial Send now counts). Two accepted bounded cycles are the next autonomy milestone, not a guarantee of all-day reliability.

Do not schedule automatic relaunch or install a keep-alive service until same-run restart is demonstrated. Later fault tests should separately cover network interruption, browser authentication expiry and process restart; do not introduce them midway through the first happy-path test.

## Final verdict template

```text
Prototype outcome: PASS / FAIL / BLOCKED
Startup: attended / automatic
Initial Send: manual / automatic
P1 adopted: yes/no
P1 continuation: passed/not exercised/failed
P2 transition: passed/blocked/failed
Task completion: both/partial/neither
Review: pending/verified separately
Repeated human input after initial start: count and reason
Duplicate or uncertain Sends: count/details
Temporal final status and business result:
Launcher children stopped: observed/unproven
Cleanup/claim retirement: completed/pending
Next smallest fix:
```

A useful prototype result is concrete: “one manual start, automatic P1 continuation and P2, both results observed, cleanup pending.” That is better than claiming full autonomy from a worker READY message.
