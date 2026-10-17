// Optional enhancement: keep a functioning external link even when assets/auth are unavailable.
export function mountJazzStatus(element, options = {}) {
  const plugin = new URL(options.pluginOrigin ?? 'https://tests-macbook-air.tail70b8a.ts.net');
  if (!['https:', 'http:'].includes(plugin.protocol) || plugin.username || plugin.password
    || plugin.pathname !== '/' || plugin.search || plugin.hash) throw new Error('Invalid plugin origin');
  const fallback = document.createElement('p');
  const link = document.createElement('a');
  link.href = `${plugin.origin}/dashboard/devices`;
  link.target = '_blank'; link.rel = 'noopener noreferrer';
  link.textContent = 'External status — open plugin dashboard';
  fallback.append(link, document.createTextNode(' · Existing plugin login required; embedded status unavailable.'));
  element.append(fallback);
  let disposed = false;
  let unmount;
  if (plugin.origin === location.origin && options.authorizedSameOriginBootstrap === true) {
    void import('/widgets/jazz-status/dist/jazz-status.js').then(module => {
      if (disposed) return;
      unmount = module.mountJazzStatus(element, options);
      fallback.remove();
    }).catch(() => { /* The external link remains usable; never retry or poll automatically. */ });
  }
  return () => { disposed = true; unmount?.(); fallback.remove(); };
}
