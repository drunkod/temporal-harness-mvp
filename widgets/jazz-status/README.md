# Flowdeck Jazz status island (alpha.53)

Optional browser-only, read-only latest-state view. This does not drive Temporal, dispatch MCP work, publish Jazz data, or replace the independent work-event consumer. CSS lives in a shadow root; React/Jazz never enter the Node worker dependency graph.

## Current integration blockers

- Discovered plugin public origin: `https://tests-macbook-air.tail70b8a.ts.net` (allowlisted `APP_ORIGIN` in the plugin `control-plane/apps/control-plane/.env.local`; the application launcher defaults to this env file).
- Existing panel: `/dashboard/devices`, derived from the plugin Next route `app/dashboard/devices/work-status-panel.tsx`.
- Existing bootstrap: `POST /api/dashboard/work-status/config`, requires the plugin Better Auth dashboard session; status must be enabled by the plugin deployment. No auth or deployment setting was changed.
- Flowdeck at `http://127.0.0.1:4319` is **cross-origin**. The default is explicitly **link-only**, not an embedded live demonstration. No cookie forwarding, CORS workaround, iframe, token URL, signing key or new auth endpoint is provided.
- The plugin's allowlisted local `JAZZ_SERVER_URL` is `http://127.0.0.1:1625`, not a demonstrated remote-browser sync endpoint. The island rejects insecure sync on HTTPS pages and requires a reachable deployment-provided endpoint. Do not embed a localhost sync URL into public config.
- Flowdeck now serves the loader and widget JS/CSS at the fixed paths below, exposes `/api/jazz/status-config`, and includes the authorized-panel fallback link on `/sashai`. Same-origin authenticated embedding remains deployment-dependent.
- Authorized live rows, active → reported transitions, expired-token browser behavior and performance are **not validated**. No workers, dispatches or production authentication were exercised.

## Build without changing either repository's dependencies

From the main repository root:

```sh
node widgets/jazz-status/build.mjs --reuse-from /Users/test/Documents/RemoteMCP-Jazz/repositories/RemoteMCP-Jazz
node --test tests/jazz-status.test.mjs
```

This resolves the plugin's installed React/Jazz and esbuild/TypeScript, verifies every dependency version, typechecks the island, and builds production browser ESM/CSS under `widgets/jazz-status/dist/`. It never installs packages, writes symlinks, updates root lockfiles, or edits the plugin. Build metadata records versions and bundler inputs. A first dependency-resolution build attempt exposed esbuild subpath-alias resolution; explicit alpha.53 React export resolution fixes that build issue.

The standalone widget now has its own `package-lock.json`; the exact alpha.53 dependency must not be upgraded independently of the plugin. To reproduce the default build from the main repository root:

```sh
npm ci --prefix widgets/jazz-status --ignore-scripts --no-audit --no-fund
npm run jazz:build
```

This installs only the widget's locked dependency tree (including the platform-specific esbuild binary package), without changing root or plugin dependencies. The locked install and default build were verified on this MacBook. `--reuse-from` remains available when the compatible plugin checkout already has all required versions installed. Building the island does not demonstrate authenticated embedding; Flowdeck keeps the existing authorized-panel fallback.

## Parent integration

Add this plain anchor immediately in the parent UI. It works without any widget scripts, static serving, bootstrap, or browser SDK:

```html
<section aria-label="External work status">
  <p>External status — not embedded. Existing plugin login required.</p>
  <a href="https://tests-macbook-air.tail70b8a.ts.net/dashboard/devices"
     target="_blank" rel="noopener noreferrer">Open authorized plugin work status ↗</a>
</section>
```

Optional progressive enhancement, **only once these exact files are served** with JS/CSS MIME types and the host CSP permits the module, stylesheet and authorized sync transport:

| Browser path | Repository file |
| --- | --- |
| `/jazz-status-loader.js` | `public/jazz-status-loader.js` |
| `/widgets/jazz-status/dist/jazz-status.js` | `widgets/jazz-status/dist/jazz-status.js` |
| `/widgets/jazz-status/dist/jazz-status.css` | `widgets/jazz-status/dist/jazz-status.css` |

