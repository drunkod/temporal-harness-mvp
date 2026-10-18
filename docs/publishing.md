# Publication checklist

Documentation cleanup is not a runtime release or a public-data audit. A local Git commit does not push anything. Use this checklist when distributing the application; it is not an extra stage of the manual MVP test.

## Before publishing

- Choose the destination and visibility deliberately. Do not include `.state`, browser profiles, source ledgers, tokens, private logs or local npm credentials.
- Review selected files and Git history for credentials and environment-specific identifiers. Deleting old docs does not erase their earlier commits.
- Keep task/report contracts and fixture bytes unchanged unless their consumers are migrated and tested. See [retained-file map](FILE-MAP.md).
- Choose a project license and preserve third-party notices, including the optional widget's attribution.
- Include the complete required runtime source/scripts/tests and locked dependencies. A documentation commit with runtime work still untracked is not a reproducible application release.
- Run applicable tests in a clean candidate checkout. Report skipped tests and local-service prerequisites honestly.
- Identify the exact source and build used for acceptance. Do not label a mutable `dist/` as the validated release artifact.

## Local review commands

```sh
git --no-optional-locks status --short
git --no-pager diff --stat
git --no-pager diff --check
git --no-pager ls-files .state dist node_modules .codegraph
node scripts/check-docs.mjs --all
node --test tests/check-docs.test.mjs
```

The `ls-files` state/build/dependency check should print nothing. Inspect the deliberately staged set with `git --no-pager diff --cached --name-status` and `git --no-pager diff --cached --check` before committing. Do not use a broad add/reset/clean operation to hide unfinished work.

For a credential scan, use a trusted installed scanner against both the selected worktree and Git history. Rotate exposed credentials before considering history cleanup. A link-check pass is not a secret scan.

## What the MVP claim may say

An attended result may claim one bounded human-started cycle with automatic follow-ups. An autonomous result needs the completed executable composition and its actual no-intervention acceptance evidence. Neither implies arbitrary browser support, independent code review, merging or all-day reliability.

Use the [MVP plan](plans/FLOWDECK_AUTONOMOUS_MVP_PROGRAMMER_GUIDE.md) and [manual test result template](operations/manual-mac-testing/07-finish-and-unattended-test.md), not deleted historical proposals, to describe the release boundary.
