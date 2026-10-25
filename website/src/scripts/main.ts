// Client behaviour, for every page: theme toggle, mobile menu, copy button. No dependencies; the page reads fine without it.

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
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(btn.dataset.copy ?? '')
      btn.textContent = btn.dataset.copied ?? label
      setTimeout(() => { btn.textContent = label }, 1600)
    } catch { /* clipboard blocked: the text is visible next to the button */ }
  })
})
