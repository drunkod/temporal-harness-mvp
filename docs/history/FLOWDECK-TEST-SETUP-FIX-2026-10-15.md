# Follow-up: macOS fixture paths and standalone Jazz setup

Date: 2026-10-15. Addresses the two blockers recorded in `.state/verification-runs/clean-20261015T230910/RESULTS.md`. That original report, logs and cleanup manifest are preserved unchanged.

## Changes

- `tests/flowdeck-supervisor-activities.test.mjs`: canonicalize the newly created disposable fixture directory with `realpath()`. The child CLI's physical cwd and parent fixture now agree on macOS `/var` versus `/private/var`. Production immutable-request identity checks are unchanged.
- `widgets/jazz-status/package-lock.json`: added a widget-local npm lockfile, preserving all exact manifest versions, including `jazz-tools@2.0.0-alpha.53`.
- `widgets/jazz-status/README.md`: documented the standalone locked installation and default build. Existing compatible plugin-dependency reuse remains available.

No root or RemoteMCP-Jazz dependency changes were required. Installed packages remain under the widget's ignored `node_modules` directory. Jazz remains a browser-only display island; authenticated embedding is not claimed and the authorized-panel fallback remains the default.

## Validation actually run

| Command | Result |
|---|---|
| `npm test` in the normal environment | 269 passed, 0 failed, 2 skipped; TypeScript build included |
| `TMPDIR=/var/tmp node --test tests/flowdeck-supervisor-activities.test.mjs` | 33 passed, 0 failed; explicit macOS alias regression |
| `npm ci --prefix widgets/jazz-status --ignore-scripts --no-audit --no-fund` | Passed using the new widget lockfile |
| `npm run jazz:build` | Widget TypeScript check and browser bundle passed |
| `git diff --check` | Passed |

Reproduce the standalone build from the main repository root:

```sh
npm ci --prefix widgets/jazz-status --ignore-scripts --no-audit --no-fund
npm run jazz:build
npm test
```

No ChatGPT messages, successor authorizations, recovery releases, task-enrollment changes or historical-record cleanup were performed. The real Task B submission remains unproven and separately review/approval-gated under the existing successor recovery procedure.
