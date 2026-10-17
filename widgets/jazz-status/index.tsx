import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { JazzProvider, useAll, useDb } from 'jazz-tools/react';
import { schema as s } from 'jazz-tools';
import { workStatusSchema } from './work-status-schema.alpha53';
import { getJazzStatusConfig, isJazzStatusFresh, type JazzStatusOptions } from '../../src/jazz-status-config';
import './style.css';

const app = s.defineApp(workStatusSchema);
type Config = ReturnType<typeof getJazzStatusConfig>;
type Bootstrap = { ownerId: string; appId: string; serverUrl: string; token: string };
export type MountOptions = Omit<JazzStatusOptions, 'pageOrigin'>;

async function bootstrap(url: string, lifetime: AbortSignal, expected?: Bootstrap): Promise<Bootstrap> {
  // No redirects (including login redirects), cross-origin cookies, storage or token URLs.
  const response = await fetch(url, {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    signal: AbortSignal.any([lifetime, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) throw new Error('Authorized status bootstrap unavailable');
  const value = await response.json();
  if (value.ok !== true || !['ownerId', 'appId', 'serverUrl', 'token'].every(key =>
    typeof value[key] === 'string' && value[key].trim().length > 0)) throw new Error('Invalid status scope');
  const sync = new URL(value.serverUrl);
  if (!['https:', 'http:', 'wss:', 'ws:'].includes(sync.protocol) || sync.username || sync.password || sync.search || sync.hash
    || (location.protocol === 'https:' && ['http:', 'ws:'].includes(sync.protocol))) {
    throw new Error('Status sync address unavailable for this browser');
  }
  if (expected && ['ownerId', 'appId', 'serverUrl'].some(key => value[key] !== expected[key as keyof Bootstrap])) {
    throw new Error('Status identity changed; remount after login');
  }
  return { ownerId: value.ownerId, appId: value.appId, serverUrl: value.serverUrl, token: value.token };
}

class StatusBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p role="alert">Status error — subscription unavailable. Open the plugin dashboard below.</p> : this.props.children; }
}

function Island({ config }: { config: Config }) {
  const [auth, setAuth] = useState<Bootstrap | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    setAuth(null); setFailed(false);
    if (config.bootstrapUrl) void bootstrap(config.bootstrapUrl, controller.signal)
      .then(value => { if (!controller.signal.aborted) setAuth(value); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); lifetime.current = null; };
  }, [config, attempt]);
  const refresh = useCallback(async () => {
    const controller = lifetime.current;
    if (!config.bootstrapUrl || !auth || !controller || controller.signal.aborted) return null;
    try {
      const next = await bootstrap(config.bootstrapUrl, controller.signal, auth);
      return controller.signal.aborted ? null : next.token;
    }
    catch { if (!controller.signal.aborted) { setFailed(true); setAuth(null); } return null; }
  }, [config, auth]);
  const provider = useMemo(() => auth ? {
    appId: auth.appId, serverUrl: auth.serverUrl, jwtToken: auth.token,
    driver: { type: 'memory' as const }, devMode: false,
  } : null, [auth]);
  return <section className="fd-jazz" aria-label="Read-only work status">
    <header><span className="eyebrow">FLOWDECK / AUXILIARY SIGNAL</span><h2>Work sessions <small>Jazz projection</small></h2></header>
    <p>Agent declarations only — not verified task completion. Background processes remain unknown.</p>
    {config.authBlocker ? <p role="status">{config.authBlocker}</p>
      : failed ? <p role="alert">Status error — authorization or connection unavailable. <button onClick={() => setAttempt(n => n + 1)}>Reconnect status</button></p>
      : !auth || !provider ? <p role="status">Connecting to owner-authorized status…</p>
      : <StatusBoundary key={attempt}><JazzProvider config={provider} onJWTExpired={refresh} autoAttachDevTools={false}
        fallback={<p role="status">Opening status subscription…</p>}><Subscriber ownerId={auth.ownerId} /></JazzProvider></StatusBoundary>}
    <footer><a href={config.fallbackPanelUrl} target="_blank" rel="noopener noreferrer">External status — open plugin dashboard ↗</a>
      <small>Existing plugin login required. Execution and supervisor events are independent.</small></footer>
  </section>;
}

