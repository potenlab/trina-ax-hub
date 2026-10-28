// Progressive enhancement only: content is never hidden or replaced.
const showcase = document.querySelector<HTMLElement>('[data-team-showcase]')
if (showcase && 'IntersectionObserver' in window) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  const toggle = showcase.querySelector<HTMLButtonElement>('[data-team-motion]')!
  let paused = false
  const updateMotion = () => {
    showcase.dataset.motion = paused || reduce.matches ? 'off' : 'on'
    toggle.hidden = reduce.matches
    toggle.setAttribute('aria-pressed', String(paused))
  }
  toggle.addEventListener('click', () => { paused = !paused; updateMotion() })
  reduce.addEventListener('change', updateMotion)
  updateMotion()

  const cards = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('is-in-view')
      cards.unobserve(entry.target) // a single short entrance, no repeating animation
    }
  }, { threshold: 0.12 })
  showcase.querySelectorAll('.team-example').forEach(card => cards.observe(card))

  const links = [...showcase.querySelectorAll<HTMLAnchorElement>('.team-jumps a')]
  const chapters = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      for (const link of links) {
        if (link.hash === `#${entry.target.id}`) link.setAttribute('aria-current', 'location')
        else link.removeAttribute('aria-current')
      }
    }
  }, { rootMargin: '-20% 0px -55% 0px' })
  showcase.querySelectorAll('.team-chapter').forEach(chapter => chapters.observe(chapter))

  // Native anchor scrolling plus a keyboard focus destination; no scroll hijacking.
  links.forEach(link => link.addEventListener('click', () => {
    // Let the native fragment navigation finish before moving focus; otherwise
    // the browser can reset it to the body during the default anchor action.
    requestAnimationFrame(() => document.getElementById(`${link.hash.slice(1)}-title`)?.focus({ preventScroll: true }))
  }))
}