```html
<div id="flowdeck-jazz-status"></div>
<script type="module">
  import { mountJazzStatus } from '/jazz-status-loader.js';
  const dispose = mountJazzStatus(document.getElementById('flowdeck-jazz-status'));
  window.addEventListener('pagehide', dispose, { once: true });
  // Also call dispose on logout, owner change, navigation, or feature disable.
</script>
```

The loader renders the external link synchronously. In cross-origin/default mode it does not fetch the SDK bundle or bootstrap. For an **explicitly approved deployment under the existing authenticated plugin origin**, pass `{ authorizedSameOriginBootstrap: true }`. This flag is a hosting opt-in, not authentication: the existing endpoint must still authorize the session and scope. `pluginOrigin` may be overridden by trusted deployment configuration, never from an untrusted query string. The island derives the page origin from `location.origin`, not caller input. Do not simply enable a relative bootstrap endpoint on the Flowdeck server.

Node-side public configuration:

```ts
import { getJazzStatusConfig } from './jazz-status-config.js';
const config = getJazzStatusConfig({ pageOrigin: 'http://127.0.0.1:4319' });
// fallbackPanelUrl, bootstrapUrl (null), authBlocker, mode, assets
```

The helper imports no Jazz SDK and returns no credentials. Bootstrap tokens stay within component memory and are never persisted, displayed or logged. Bootstrap is POST, same-origin, no-store, redirect-rejecting, abortable and time-bounded. Refresh is SDK expiry-driven, not polling. Refresh must retain the original owner/app/sync scope; a changed identity or failed refresh removes the provider. Initial auth errors keep the dashboard link and manual reconnect action available.

## Recorded validation (2026-10-15)

- Reuse build: **passed**, including island TypeScript checking. JS output approximately **488 KiB uncompressed**, plus approximately 2 KiB CSS (see actual files for exact byte counts).
- `node --test tests/jazz-status.test.mjs`: **8 passed, 0 failed, 0 skipped**, including the live local-source schema comparison and installed Jazz version.
- Standalone NodeNext typecheck of `src/jazz-status-config.ts`: **passed** without adding SDK imports or root dependencies.
- Unauthenticated, credential-free `HEAD https://tests-macbook-air.tail70b8a.ts.net/dashboard/devices`: **HTTP 200**, no redirect, from this machine. This confirms route reachability only, **not** login, authorized rows, bootstrap availability or browser transitions.
- No live browser or worker was started; no production auth was modified. Protected dashboard/package files and frozen docs were not edited by this feature. Other concurrent parent-agent changes were left intact.

## Contract and lifecycle

`work-status-schema.alpha53.ts` is a small attributed copy of RemoteMCP-Jazz `control-plane/packages/protocol/src/work-status-schema.ts` (MIT; full notice in `THIRD_PARTY_LICENSE.txt`). It includes only the two status tables and matches the source body byte-for-byte. The contract test pins its SHA-256 and compares against the local plugin checkout when available; override `FLOWDECK_JAZZ_PLUGIN_ROOT` for another checkout. Missing checkout explicitly skips the upstream comparison, not the snapshot check. No schema deployment/migration is performed.

Alpha.53 `useAll()` returns arrays or `undefined`. Both queries are owner scoped and use global initial reads; work rows are ordered/limited to 30. Status outcomes are **agent reported**, not verified. Revision, device/work/owner scope, start/report/source-recorded/projection/client-observed timestamps are visible. The one-second clock only ages the projector health signal; missing, offline, auth-failed, >45-second-old or >5-second-future health is unconfirmed, not evidence of process exit. Old work timestamps do not themselves imply stale transport.

`dispose()` aborts pending initial/refresh bootstrap, unmounts React and removes the host. Effects remove clock/listeners; `useAll` subscriptions and the in-memory client are released by the installed alpha.53 provider's refcounted registry on unmount. Error boundaries preserve an external link. Call dispose/remount when the host learns of logout or owner change; the widget cannot infer an unrelated parent application's session lifecycle.

Deferred: authenticated two-transition smoke, deployment CSP/sync reachability, full auth/reconnect matrix, fault injection, browser paint latency and MCP resource/performance certification. Static serving is now integrated in Flowdeck.
