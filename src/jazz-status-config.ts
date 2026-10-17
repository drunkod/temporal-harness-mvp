/** Public deployment metadata only; no Jazz SDK or credentials in the Node runtime. */
export const PLUGIN_STATUS_ORIGIN = 'https://tests-macbook-air.tail70b8a.ts.net';
export const PLUGIN_STATUS_PATH = '/dashboard/devices';
export const STATUS_BOOTSTRAP_PATH = '/api/dashboard/work-status/config';
export const JAZZ_STATUS_VERSION = '2.0.0-alpha.53';
export const STATUS_FRESHNESS_MS = 45_000;

export interface JazzStatusOptions {
  pageOrigin: string;
  pluginOrigin?: string;
  /** Opt in only after hosting under the existing authorized plugin origin. */
  authorizedSameOriginBootstrap?: boolean;
}

function originOnly(value: string): string {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Status origin must be an HTTP(S) origin without credentials, path, query or fragment');
  }
  return url.origin;
}

export function getJazzStatusConfig(options: JazzStatusOptions) {
  const pageOrigin = originOnly(options.pageOrigin);
  const pluginOrigin = originOnly(options.pluginOrigin ?? PLUGIN_STATUS_ORIGIN);
  const sameOrigin = pageOrigin === pluginOrigin;
  const enabled = sameOrigin && options.authorizedSameOriginBootstrap === true;
  return {
    mode: enabled ? 'subscription' as const : 'link-only' as const,
    pluginOrigin,
    fallbackPanelUrl: `${pluginOrigin}${PLUGIN_STATUS_PATH}`,
    bootstrapUrl: enabled ? `${pluginOrigin}${STATUS_BOOTSTRAP_PATH}` : null,
    authBlocker: enabled ? null : !sameOrigin
      ? 'External status — open plugin dashboard. Flowdeck and the plugin have different origins; no cross-origin session bootstrap is permitted.'
      : 'External status — open plugin dashboard. Authorized same-origin bootstrap has not been explicitly enabled.',
    assets: {
      loader: '/jazz-status-loader.js',
      module: '/widgets/jazz-status/dist/jazz-status.js',
      stylesheet: '/widgets/jazz-status/dist/jazz-status.css',
    },
  };
}

/** UI clock only: missing, future-skewed or old health never proves process completion. */
export function isJazzStatusFresh(observedAt: string | undefined, now: number, online: boolean, authError: boolean) {
  const age = observedAt ? now - Date.parse(observedAt) : NaN;
  return online && !authError && Number.isFinite(age) && age >= -5_000 && age <= STATUS_FRESHNESS_MS;
}
