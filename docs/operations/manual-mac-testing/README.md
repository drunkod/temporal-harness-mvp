# MacBook manual testing: start here

These runbooks test the existing Flowdeck implementation in small observable stages. No conversational approval or repeated “are you sure?” step is required. Commands that send or start automation are labeled so you know what they do.

**Current limitation:** the attended launcher automates continuation and P2 after your first manual Send. It has no operator pause between stages. Files 03, 05 and 06 are observation checkpoints in the SAME run. Do not restart the launcher for each file. Fully automatic initial Send is a separate implementation gate in file 04.

## Order

1. [00 — Prepare the Mac and identify a fresh test configuration](00-prepare-mac.md)
2. [01 — Prepare the browser and start the engine](01-start-engine.md)
3. [02 — Copy the exact prompt and send P1 once](02-send-first-task.md)
4. [03 — Observe adoption and the first result](03-observe-result.md)
5. [05 — Observe automatic continuation](05-test-continuation.md)
6. [06 — Observe automatic P2](06-test-next-task.md)
7. [07 — Record the bounded result and stop the launcher](07-finish-and-unattended-test.md)
8. [04 — Test automatic initial Send once implemented](04-automatic-initial-send.md)

Read 03, 05, 06 and 07 before sending P1: later stages can happen quickly without waiting for you. The numbering retains the development stages previously discussed; the practical attended test order is the list above.

## What you need once

A programmer-provisioned **fresh enrolled project**, matching event configuration, a working built checkout, the configured Helium browser and Probe RemoteMCP2, and the corresponding Temporal server. This guide does not invent an enrollment or reuse a completed historical project. File 00 shows how to discover the configuration and records a concrete setup blocker if none exists.

The browser agent may edit the enrolled worktree and use its connector tools. This is not a dry run. The bounded attended scenario is one manual initial Send, at most one automatic P1 continuation, one automatic P2 submission, and no P2 continuation. Check that the actual enrolled budget matches this before launch.

## Terminal layout

- **A:** long-running launcher; leave open.
- **B:** read-only status commands and clipboard preparation.
- **C:** optional idle-sleep inhibition or a development Temporal server you own.

Use the same project/configuration/environment in A and B. Shell variables do not automatically transfer between Terminal windows. Run the export block from file 00 in each.

## Evidence sheet

Create a local text note with these fields; do not put credentials in it:

```text
Date/time:
Checkout path and source revision:
Build supplied by:
Project ID:
Event config path:
Temporal address/namespace:
Workflow ID / run ID:
Prepared tab ID:
Stage 01: PASS / FAIL / BLOCKED
Stage 02:
Stage 03:
Stage 04: NOT IMPLEMENTED / PASS / FAIL
Stage 05:
Stage 06:
Stage 07:
Manual Send count:
Automated submission count:
First failing command and exact error:
Final workflow phase/status/blocker:
```

A skipped stage is not a pass. A completed workflow is not automatically reviewed code or proven cleanup. Record the first failing boundary and give that exact failure to your programmer; do not reset the whole system.

## Stop convention

If a command fails before Send, leave the state intact and capture its error. If a Send is uncertain, look for the existing message and record status; do not click again. Ctrl+C in A requests launcher child shutdown but does not prove the Temporal workflow was canceled or every browser effect stopped. File 07 explains the distinction.

These are source-checked instructions, not a claim that a live test has been executed. Existing correctness checks remain enabled; no security configuration changes are needed for this procedure.
