// Runs in <head> before paint: mark that scripts run (class "js": the role tabs and the demo start from their first
// state, not their finished one, so nothing jumps), then apply the visitor's saved theme ("light" | "dark");
// otherwise CSS follows the system.
document.documentElement.classList.add('js')
try {
  var t = localStorage.getItem('theme')
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t)
} catch (e) {}
