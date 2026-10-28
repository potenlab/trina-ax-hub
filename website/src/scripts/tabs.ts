// Tabs (the role tabs on the home page), following the WAI-ARIA tabs pattern: click or arrow keys / Home / End switch
// panels, and the selected tab is the only one in the tab order. Panels never change on their own. Without JavaScript
// the tab row is hidden (html:not(.js) in CSS) and every panel shows, one after another.

function setup(root: HTMLElement) {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
  const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls') ?? ''))
  const select = (i: number, focus: boolean) => {
    tabs.forEach((t, j) => {
      const on = i === j
      t.setAttribute('aria-selected', String(on))
      t.tabIndex = on ? 0 : -1
      panels[j]?.classList.toggle('is-active', on)
    })
    if (focus) tabs[i].focus()
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(i, false))
    t.addEventListener('keydown', (e) => {
      const n = tabs.length
      const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
      if (to < 0) return
      e.preventDefault()
      select(to, true)
    })
  })
}

document.querySelectorAll<HTMLElement>('[data-tabs]').forEach(setup)
