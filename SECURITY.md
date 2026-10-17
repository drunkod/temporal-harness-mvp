# Security and private operational data

## Scope

This is an experimental local automation project, not a security-hardened hosted service. It can control an authenticated browser and run work through a connector. Do not expose CDP, local dashboards, or the development Temporal server to an untrusted network.

## Sensitive material

Keep the following out of Git and public issue reports:

- `.state/` claims, bindings, approvals, work-event inboxes, screenshots, logs and raw workflow histories;
- browser profiles, cookies, session tokens and debugger WebSocket URLs;
- connector ledgers, credentials, environment files and private keys;
- private task prompts, owner/device identities, or conversations without review.

A Project ID, local path or workflow ID is not necessarily a credential, but can reveal private operational context. Review it before publication. `.gitignore` does not remove files already tracked or data from prior commits.

## Reporting

Before this repository is made public, the owner must configure a private reporting channel, such as GitHub private vulnerability reporting. No reporting address is invented here. Do not put credentials, exploit details against a live account, or raw operator evidence into a public issue. Use a synthetic minimal reproduction and redact sensitive values.

If a real credential has been committed, revoke/rotate it first. Decide on repository-history remediation with the owner; deleting the current file alone is insufficient.

## Automation safety

- Do not retry uncertain submissions or erase claims to unblock a run.
- Scope claims are checkout-local; multiple clones can still compete for one browser.
- Cancellation/timeouts do not guarantee an in-flight browser effect was undone.
- A status dashboard is not task authority or proof of review.
- Use fixture tests for fault injection; live browser tests need deliberate operator scope.

See [publication checks](docs/publishing.md) and [architecture](docs/architecture/overview.md).
