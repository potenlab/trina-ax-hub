// Run this function with playwright and playwright_phone browser_run_code_unsafe.
// Requires the built site preview on port 19900. Does not send email or submit forms.
async (page) => {
  const origin = 'http://localhost:19900';
  const output = '/Users/potenlab/trina-qa/QA-2026-10-28/results';
  const mobile = await page.evaluate(() => navigator.userAgent.includes('Mobile'));
  const device = mobile ? 'phone' : 'desktop';
  if (!mobile) await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ media: 'screen', reducedMotion: 'reduce' });
  const routes = ['/en', '/en/guide', '/en/guide/ai-connection', '/en/guide/team-files', '/en/guide/use-cases/sales-quote', '/en/guide/first-week', '/brochure'];
  const results = [];
  const errors = [];
  let current = '';
  const onConsole = msg => { if (msg.type() === 'error') errors.push({ path: current, type: 'console', message: msg.text() }); };
  const onError = err => errors.push({ path: current, type: 'runtime', message: err.message });
  const onFailure = req => errors.push({ path: current, type: 'network', url: req.url(), message: req.failure()?.errorText });
  page.on('console', onConsole);
  page.on('pageerror', onError);
  page.on('requestfailed', onFailure);
  const external = new Set();
  const localCache = new Map();
  try {
    await page.goto(origin + '/en');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => localStorage.setItem('theme', theme), theme);
      await page.emulateMedia({ colorScheme: theme });
      for (const path of routes) {
        current = `${theme} ${path}`;
        const response = await page.goto(origin + path, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        const state = await page.evaluate(() => ({
          viewport: { width: innerWidth, height: innerHeight },
          width: document.documentElement.scrollWidth,
          renderedTheme: document.documentElement.dataset.theme,
          lang: document.documentElement.lang,
          h1: document.querySelector('h1')?.textContent,
          brokenImages: [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.src),
          links: [...new Set([...document.querySelectorAll('a[href]')].map(a => a.href))],
        }));
        const brokenLinks = [];
        for (const href of state.links) {
          const url = new URL(href);
          if (!['http:', 'https:'].includes(url.protocol)) continue;
          if (url.origin !== origin && url.origin !== 'https://ax.trina.app') { external.add(href); continue; }
          // Absolute production links on the brochure point to the equivalent local build.
          const target = origin + url.pathname + url.search;
          if (!localCache.has(target)) {
            const r = await page.request.get(target);
            localCache.set(target, { status: r.status(), text: (r.headers()['content-type'] || '').includes('text/html') ? await r.text() : '' });
          }
          const r = localCache.get(target);
          if (r.status !== 200) brokenLinks.push({ href, status: r.status });
          else if (url.hash) {
            const id = decodeURIComponent(url.hash.slice(1));
            const present = await page.evaluate(({html,id}) => new DOMParser().parseFromString(html, 'text/html').getElementById(id) !== null, {html:r.text,id});
            if (!present) brokenLinks.push({ href, reason: 'missing fragment' });
          }
        }
        const screenshot = `site-en-${device}-${theme}-${path.replace(/^\//,'').replaceAll('/','-')}.png`;
        await page.screenshot({ path: `${output}/${screenshot}`, fullPage: true });
        const {links, ...summary} = state;
        results.push({path,theme,status:response.status(),...summary,linkCount:links.length,brokenLinks,screenshot});
      }
    }
    const report = { device, results, errors, externalLinks: [...external], checkedLocalTargets: localCache.size };
    return report;
  } finally {
    page.off('console', onConsole); page.off('pageerror', onError); page.off('requestfailed', onFailure);
  }
}
