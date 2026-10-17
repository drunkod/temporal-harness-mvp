# Flowdeck P1 local send-boundary guard — engineering verification

**2026-10-16.** Scope: source/test-only improvement and hand-in evidence. **No new live Task B attempt or authorization**, no worker/follower launch, no workflow signal, no browser Send. This is **partial** hardening, not certification of safe unattended operation.

## Change

The previous production `send()` activity did not pass a check callback to `LiveBrowser.click()`, despite the adapter already supporting `click(tab,url,prompt,deadline,check)`. The sole browser click deadline was a new ten-second limit per call. A canceled or locally expired activity could still proceed toward that boundary.

In `src/flowdeck-supervisor-activities.ts`:
- The production dispatch guard comes from `@temporalio/activity` `Context.current().cancellationSignal`, with a **90-second local send budget**, constructed only after a missing-receipt send attempt enters the activity. Tests inject a guard via `SupervisorActivityOptions.dispatchGuard`; no production bypass flag was added.
- The guard is checked at send start, after browser predecessor identity and fresh completion probes, immediately before authorization consumption or ordinary send claims, before and after owned-tab creation and staging/matching, before reauthorization, and before durable click intent.
- The adapter receives `dispatch.check` plus `Math.min(dispatch.deadline,Date.now()+10_000)`. Its existing strict tab and full composer checks remain in place.
- Cancellation or expiry detected **before** click-intent is logged as `pre_send_failed` when send claims exist. Cancellation after `click_attempted` remains **conservatively uncertain** and cannot be retried under old claims; the code never treats that path as a safe pre-send failure.
- No change to the existing recovery authorization slot, retry policy, browser adapter, or Temporal workflow signature.

## Testing

`npm test` rebuilt the TypeScript code and passed **304 total, 301 pass, 0 fail, 3 skip** on 2026-10-16 (exit 0): `/tmp/flowdeck-handin-p1-final-20261016.log`.

The supervisor activity fixture's synthetic browser respects the passed callback. Four additional regression cases prove:
1. Cancellation before send claims creates no send claim, staging, click, or receipt.
2. Deadline expiry before send claims also has no send side effects.
3. Cancellation during staging durably records `pre_send_failed` without any `click_attempted` journal.
4. Cancellation after `click_attempted`, immediately before fake browser evaluation, retains the uncertain click-intent journal and blocks a later retry.

A positive same-chat continuation test also verifies repeated cancellation checks and an explicit bounded deadline passed to the browser.

## Important remaining limitation

This implementation performs **cooperative checks between awaited operations**. It does **not** forcibly cancel an already in-flight WebSocket/CDP `Runtime.evaluate` or ensure that server-initiated Temporal cancellation reaches the activity promptly. Temporal heartbeat/cancellation propagation, activity shutdown behavior, and in-flight transport termination need independent testing and possibly a separate heartbeat configuration. A timed-out remote process must not be assumed dead.

Historical Task A's exact tab is still missing; its originally adopted message lacks a sealed expected prompt hash. The issued B successor authorization slot remains occupied. This patch does not supply missing historical evidence, backfill a seal, silently rebind a tab, or authorize B execution.

## Verified fingerprints

- Supervisor activities TypeScript SHA-256: `da6f5f3632751eeea8fbb46692e87a345fc4971194aa05b80c4c11ec3362b2b1`
- Compiled supervisor activities JavaScript SHA-256: `2a24b348c700681b53007bd5c073bf85b726c30630de0fcb454f38ec919f6a72`
- Supervisor activity regression test SHA-256: `20883d555e2765cd0716edabcde6896e2ff445594737a2a84302528c512ea829`
- Browser adapter source/build remained unchanged from the P0 10/10 staging campaign.
- Recursive live `.state/flowdeck-supervisor` digest remained `31aac9fd409fbfa6a5fba847812f535ef7ed76dde49c34b4b94f2a03d449d70f`. Task B artifact absent; no live Flowdeck sender found.

**Hand-in status:** stronger tested prototype with bounded cooperative cancellation gates. **Full live A→B acceptance remains unverified.**
