// @ts-check
import { defineConfig } from 'astro/config'

// Static site for Cloudflare Workers Assets. Every script and stylesheet is emitted as a file under /_astro/ (nothing
// inlined), so the Content-Security-Policy in public/_headers can say script-src 'self'; style-src 'self'.
//
// Output layout (build.format 'preserve'): /index.html, /ko/index.html, /security.html, /ko/security.html, /404.html.
// Workers Assets' default html_handling (auto-trailing-slash) then serves them as /, /ko/, /security and /ko/security,
// and redirects /ko -> /ko/ and /security/ -> /security.
export default defineConfig({
  site: 'https://ax.trina.app',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'preserve', inlineStylesheets: 'never' },
  compressHTML: true,
  devToolbar: { enabled: false },
  vite: { build: { assetsInlineLimit: 0 } },
})
