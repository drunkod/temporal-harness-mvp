# Oracle 0.21.3 / ChatGPT Sashai — prompt-commit-timeout RCA and diagnostics

Date: 2026-10-14
Environment: Helium Chromium 155, running Profile 4 with local CDP at 127.0.0.1:9222.
All diagnostics in this report are **read-only against existing ChatGPT conversations**. No second prompt has been submitted while investigating the bug.

## Proven root cause

The stock Oracle 0.21.3 browser engine queries:
- `[data-testid^="conversation-turn"]`
- `article/div/section[data-message-author-role]`
- `article/div/section[data-turn]`

Its `buildConversationTurnListExpression()` returns zero nodes for both completed Sashai test conversations. Oracle's prompt commit verification therefore cannot match the submitted user turn. The archived first run contains:

```json
{
  "code": "prompt-commit-timeout",
  "commitProbe": {
    "baseline": 0,
    "turnsCount": 0,
    "userMatched": false,
    "hasNewTurn": false,
    "composerCleared": true,
    "inConversation": true
  }
}
```

This is a **false negative in browser UI verification**, not evidence of failed submission. The same Oracle metadata contains `browser.runtime.promptSubmitted=true` and a project conversation ID. Independent CDP inspection of that exact tab finds 1 user message and 1 assistant message. The new ChatGPT DOM uses visually hidden `h4.sr-only` headings with `You said:` and `ChatGPT said:`, whereas Oracle's selectors match neither turn.

A second independent smoke with a locally pinned Oracle 0.21.3 and a fallback turn-selector patch **successfully sent one unique prompt**, and CDP saw the assistant's exact expected response. However the Oracle session still errored when extracting/recovering its answer: the response-reading path also expects legacy role/turn markup and additional completion/identity evidence. The local patch was applied *during the prior in-flight run* and has **not** been validated as fixing a complete new lifecycle. No automatic Oracle follow-up should be allowed on those failed sessions.

## Read-only reproduction and files

```bash
cd /Users/test/Documents/work/temporal-harness-mvp

# Existing session one
node scripts/oracle-sashai.mjs diagnose flowdeck-sashai-oracle-live-cdp

# Existing session two
node scripts/oracle-sashai.mjs diagnose oracle-sashai-local-patched-smoke

# Oracle's own session log (no new send)
oracle session flowdeck-sashai-oracle-live-cdp --path
oracle status --hours 3
```

The probes evaluate original and patched turn selectors through CDP, but do not copy transcript contents. Diagnostics are saved with mode 0600 under:

`/Users/test/Documents/work/temporal-harness-mvp/.state/oracle-debug/<slug>.diagnostics.json`

For **both** project chats the measured result was:

| Selector / signal | Result |
| --- | --- |
| Stock Oracle turn count | **0** |
| Local fallback turn count | **2** |
| ChatGPT `You said:` markers | **1** |
| ChatGPT `ChatGPT said:` markers | **1** |
| Old assistant-role attributes found | **0** |
| New assistant heading markers | **1** |
| Original Oracle metadata `promptSubmitted` | **true** |
| Original Oracle terminal state | **error** |

The run-specific original error snapshot also has `composerCleared=true`, `inConversation=true`.

## Logging enabled for future adapter runs

`scripts/oracle-sashai.mjs` now enables `--verbose` and `--heartbeat 5` by default, and passes `--perf-trace-path` to Oracle. It preserves the CLI output locally at `.state/oracle-sashai/<slug>.verbose.log` (private to the MacBook), the CLI startup trace at `.state/oracle-sashai/<slug>.perf.json`, and Oracle's own session artifacts under `~/.oracle/sessions/<slug>/`.

Disable extra logging if necessary using `ORACLE_DEBUG=0`. Verbose CLI logs can contain private prompt/content, so do not commit or upload these records unredacted. The tool intentionally avoids `--browser-capture-provider-native`, which would persist a full authenticated ChatGPT conversation; consider that feature only for a separate explicitly approved diagnostic run.

A **no-send** verbose command was executed successfully:

```bash
.state/oracle-local/node_modules/.bin/oracle \
  --verbose --engine browser --browser-attach-running \
  --chatgpt-url 'https://chatgpt.com/g/g-p-6ab28bdd7fbc8191b581316ff09da79d/project' \
  --dry-run summary -p 'Diagnostic no-send dry run'
```

Its output was retained as `.state/oracle-debug/oracle-verbose-dryrun.log`. `--dry-run` does not contact ChatGPT or create a new chat.

## Documentation reviewed

The attached `Pasted text(20261014-171046).txt` includes Oracle's `docs/cli-reference.md`, `docs/configuration.md`, `docs/manual-tests.md`, `docs/sessions.md`, `docs/followup.md` and `docs/testing.md`. They document:

- `-v, --verbose` to inspect browser control; `--help --verbose` and `--debug-help` to inspect available settings.
- `~/.oracle/sessions/<id>/meta.json` and session logs for durable error evidence.
- `--perf-trace-path` and `--heartbeat` for timing and liveness.
- `--browser-recheck-delay` and auto-reattach for delayed answers — **neither corrects a selector returning zero turns**.
- `--browser-keep-browser` for launcher-owned Chrome; attach-running mode keeps the user's browser and does not accept launcher-only flags.
- Safe `--followup` requires stable prior turns; it intentionally refuses to re-send when identity cannot be proven.
- `scripts/chatgpt-layout-proof.mjs` and `scripts/assistant-runtime-proof.mjs` in the upstream source repo as synthetic regression evidence, plus a signed-in live smoke for final confirmation.

Related public report: https://github.com/steipete/oracle/issues/286 documents a similar error, but its older repro is not proof of our exact 2026 DOM mismatch. The current Helium measurements above independently establish our root cause.

## Fix path and non-negotiable gate

1. Maintain the **isolated local Oracle** under `.state/oracle-local`; never patch Homebrew's global binary or the Sashai repo.
2. Update the Oracle DOM adapter to recognize role-labeled ChatGPT turn containers without double counting, preserving stable per-message identities and prompt-match verification. Update assistant extractor, completion and prior-turn recovery consistently.
3. Add unit tests against recorded / sanitized DOM variations and verify streaming, stopped, finished, project-scoped and non-project conversations.
4. Run exactly one new signed-in Sashai *harmless* smoke after completing the fix; require Oracle's `status=completed`, written answer, correct conversation id, and independent answer check. Only then allow same-chat followup/automatic task execution.
5. Do **not** bypass `prompt-commit-timeout` by blindly retrying or treating a cleared composer as success. A false negative must not become a duplicate user prompt.

Current Oracle answer capture / followup is **not yet fixed**, despite independently verified sent-and-replied test messages. The read-only Sashai observer continues working.
