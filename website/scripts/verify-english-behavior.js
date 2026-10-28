// Companion to verify-english-browser.js; run on both connected Playwright browsers.
async (page) => {
  const origin = 'http://localhost:19900';
  const device = await page.evaluate(() => navigator.userAgent.includes('Mobile') ? 'phone' : 'desktop');
  const checks = [], errors = [];
  const onError = e => errors.push(e.message);
  const onConsole = e => { if (e.type() === 'error') errors.push(e.text()); };
  page.on('pageerror', onError); page.on('console', onConsole);
  const check = (name, ok, detail) => { checks.push({name,ok,detail}); if (!ok) throw new Error(name + ': ' + JSON.stringify(detail)); };
  try {
    await page.emulateMedia({media:'screen',reducedMotion:'no-preference'});
    await page.goto(origin + '/en');
    await page.locator('[data-demo]').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelector('[data-demo]').dataset.play === 'playing');
    await page.locator('[data-demo-toggle]').click();
    check('Demo pauses', await page.locator('[data-demo]').getAttribute('data-play') === 'paused');
    await page.locator('[data-demo-toggle]').click();
    check('Demo resumes', await page.locator('[data-demo]').getAttribute('data-play') === 'playing');
    await page.waitForFunction(() => document.querySelector('[data-demo]').dataset.play === 'done', {timeout:30000});
    check('Demo completes', true);
    await page.locator('[data-demo-toggle]').click();
    check('Demo replays', await page.locator('[data-demo]').getAttribute('data-play') === 'playing');
    await page.locator('[data-demo-toggle]').click();
    for (const role of ['ceo','sales','finance','people']) {
      await page.locator(`#role-tab-${role}`).click();
      check(`${role} tab opens`, await page.locator(`#role-${role}`).isVisible());
      const widths = await page.evaluate(() => ({viewport:innerWidth,document:document.documentElement.scrollWidth}));
      check(`${role} tab fits`, widths.document <= widths.viewport, widths);
      check(`${role} guide is linked`, (await page.locator(`#role-${role} .role-guide-link`).getAttribute('href')).startsWith('/guide/use-cases/'));
    }
    await page.locator('#role-tab-ceo').focus();
    await page.keyboard.press('ArrowRight');
    check('Arrow keys change role', await page.locator('#role-tab-sales').getAttribute('aria-selected') === 'true');
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.locator('[data-theme-toggle]').click();
    await page.reload();
    check('Theme choice survives reload', await page.evaluate(old => document.documentElement.dataset.theme !== old, before));
    if (device === 'phone') {
      await page.locator('[data-menu-toggle]').click();
      check('Phone menu opens', await page.locator('[data-menu-toggle]').getAttribute('aria-expanded') === 'true');
      await page.locator('#mobile-menu').getByRole('link', {name:'Guide',exact:true}).click();
      check('Phone menu navigates and closes', new URL(page.url()).pathname === '/guide' && await page.locator('[data-menu-toggle]').getAttribute('aria-expanded') === 'false');
    }
    await page.goto(origin + '/en/guide/use-cases/sales-quote');
    const copy = page.locator('#request [data-copy]');
    const expected = await copy.getAttribute('data-copy');
    await copy.click();
    await page.waitForFunction(() => document.querySelector('#request [data-copy]').textContent === 'Copied' || !!document.querySelector('.copy-fallback textarea'));
    const fallback = page.locator('.copy-fallback textarea');
    if (await fallback.count()) check('Manual copy fallback preserves request', await fallback.inputValue() === expected);
    else check('Request copied', await copy.textContent() === 'Copied');
    await page.locator('.lang-link').click();
    check('Language switch keeps article', new URL(page.url()).pathname === '/ko/guide/use-cases/sales-quote');
    await page.locator('.lang-link').click();
    check('Switch back returns English article', new URL(page.url()).pathname === '/guide/use-cases/sales-quote');
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto(origin + '/en');
    check('Reduced motion shows finished demo', await page.locator('[data-demo]').getAttribute('data-play') === 'done');
    return {device,checks,errors};
  } finally { page.off('pageerror',onError); page.off('console',onConsole); }
}
