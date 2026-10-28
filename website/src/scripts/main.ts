// Client behaviour, for every page: theme toggle, mobile menu, copy button, the hero demo and the role tabs. No
// dependencies; the page reads fine without it.
import './demo'
import './tabs'
import { clipboardHelp } from '../content/clipboard'

const root = document.documentElement

// ---- theme: system by default, the toggle remembers a choice ----
const isDark = () =>
  root.dataset.theme ? root.dataset.theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark'
    root.dataset.theme = next
    try { localStorage.setItem('theme', next) } catch { /* private mode: the choice just lasts for this visit */ }
  })
})

// ---- mobile menu ----
const menuBtn = document.querySelector<HTMLButtonElement>('[data-menu-toggle]')
const menu = document.getElementById('mobile-menu')
if (menuBtn && menu) {
  const set = (open: boolean) => { menu.dataset.open = String(open); menuBtn.setAttribute('aria-expanded', String(open)) }
  menuBtn.addEventListener('click', () => set(menu.dataset.open !== 'true'))
  menu.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('a')) set(false) })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu.dataset.open === 'true') { set(false); menuBtn.focus() } })
}

// ---- copy button ----
document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((btn) => {
  const label = btn.textContent ?? ''
  let fallback: HTMLDivElement | undefined
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy ?? '')
      fallback?.remove()
      fallback = undefined
      btn.textContent = btn.dataset.copied ?? label
      setTimeout(() => { btn.textContent = label }, 1600)
    } catch {
      // A restricted browser still gets the exact text, without command prompts or markup.
      if (!fallback) {
        fallback = document.createElement('div')
        fallback.className = 'copy-fallback'
        const help = document.createElement('p')
        help.id = `copy-help-${[...document.querySelectorAll('[data-copy]')].indexOf(btn)}`
        help.setAttribute('role', 'status')
        help.textContent = clipboardHelp[root.lang === 'ko' ? 'ko' : 'en']
        const field = document.createElement('textarea')
        field.readOnly = true
        field.value = btn.dataset.copy ?? ''
        field.setAttribute('aria-labelledby', help.id)
        fallback.append(help, field)
        btn.parentElement?.after(fallback)
      }
      const field = fallback.querySelector('textarea')!
      field.focus()
      field.select()
    }
  })
})
