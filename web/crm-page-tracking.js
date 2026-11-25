(() => {
  const page = document.querySelector('[data-crm-landing]');
  if (!page || !globalThis.crypto?.getRandomValues) return;

  const url = new URL(location.href);
  const ref = url.searchParams.get('ref');
  const reference = /^[a-f0-9]{64}$/.test(ref || '') ? ref : null;
  if (ref !== null) {
    url.searchParams.delete('ref');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }

  const visitToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
  const blocks = new Map(Array.from(page.querySelectorAll('[data-crm-block]'), block => [block.dataset.crmBlock, {
    element: block, seen: false, milliseconds: 0, clicks: 0,
  }]));
  const choice = document.querySelector('[data-crm-choice]');
  const allow = document.querySelector('[data-crm-identify]');
  const decline = document.querySelector('[data-crm-decline]');
  let startConfirmed = false;
  let request = null;
  let pageTime = 0;
  let lastTick = performance.now();
  let lastActivity = lastTick;
  let dirty = true;

  function recordTime() {
    const now = performance.now();
    const millis = Math.max(0, Math.min(now - lastTick, 1_250));
    lastTick = now;
    if (!millis || document.hidden || !document.hasFocus() || now - lastActivity > 45_000) return;
    if (pageTime < 14_400_000) pageTime += millis;
    for (const block of blocks.values()) {
      const bounds = block.element.getBoundingClientRect();
      const visibleHeight = Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0);
      if (visibleHeight < Math.min(120, bounds.height * .35) || visibleHeight <= 0) continue;
      block.seen = true;
      if (block.milliseconds < 14_400_000) block.milliseconds += millis;
    }
    dirty = true;
  }

  function snapshot(operation) {
    return {
      operation, slug: page.dataset.slug, visitToken, ...((operation === 'start' || operation === 'identify') && { reference }),
      seconds: Math.floor(pageTime / 1_000),
      blocks: [...blocks.entries()].filter(([, block]) => block.seen || block.clicks > 0).map(([id, block]) => ({
        id, seen: block.seen, clicks: block.clicks, seconds: Math.floor(block.milliseconds / 1_000),
      })),
    };
  }

  async function transmit(operation) {
    const body = JSON.stringify(snapshot(operation));
    try {
      const response = await fetch('/crm/pagina/eventos', {
        method: 'POST', credentials: 'same-origin', redirect: 'error', keepalive: true,
        headers: { 'Content-Type': 'application/json' }, body,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function start() {
    if (startConfirmed) return true;
    if (await transmit('start')) {
      startConfirmed = true;
      for (const input of page.querySelectorAll('input[name="visit"]')) input.value = visitToken;
    }
    return startConfirmed;
  }

  function flush() {
    if (!dirty || request) return;
    dirty = false;
    request = (startConfirmed ? transmit('measure') : start()).then(ok => { if (!ok) dirty = true; })
      .finally(() => { request = null; });
  }

  for (const event of ['pointerdown', 'keydown', 'scroll', 'focus']) {
    window.addEventListener(event, () => { lastActivity = performance.now(); }, { passive: true });
  }
  page.addEventListener('click', event => {
    const id = event.target instanceof Element ? event.target.closest('[data-crm-block]')?.dataset.crmBlock : null;
    const block = blocks.get(id);
    if (!block || event.button !== 0) return;
    block.clicks = Math.min(block.clicks + 1, 500);
    block.seen = dirty = true;
    flush();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
    lastTick = performance.now();
  });
  window.addEventListener('pagehide', () => {
    if (dirty || request) void transmit(startConfirmed ? 'measure' : 'start');
  });

  if (choice && allow && decline && reference) {
    choice.hidden = false;
    allow.addEventListener('click', async () => {
      allow.disabled = true;
      decline.disabled = true;
      recordTime();
      if (request) await request;
      if (await start() && await transmit('identify')) {
        choice.hidden = true;
      } else {
        allow.disabled = false;
        decline.disabled = false;
      }
    });
    decline.addEventListener('click', () => { choice.hidden = true; });
  }

  if (!document.hidden) flush();
  setInterval(recordTime, 1_000);
  setInterval(flush, 10_000);
})();
