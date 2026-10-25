/** @jsxImportSource hono/jsx */
// Shared page shell and styles for every server-rendered page (web pages and phone chat).
import type { Child } from 'hono/jsx'
import { raw } from 'hono/html'
import { PRODUCT } from '../product'
import type { Principal } from '../policy/access'

export const CSS = `
:root{--bg:#f7f7f5;--panel:#fff;--ink:#1d1d1b;--muted:#6b6b66;--line:#e4e3de;--accent:#0f766e;--accent-ink:#fff;--accent-soft:#e6f3f1;
--warn:#b45309;--warn-soft:#fef3c7;--bad:#b91c1c;--bad-soft:#fee2e2;--good:#15803d;--good-soft:#dcfce7;--radius:10px;
font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,-apple-system,sans-serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#151514;--panel:#1e1e1c;--ink:#ecebe6;--muted:#a3a29b;--line:#33332f;--accent:#2dd4bf;--accent-ink:#06201d;
--accent-soft:#0f2e2b;--warn:#fbbf24;--warn-soft:#3a2a07;--bad:#f87171;--bad-soft:#3b1212;--good:#4ade80;--good-soft:#0f2e19;color-scheme:dark}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-size:15px;line-height:1.55}
a{color:var(--accent)}header.top{display:flex;align-items:center;gap:16px;padding:12px 20px;background:var(--panel);border-bottom:1px solid var(--line);flex-wrap:wrap}
header.top .brand{font-weight:700;text-decoration:none;color:var(--ink)}header.top nav{display:flex;gap:4px;flex-wrap:wrap;flex:1}
header.top nav a{padding:6px 10px;border-radius:8px;text-decoration:none;color:var(--muted)}header.top nav a.on{background:var(--accent-soft);color:var(--accent);font-weight:600}
header.top .who{color:var(--muted);font-size:13px;display:flex;gap:8px;align-items:center}
main{max-width:1080px;margin:0 auto;padding:24px 20px 64px}main.narrow{max-width:520px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 10px}.lead{color:var(--muted);margin:0 0 20px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:18px 20px;margin:0 0 16px}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin:0 0 16px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:14px 16px}.stat b{display:block;font-size:22px}.stat span{color:var(--muted);font-size:13px}
table{width:100%;border-collapse:collapse;background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top;font-size:14px}th{color:var(--muted);font-weight:600;font-size:13px;background:var(--bg)}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}tr:last-child td{border-bottom:0}
.tablewrap{overflow-x:auto;margin:0 0 16px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--panel);color:var(--ink);font:inherit;font-size:14px;cursor:pointer;text-decoration:none}
.btn:hover{border-color:var(--muted)}.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}.btn.danger{color:var(--bad)}
.btn.small{padding:4px 10px;font-size:13px}.btn:disabled,.btn[disabled]{opacity:.5;cursor:not-allowed}.btn:disabled:hover{border-color:var(--line)}
form.inline{display:inline}.field{display:flex;flex-direction:column;gap:4px;margin:0 0 12px}.field label{font-size:13px;color:var(--muted);font-weight:600}
input,select,textarea{font:inherit;font-size:15px;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);width:100%}
textarea{min-height:90px;resize:vertical}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}.row>.field{flex:1;min-width:140px}
.muted{color:var(--muted)}.small{font-size:13px}.badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;background:var(--bg);border:1px solid var(--line);color:var(--muted)}
.badge.good{background:var(--good-soft);color:var(--good);border-color:transparent}.badge.warn{background:var(--warn-soft);color:var(--warn);border-color:transparent}.badge.bad{background:var(--bad-soft);color:var(--bad);border-color:transparent}
.notice{padding:12px 14px;border-radius:var(--radius);margin:0 0 16px;background:var(--accent-soft)}.notice.warn{background:var(--warn-soft);color:var(--warn)}.notice.bad{background:var(--bad-soft);color:var(--bad)}
pre,code{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:13px}pre.cmd{background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;white-space:pre-wrap;word-break:break-all;margin:6px 0}
.copy{position:relative}.copy button{position:absolute;top:6px;right:6px}.copyhelp{font-size:13px;color:var(--warn);margin:2px 0 8px}
.choice{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--line);border-radius:8px;margin:0 0 8px;cursor:pointer}.choice input{width:auto;margin-top:5px}
.bar{height:8px;border-radius:4px;background:var(--line);overflow:hidden}.bar i{display:block;height:100%;background:var(--accent)}.bar.over i{background:var(--bad)}
header.top .who span{max-width:10em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media (max-width:640px){main{padding:16px 14px 48px}header.top{padding:10px 14px;gap:8px 12px}th,td{padding:8px}
  header.top nav{order:3;flex:1 0 100%;flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;margin:0 -14px;padding:0 28px 0 10px;
    -webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 24px),transparent)}
  header.top nav::-webkit-scrollbar{display:none}header.top nav a{white-space:nowrap;flex:0 0 auto}header.top .who{margin-left:auto}
  .grid{grid-template-columns:repeat(2,minmax(0,1fr))}.grid>:last-child:nth-child(odd){grid-column:1/-1}.stat b{font-size:19px}}
`

