/**
 * Firework for the Star button: a short, self-contained canvas animation
 * appended to document.body with pointer-events:none and removed when done,
 * so it can never intercept clicks. No dependencies, no stylesheet injection:
 * every style is inline, so cleanup is simply removing the element.
 *
 * Five staggered bursts of ~90 trailing particles each; the GitHub page opens
 * only after the show ends (celebrateThenOpen).
 */

const BURSTS = 5
const BURST_GAP_MS = 280
const PARTICLES_PER_BURST = 90
const GRAVITY = 300 // px/s²
const MAX_LIFE_S = 2.0
const COLORS = ['#f43f5e', '#fb923c', '#facc15', '#4ade80', '#38bdf8', '#a78bfa', '#f472b6']
// Last spawn (4×280) + max rocket travel (~800) + max particle life (2000), rounded up.
const FIREWORKS_TOTAL_MS = 4000

interface Rocket { x: number; y: number; vy: number; targetY: number; color: string }
interface Particle { x: number; y: number; px: number; py: number; vx: number; vy: number; life: number; maxLife: number; color: string }

/** Play the fireworks, then open `url` in a new tab once the sky is clear.
 *  Browsers honor the click's transient activation for a few seconds, so the
 *  delayed open is not popup-blocked in Chrome; stricter browsers fall back
 *  on the repo button beside the counter, which opens the page directly. */
export function celebrateThenOpen(url: string): void {
  const launched = launchFireworks()
  setTimeout(() => { try { window.open(url, '_blank', 'noopener') } catch { /* fallback button */ } }, launched ? FIREWORKS_TOTAL_MS : 400)
}

/** Launch the bursts. Returns false when nothing was animated (reduced-motion
 *  preference, an existing show, or an unavailable 2D context). */
export function launchFireworks(): boolean {
  try {
    // Respect the OS reduced-motion preference: no animation at all.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    // A burst is still running: keep it, don't stack a second canvas.
    if (document.querySelector('[data-fm-fireworks]')) return false
    const canvas = document.createElement('canvas')
    canvas.setAttribute('data-fm-fireworks', '')
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = window.innerWidth
    const h = window.innerHeight
    canvas.width = Math.max(1, Math.floor(w * dpr))
    canvas.height = Math.max(1, Math.floor(h * dpr))
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2147483000'
    document.body.appendChild(canvas)
    const ctx = canvas.getContext('2d')
    if (!ctx) { canvas.remove(); return false }
    ctx.scale(dpr, dpr)

    const rand = (a: number, b: number) => a + Math.random() * (b - a)
    const rockets: Rocket[] = []
    const particles: Particle[] = []
    const spawnRocket = (i: number) => {
      rockets.push({
        x: w * (0.22 + 0.14 * i) + rand(-30, 30),
        y: h + 8,
        vy: -h * rand(1.05, 1.25),
        targetY: h * rand(0.14, 0.36),
        color: COLORS[i % COLORS.length],
      })
    }
    // Bursts are spawned BY THE LOOP, on schedule, never by setTimeout: a
    // trusted click pumps a frame immediately, and on fast displays that
    // first rAF can beat a 0ms timer — a loop that found both arrays empty
    // would remove the canvas and stop before a single rocket existed.
    const start = performance.now()
    let spawned = 0

    const explode = (r: Rocket) => {
      for (let k = 0; k < PARTICLES_PER_BURST; k++) {
        const angle = (Math.PI * 2 * k) / PARTICLES_PER_BURST + rand(-0.07, 0.07)
        // Two shells per burst: a fast outer ring and a slower inner fill.
        const speed = rand(80, 430) * (k % 4 === 0 ? 0.55 : 1)
        const maxLife = rand(1.2, MAX_LIFE_S)
        particles.push({
          x: r.x, y: r.y, px: r.x, py: r.y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: maxLife, maxLife,
          color: Math.random() < 0.25 ? '#ffffff' : r.color,
        })
      }
    }

    let prev = performance.now()
    let raf = 0
    const step = (now: number) => {
      const dt = Math.min((now - prev) / 1000, 0.05)
      prev = now
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      const elapsed = now - start
      while (spawned < BURSTS && elapsed >= spawned * BURST_GAP_MS) spawnRocket(spawned++)
      for (let i = rockets.length - 1; i >= 0; i--) {
        const r = rockets[i]
        r.y += r.vy * dt
        ctx.globalAlpha = 0.9
        ctx.strokeStyle = r.color
        ctx.lineWidth = 2.4
        ctx.beginPath(); ctx.moveTo(r.x, r.y + 9); ctx.lineTo(r.x, r.y); ctx.stroke()
        // Rising sparks: the climb sheds a few glittering motes.
        if (Math.random() < 0.6) {
          particles.push({ x: r.x + rand(-2, 2), y: r.y + rand(0, 6), px: r.x, py: r.y, vx: rand(-30, 30), vy: rand(10, 70), life: rand(0.25, 0.5), maxLife: 0.5, color: r.color })
        }
        if (r.y <= r.targetY) { explode(r); rockets.splice(i, 1) }
      }
      ctx.lineWidth = 1.8
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i]
        p.life -= dt
        if (p.life <= 0) { particles.splice(i, 1); continue }
        p.px = p.x; p.py = p.y
        p.vy += GRAVITY * dt
        p.vx *= 1 - 1.1 * dt
        p.vy *= 1 - 0.4 * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        let a = p.life / p.maxLife
        // Crackle: dying sparks flicker instead of fading linearly.
        if (p.life < p.maxLife * 0.4 && Math.random() < 0.35) a *= 0.3
        ctx.globalAlpha = Math.max(0, a)
        ctx.strokeStyle = p.color
        ctx.beginPath(); ctx.moveTo(p.px, p.py); ctx.lineTo(p.x, p.y); ctx.stroke()
      }
      ctx.globalAlpha = 1
      // The deadline guards shutdown: empty arrays alone would let the loop
      // die between bursts (exactly the race this module was fixed for).
      if (elapsed < FIREWORKS_TOTAL_MS || rockets.length > 0 || particles.length > 0) { raf = requestAnimationFrame(step); return }
      canvas.remove()
    }
    raf = requestAnimationFrame(step)
    // Safety net: if the loop ever wedges (tab backgrounded mid-flight etc.),
    // the guest element still leaves the page after a bounded time.
    setTimeout(() => { cancelAnimationFrame(raf); canvas.remove() }, FIREWORKS_TOTAL_MS + 3000)
    return true
  } catch { /* celebration must never break the click */ }
  return false
}
