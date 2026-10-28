// The scripted demo under the hero (Demo.astro). The page already holds the finished screen; this reveals it step by
// step, once, when it scrolls into view, with one button that pauses, resumes and replays (WCAG 2.2.2: motion longer
// than 5 seconds that starts by itself can be paused). Under prefers-reduced-motion nothing plays by itself and the
// finished screen stays; Replay still steps through it, without the motion. Classes only, no inline styles (the CSP).
//
// Markup contract, per element: data-t="n" appears at step n · data-off="n" disappears at n · data-done="n" is marked
// done at n · data-press="n" looks pressed from n. The root's data-timeline lists the wait in ms before each step.
// The root's data-play is idle | playing | paused | done (CSS hides what has not appeared yet while it is set).

const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

type Mark = { el: HTMLElement; at: number }
const marks = (root: HTMLElement, attr: string): Mark[] =>
  [...root.querySelectorAll<HTMLElement>(`[data-${attr}]`)].map((el) => ({ el, at: Number(el.dataset[attr]) }))

function setup(root: HTMLElement) {
  const delays = (root.dataset.timeline ?? '').split(',').map(Number).filter((n) => Number.isFinite(n))
  if (delays.length === 0) return
  const shows = marks(root, 't')
  const offs = marks(root, 'off')
  const dones = marks(root, 'done')
  const presses = marks(root, 'press')
  const scroller = root.querySelector<HTMLElement>('[data-scroll]')
  const btn = root.querySelector<HTMLButtonElement>('[data-demo-toggle]')
  const label = btn?.querySelector<HTMLElement>('.demo-btn-label')
  const words = { playing: root.dataset.playLabel ?? 'Pause', paused: root.dataset.resumeLabel ?? 'Play', done: root.dataset.replayLabel ?? 'Replay' }

  let next = 0
  let timer = 0

  const apply = (n: number) => {
    for (const m of shows) m.el.classList.toggle('on', m.at <= n)
    for (const m of offs) m.el.classList.toggle('off', m.at <= n)
    for (const m of dones) m.el.classList.toggle('done', m.at <= n)
    for (const m of presses) m.el.classList.toggle('pressed', m.at <= n)
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }
  const setState = (s: 'idle' | 'playing' | 'paused' | 'done') => {
    root.dataset.play = s
    if (label) label.textContent = s === 'playing' ? words.playing : s === 'paused' ? words.paused : words.done
  }
  const step = () => {
    apply(next)
    next += 1
    if (next >= delays.length) { setState('done'); return }
    timer = window.setTimeout(step, delays[next])
  }
  const play = () => { setState('playing'); timer = window.setTimeout(step, delays[next] ?? 0) }
  const pause = () => { window.clearTimeout(timer); setState('paused') }
  const replay = () => { window.clearTimeout(timer); next = 0; apply(-1); if (scroller) scroller.scrollTop = 0; play() }

  // Respect a preference changed while this page is open, including during playback.
  reduce.addEventListener('change', () => {
    if (!reduce.matches) return
    window.clearTimeout(timer)
    apply(Number.MAX_SAFE_INTEGER)
    setState('done')
    if (scroller) scroller.scrollTop = 0
  })

  btn?.addEventListener('click', () => {
    const s = root.dataset.play
    if (s === 'playing') pause()
    else if (s === 'paused') play()
    else replay()
  })

  if (reduce.matches || !('IntersectionObserver' in window)) {
    apply(Number.MAX_SAFE_INTEGER)
    setState('done')
    if (scroller) scroller.scrollTop = 0
    return
  }
  apply(-1)
  setState('idle')
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      io.disconnect()
      if (root.dataset.play === 'idle') play()
    },
    { threshold: 0.3 },
  )
  io.observe(root)
}

document.querySelectorAll<HTMLElement>('[data-demo]').forEach(setup)
