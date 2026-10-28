// Run with the connected playwright and playwright_phone browser_run_code_unsafe tools.
// Built preview only: PORT=19920 bun run preview. No external submissions.
async (page) => {
  const origin = 'http://localhost:19920';
  const output = '/Users/potenlab/trina-qa/QA-2026-10-28/results/screenshots/SITE-RELEASE';
  const mobile = await page.evaluate(() => /Mobile/.test(navigator.userAgent));
  const device = mobile ? 'phone' : 'desktop';
  await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
  await page.emulateMedia({ media: 'screen', reducedMotion: 'no-preference' });
  const routes = ['/', '/ko/', '/en/guide', '/ko/guide', '/en/guide/ai-connection', '/en/guide/use-cases/sales-quote', '/ko/guide/team-files', '/ko/guide/use-cases/official-letter', '/guide/first-week', '/ko/guide/first-week', '/brochure', '/ko/brochure'];
  const results = [], errors = [], chapters = [], cache = new Map();
  let current = '';
  const consoleError = msg => { if (msg.type() === 'error') errors.push({ current, type: 'console', message: msg.text() }); };
  const runtimeError = err => errors.push({ current, type: 'runtime', message: err.message });
  const networkError = req => errors.push({ current, type: 'network', url: req.url(), message: req.failure()?.errorText });
  page.on('console', consoleError); page.on('pageerror', runtimeError); page.on('requestfailed', networkError);
  try {
    await page.goto(origin);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(t => localStorage.setItem('theme', t), theme);
      await page.emulateMedia({ colorScheme: theme });
      for (const path of routes) {
        current = `${theme} ${path}`;
        const response = await page.goto(origin + path, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        const state = await page.evaluate(() => ({
          viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          theme: document.documentElement.dataset.theme, lang: document.documentElement.lang,
          brokenImages: [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.src),
          links: [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href))],
        }));
        const brokenLinks = [];
        for (const href of state.links) {
          const url = new URL(href);
          if (![origin, 'https://ax.trina.app'].includes(url.origin)) continue;
          const target = origin + url.pathname + url.search;
          if (!cache.has(target)) {
            const r = await page.request.get(target);
            const type = r.headers()['content-type'] || '';
            cache.set(target, { status: r.status(), type, text: type.includes('text/html') ? await r.text() : '', pdf: type.includes('application/pdf') ? (await r.body()).subarray(0, 5).toString() === '%PDF-' : null });
          }
          const r = cache.get(target);
          if (r.status !== 200 || r.pdf === false) brokenLinks.push({ href, status: r.status, pdf: r.pdf });
          else if (url.hash && !await page.evaluate(({ html, id }) => !!new DOMParser().parseFromString(html, 'text/html').getElementById(id), { html: r.text, id: decodeURIComponent(url.hash.slice(1)) })) brokenLinks.push({ href, reason: 'missing fragment' });
        }
        const label = path === '/' ? 'home-en' : path === '/ko/' ? 'home-ko' : path.slice(1).replaceAll('/', '-');
        await page.screenshot({ path: `${output}/${device}-${theme}-${label}.png`, fullPage: path !== '/' && path !== '/ko/' });
        const { links, ...summary } = state;
        results.push({ path, requestedTheme: theme, status: response.status(), ...summary, linkCount: links.length, brokenLinks });
        if (path === '/' || path === '/ko/') {
          for (const id of ['sales', 'marketing', 'finance', 'people', 'operations', 'leadership']) {
            await page.locator(`.team-jumps a[href="#team-${id}"]`).click();
            await page.waitForTimeout(400);
            const geometry = await page.evaluate(id => ({
              viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
              focus: document.activeElement.id,
              titleTop: document.querySelector(`#team-${id}-title`).getBoundingClientRect().top,
              cards: document.querySelectorAll(`#team-${id} .team-example`).length,
              overflow: [...document.querySelectorAll(`#team-${id} .team-result`)].filter(e => e.scrollWidth > e.clientWidth + 1).length,
            }), id);
            chapters.push({ path, theme, id, ...geometry });
            await page.screenshot({ path: `${output}/${device}-${theme}-${label}-${id}.png` });
          }
        }
      }
    }
    return { device, results, chapters, errors, checkedLocalTargets: cache.size, brochures: [...cache].filter(([url]) => url.endsWith('.pdf')).map(([url, r]) => ({ url, status: r.status, type: r.type, validPDF: r.pdf })) };
  } finally {
    page.off('console', consoleError); page.off('pageerror', runtimeError); page.off('requestfailed', networkError);
  }
}
