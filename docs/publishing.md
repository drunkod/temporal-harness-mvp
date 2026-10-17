# Prepare this repository for GitHub

## Current verdict

**Organized for review; not yet certified safe for public release.** No commit, remote, push, license grant, or history rewrite was made as part of the cleanup.

The repository has a readable public-facing README, categorized documentation, safer example configuration, expanded ignore rules, a script catalog, contributing/security guidance, and a small offline CI tier. Retained operator records and runtime code still require privacy/portability review.

## Changes made by the cleanup

- Historical flat docs grouped into architecture, operations, plans, history and research, with a [relocation map](FILE-MAP.md).
- Path-sensitive task contracts, proposal and recent operator documents kept at their established paths. The old root README was preserved as a historical copy before replacing the entry page.
- No runtime entrypoint/source was moved; no claims, enrollment, browser data or `.state` evidence was changed.
- Ignore rules now cover environment files, private-key/container formats, local npm configuration and generated test output in addition to runtime state/dependencies/build output.
- The example enrollment no longer embeds a developer home path or real Project URL. It is deliberately not executable enrollment.

Moving a document changes its path; repairing a link changes its hash. Old document manifests are historical records and must not be silently regenerated to claim identical bytes. The live implementation already has unrelated working-tree changes, including an isolated identity correction; documentation cleanup is not promotion of that patch.

## Publication blockers

### 1. Decide which operational history is public

Review at least:

- `docs/history/`, `docs/research/`, dated architecture/plans/operations records;
- stable human runbook, task contracts, pilot proposal and identity diagnosis;
- source, tests, scripts and public assets containing fixed Project IDs, workstation paths or local service labels.

A cleanup-time filename-only content scan of Git-tracked plus non-ignored untracked candidates found **51 files with home-directory paths** and **33 files with ChatGPT Project/conversation URLs**. These are privacy/portability review candidates, not automatically secrets. Counts describe that scan snapshot and can change as files change.

Do not simply replace every identifier in runtime source: the adapter intentionally restricts its Project, and careless replacement can break identity safeguards. Choose one of:

- publish a reviewed/redacted source snapshot or public branch, preserving the local operator checkout and evidence separately; or
- deliberately publish selected contextual identifiers after owner review; or
- first implement/test configurable destination support as a separate engineering change.

A private GitHub repository can be an intermediate collaboration step, but it still uploads information to GitHub. It does not remove the need to exclude credentials and private browser/runtime data.

### 2. Scan both the worktree and history for credentials

The narrow cleanup scan found no private-key headers or common GitHub/AWS token shapes among candidate text files. **This is not a complete secret scan.** A history-aware scanner was not available/run during cleanup. No claim is made that earlier commits are clean.

After installing a trusted current Gitleaks release, from the repository root:

```sh
gitleaks dir . --redact
gitleaks git . --redact
```

Check the installed version's `--help` if its command interface differs. Keep reports local and private, under ignored `.state/` if saved. Large local dependencies/state can make a directory scan expensive; configure reviewed exclusions without excluding the actual publication set. Review false positives without printing secret values into an issue.

If credentials are found: revoke/rotate first, then agree on history cleanup. `.gitignore`, moving a file, or deleting its current version does not erase earlier commits. Do not rewrite shared history casually.

### 3. Choose a license and attribution policy

There is no project-wide license. The owner must select one; this cleanup does not invent legal permission. Review `widgets/jazz-status/THIRD_PARTY_LICENSE.txt`, vendored schema attribution, and the provenance/redistribution rights of research documents. Retain third-party notices.

`"private": true` in `package.json` protects against accidental npm publication, not public GitHub access. Keep it unless npm publication is deliberately planned. Do not invent a repository URL, author identity or security contact before the actual GitHub destination is known.

### 4. Review the exact source set

Much Flowdeck implementation is untracked. HEAD and normal `git diff` alone do not represent the tested application. Include required source/scripts/tests/lockfiles intentionally, and exclude local-only evidence. Do not stage a partially missing implementation because only tracked files were reviewed.

Local docs reference `.state` evidence that a public clone will not have. Retain clear evidence labels; do not claim those reports are independently reproducible from a clean clone without the local prerequisites.

## Review commands (no staging or push)

Run from the repository root:

```sh
git --no-optional-locks status --short
git --no-pager diff --stat
git --no-pager diff --check
git --no-pager ls-files --others --exclude-standard
git --no-pager ls-files .state dist node_modules .codegraph
node scripts/check-docs.mjs
node scripts/check-docs.mjs --all
node --test tests/check-docs.test.mjs
./node_modules/.bin/tsc --noEmit -p tsconfig.json
```

The `ls-files` command for state/build/dependency directories should print nothing. It checks the current index, not all historical commits. Do not run `git clean`, `reset --hard`, or delete `.state` as cleanup.

After you deliberately stage a reviewed publication set, inspect it before committing:

```sh
git --no-pager diff --cached --name-status
git --no-pager diff --cached --stat
git --no-pager diff --cached --check
```

Avoid blind `git add .`: ignore rules do not filter private data embedded inside legitimate docs/source files. No staging or publishing command is supplied until the review decisions above are resolved.

## Release checklist

- [ ] Owner selected GitHub destination and visibility.
- [ ] Real credentials absent from selected files and reviewed history; any exposed credential rotated.
- [ ] Historical/operator documents reviewed or excluded/redacted in a separate publication set.
- [ ] Runtime-specific identifiers reviewed without weakening live safeguards.
- [ ] No runtime state, browser profiles, ledgers, screenshots, logs, or local npm credentials included.
- [ ] Project license chosen; third-party and research rights checked.
- [ ] Required untracked source files included; dependencies locked.
- [ ] Type checks and chosen fixture tier pass in a clean checkout.
- [ ] Documentation links pass; local-only evidence warnings understood.
- [ ] Current MVP limitations stated honestly; no claim of unattended or complete live acceptance.
- [ ] Exact staged diff reviewed before commit/push.

The publication decision belongs to the owner. The goal is a reproducible, honest source release—not a dump of the operator's MacBook state.