// Copy buttons. navigator.clipboard exists only on https or localhost; a hub opened at http://192.168.x.y (office
// network) has none, so fall back to selecting the text and execCommand('copy'), and when even that fails leave the
// text selected and tell people to long-press it.
const COPY_JS = `(()=>{
const flash=(b,t)=>{b.dataset.label=b.dataset.label||b.textContent;b.textContent=t;clearTimeout(b._t);b._t=setTimeout(()=>{b.textContent=b.dataset.label},2000)}
const pick=el=>{const r=document.createRange();r.selectNodeContents(el);const s=getSelection();s.removeAllRanges();s.addRange(r)}
const legacy=(b,el)=>{pick(el);let ok=false;try{ok=document.execCommand('copy')}catch(_){}
if(ok){getSelection().removeAllRanges();flash(b,'복사됨');return}
flash(b,'선택됨');let h=b.parentNode.nextElementSibling;if(!h||!h.classList.contains('copyhelp')){h=document.createElement('p');h.className='copyhelp';h.setAttribute('role','status');b.parentNode.after(h)}
h.textContent='길게 눌러 복사해 주세요. (PC에서는 Ctrl+C, 맥에서는 ⌘+C)'}
document.addEventListener('click',e=>{const b=e.target.closest('[data-copy]');if(!b)return;const el=document.getElementById(b.dataset.copy);if(!el)return
if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(el.innerText.trim()).then(()=>flash(b,'복사됨'),()=>legacy(b,el));else legacy(b,el)})
})()`

// On a phone the navigation is one scrolling row: bring the current page's item into view.
const NAV_JS = `(()=>{const n=document.querySelector('header.top nav'),a=n&&n.querySelector('a.on');if(!a||n.scrollWidth<=n.clientWidth)return
n.scrollLeft+=a.getBoundingClientRect().left-n.getBoundingClientRect().left-(n.clientWidth-a.offsetWidth)/2})()`

export interface NavItem { href: string; label: string }

export function Page(p: { title: string; user?: Principal | null; nav?: NavItem[]; active?: string; narrow?: boolean; children: Child; head?: Child; csrf?: string }) {
  return (
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
        <title>{p.title} · {PRODUCT.displayName}</title>
        <style>{raw(CSS)}</style>
        {p.head}
      </head>
      <body>
        <header class="top">
          <a class="brand" href="/">{PRODUCT.displayName}</a>
          <nav>{(p.nav ?? []).map((n) => <a href={n.href} class={p.active === n.href ? 'on' : ''}>{n.label}</a>)}</nav>
          {p.user ? (
            <div class="who">
              <span>{p.user.name}</span>
              <form class="inline" method="post" action="/logout">{p.csrf ? <Csrf token={p.csrf} /> : null}<button class="btn small" type="submit">로그아웃</button></form>
            </div>
          ) : null}
        </header>
        <main class={p.narrow ? 'narrow' : ''}>{p.children}</main>
        <script>{raw(NAV_JS + ';' + COPY_JS)}</script>
      </body>
    </html>
  )
}

/** Hidden CSRF field for a form (every POST from a page must carry it). */
export const Csrf = (p: { token: string }) => <input type="hidden" name="_csrf" value={p.token} />

/** A command people copy (install lines). */
export const CopyBlock = (p: { id: string; text: string }) => (
  <div class="copy"><pre class="cmd" id={p.id}>{p.text}</pre><button type="button" class="btn small" data-copy={p.id}>복사</button></div>
)