function Subscriber({ ownerId }: { ownerId: string }) {
  const query = useMemo(() => app.workStatusViews.where({ ownerId }).orderBy('projectedAt', 'desc').limit(30), [ownerId]);
  const healthQuery = useMemo(() => app.workStatusHealth.where({ ownerId }).limit(1), [ownerId]);
  // Exact alpha.53 contract: arrays or undefined, not { data, isLoading, error }.
  const rows = useAll(query, { tier: 'global' });
  const health = useAll(healthQuery, { tier: 'global' });
  const db = useDb();
  const [clock, setClock] = useState(() => ({ now: Date.now(), online: navigator.onLine }));
  useEffect(() => {
    const tick = () => setClock({ now: Date.now(), online: navigator.onLine });
    const timer = window.setInterval(tick, 1_000); // Freshness clock only, never status polling.
    window.addEventListener('online', tick); window.addEventListener('offline', tick);
    return () => { clearInterval(timer); window.removeEventListener('online', tick); window.removeEventListener('offline', tick); };
  }, []);
  const authError = Boolean(db.getAuthState().error);
  const signal = health?.[0]?.observedAt;
  const fresh = isJazzStatusFresh(signal, clock.now, clock.online, authError);
  return <div>
    <p role="status" className={fresh ? 'fresh' : 'stale'}>{authError ? 'Status error — authorization unavailable' : fresh
      ? 'Live subscription · recent projector signal' : 'Stale / freshness unconfirmed'}{signal && <> · signal {signal}</>}</p>
    <small>Owner <code>{ownerId}</code> · latest 30 sessions</small>
    {authError ? <p>Cached rows hidden until authorization is restored.</p> : rows === undefined ? <p>Waiting for authorized rows…</p>
      : rows.length === 0 ? <p>No projected work sessions for this owner.</p>
      : <ul>{rows.map(row => <WorkRow key={row.id} row={row} />)}</ul>}
    <small>Source timestamps are recorded inside SQLite transactions, not exact post-commit clocks.</small>
  </div>;
}

type Row = typeof app.workStatusViews._rowType;
function WorkRow({ row }: { row: Row }) {
  const [observation, setObservation] = useState<{ revision: number; projectedAt: string; at: string } | null>(null);
  useEffect(() => { setObservation({ revision: row.revision, projectedAt: row.projectedAt, at: new Date().toISOString() }); }, [row.revision, row.projectedAt]);
  const observed = observation?.revision === row.revision && observation.projectedAt === row.projectedAt ? observation.at : 'pending';
  return <li data-work-id={row.workId} data-revision={row.revision} data-source-recorded-at={row.sourceCommittedAt}
    data-projected-at={row.projectedAt} data-client-observed-at={observed}>
    <div className="row-title"><code>{row.workId}</code><strong>{row.state === 'reported' ? `${row.outcome ?? 'unknown'} · agent reported`
      : row.state === 'active' ? 'Active · agent declared' : `${row.state} · agent declared`}</strong></div>
    <p>Device <code>{row.deviceId}</code> · revision {row.revision} · evidence: {row.evidence}</p>
    <dl><dt>Started</dt><dd>{row.startedAt}</dd>{row.reportedAt && <><dt>Reported</dt><dd>{row.reportedAt}</dd></>}
      <dt>Source recorded</dt><dd>{row.sourceCommittedAt}</dd><dt>Projection submitted</dt><dd>{row.projectedAt}</dd>
      <dt>Client observed</dt><dd>{observed}</dd></dl>
  </li>;
}

/** Call the returned function on logout, owner changes, navigation or feature disable. */
export function mountJazzStatus(element: HTMLElement, options: MountOptions = {}) {
  const config = getJazzStatusConfig({ ...options, pageOrigin: location.origin });
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet'; stylesheet.href = config.assets.stylesheet;
  const container = document.createElement('div');
  shadow.append(stylesheet, container); element.append(host);
  const root = createRoot(container);
  root.render(<Island config={config} />);
  let mounted = true;
  return () => { if (mounted) { mounted = false; root.unmount(); host.remove(); } };
}
