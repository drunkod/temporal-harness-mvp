# Contributing

Flowdeck is a development MVP with a live browser integration. Default to isolated fixtures, not the operator's browser or enrolled task source.

## Local development

Use Node 24 (CI target) and the checked-in npm lockfile. The optional Jazz widget has its own package and lockfile; do not install it unless working on that widget.

```sh
npm ci
npm run build
node scripts/check-docs.mjs
node --test tests/check-docs.test.mjs tests/flowdeck-pilot-budget.test.mjs
```

Do not rebuild an operator's frozen runtime during a live execution. The original operator setup and reports are not included as portable test prerequisites.

## Test tiers

| Tier | Command | Side effects / requirements |
|---|---|---|
| Documentation tooling | `node --test tests/check-docs.test.mjs` | Temporary local fixtures; no services |
| Types | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | No build promotion or service connection |
| Budget/loader fixtures | `node --test tests/flowdeck-pilot-budget.test.mjs` after build | Temporary files, fake authority; no live browser |
| Activity fixtures | `node --test tests/flowdeck-supervisor-activities.test.mjs` after build | Fake browser and temporary journals |
| Broader portable tier | `npm run test:portable` | Builds; not fully service-independent |
| Full repository | `npm test` | Builds; may require checkout-local historical evidence/integrations |
| Temporal synthetic | See [script catalog](scripts/README.md) | Real test executions with fake activities; requires server |
| Browser no-send / live | [Manual Mac testing](docs/operations/manual-mac-testing/README.md) | Explicit operator environment and controlled scope |

A passing fixture suite is not evidence of successful live delivery. Record skipped tests and service assumptions honestly.

## Change boundaries

- Workflows must be deterministic; use activities for filesystem/network/browser effects.
- Review command-sequence compatibility before editing a workflow. Preserve existing patch IDs and validate with exact-history replay where relevant.
- Keep implementation completion separate from external review.
- Never weaken exact destination, prompt, authority or send-journal checks to make a test pass.
- Do not reset claims, replay live sends, or delete `.state`.
- Do not include real tokens, browser profiles, ledgers, raw histories, or private operator logs in changes.
- Avoid moving runtime entrypoints just to make directories look uniform: CLI paths are part of the operational interface.

## Documentation

Start at [docs/README.md](docs/README.md). Keep current architecture in `docs/architecture/`, operating contracts and step-by-step tests in `docs/operations/`, and update the single MVP plan in `docs/plans/`. Do not add competing roadmaps, dated launch recipes or research dumps. Superseded tracked documents are recoverable from Git history; private run evidence belongs outside the documentation tree.

Some root-level documentation paths are compatibility exceptions. Consult [FILE-MAP.md](docs/FILE-MAP.md) before renaming them. Historical path/hash manifests should not be silently rewritten after documentation moves.

```sh
node scripts/check-docs.mjs
node scripts/check-docs.mjs --all
```

The checker verifies inline relative Markdown file destinations, not external URLs or heading anchors. Links into local `.state` evidence are reported separately and do not establish publication readiness.

## Before proposing a change

1. Inspect the full dirty/untracked working tree; do not overwrite other work.
2. Add focused regression coverage and run the applicable tier.
3. Run the documentation checker and `git diff --check`.
4. Review untracked files explicitly: they do not appear in normal `git diff`.
5. Use the [publication checklist](docs/publishing.md) before public GitHub exposure.

No project-wide license has been selected yet. Resolve licensing before soliciting external contributions or promising redistribution rights.
