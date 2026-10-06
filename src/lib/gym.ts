/* ============================================================================
 * gym.ts — MOTOR DE INTERVALOS + AUDIO + VOZ (100 % navegador)
 * ----------------------------------------------------------------------------
 * Sin backend: la línea de tiempo se calcula en local, el sonido se sintetiza
 * con WebAudio y las consignas de voz usan la Web Speech API. Puro gh-pages.
 * ==========================================================================*/

export type TipoFase = 'prep' | 'work' | 'rest'

export interface Fase { tipo: TipoFase; asalto: number; duracion: number }
export interface Config { preparacion: number; trabajo: number; descanso: number; asaltos: number }

export const CONFIG_INICIAL: Config = { preparacion: 15, trabajo: 40, descanso: 20, asaltos: 8 }

/** Esquinas del ring: rojo trabajo · azul descanso · ámbar preparación. */
export const COLORES = { prep: '#FFB224', work: '#FF4B33', rest: '#4FA3FF', fin: '#E9C46A' } as const
export const ETIQUETA: Record<TipoFase, string> = { prep: 'PREPARACIÓN', work: 'TRABAJO', rest: 'DESCANSO' }

export function buildTimeline(c: Config): Fase[] {
  const fases: Fase[] = []
  if (c.preparacion > 0) fases.push({ tipo: 'prep', asalto: 0, duracion: c.preparacion })
  for (let i = 1; i <= c.asaltos; i++) {
    fases.push({ tipo: 'work', asalto: i, duracion: c.trabajo })
    if (i < c.asaltos && c.descanso > 0) fases.push({ tipo: 'rest', asalto: i, duracion: c.descanso })
  }
  return fases
}

export const totalFases = (f: Fase[]) => f.reduce((a, x) => a + x.duracion, 0)

/** Dado el tiempo transcurrido (s), localiza fase actual y restante. */
export function locate(fases: Fase[], t: number) {
  let acc = 0
  for (let i = 0; i < fases.length; i++) {
    const d = fases[i].duracion
    if (t < acc + d) return { indice: i, fase: fases[i], restante: acc + d - t, dentro: t - acc }
    acc += d
  }
  return null
}

export const PRESETS: { id: string; nombre: string; detalle: string; config: Config }[] = [
  { id: 'tabata', nombre: 'Tabata', detalle: '20/10 × 8', config: { preparacion: 10, trabajo: 20, descanso: 10, asaltos: 8 } },
  { id: 'hiit', nombre: 'HIIT clásico', detalle: '40/20 × 10', config: { preparacion: 15, trabajo: 40, descanso: 20, asaltos: 10 } },
  { id: 'boxeo', nombre: 'Boxeo', detalle: '3 min/1 min × 12', config: { preparacion: 30, trabajo: 180, descanso: 60, asaltos: 12 } },
  { id: 'sprints', nombre: 'Sprints', detalle: '30/90 × 6', config: { preparacion: 60, trabajo: 30, descanso: 90, asaltos: 6 } },
]

export function fmt(total: number): string {
  const s = Math.max(0, Math.round(total))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
    : `${m}:${String(r).padStart(2, '0')}`
}

/* -------------------------------- AUDIO ----------------------------------- */
let ctx: AudioContext | null = null
let audioMuted = false
export const setMutedAudio = (m: boolean) => { audioMuted = m }

function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return null
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch { return null }
}

/** Pitido corto para la cuenta atrás (3-2-1) y avisos. */
export function pitido(freq = 880, dur = 0.11, vol = 0.16) {
  if (audioMuted) return
  const a = ac(); if (!a) return
  const t = a.currentTime
  const o = a.createOscillator(); o.type = 'sine'; o.frequency.value = freq
  const g = a.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g); g.connect(a.destination)
  o.start(t); o.stop(t + dur + 0.05)
}

/** Campana de asalto: tres parciales metálicos con decaimiento largo. */
export function campana() {
  if (audioMuted) return
  const a = ac(); if (!a) return
  const t = a.currentTime
  ;([[622, 0.2, 1.3], [933, 0.14, 1.0], [1246, 0.09, 0.7]] as const).forEach(([f0, vol, dec], i) => {
    const o = a.createOscillator(); o.type = i === 0 ? 'triangle' : 'sine'; o.frequency.value = f0
    const g = a.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec)
    o.connect(g); g.connect(a.destination)
    o.start(t); o.stop(t + dec + 0.1)
  })
}

/** Silbato final: dos cuadradas desafinadas con envolvente larga. */
export function silbato() {
  if (audioMuted) return
  const a = ac(); if (!a) return
  const t = a.currentTime
  ;[2150, 2218].forEach((f0) => {
    const o = a.createOscillator(); o.type = 'square'; o.frequency.value = f0
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3600
    const g = a.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.02)
    g.gain.setValueAtTime(0.07, t + 0.75)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0)
    o.connect(lp); lp.connect(g); g.connect(a.destination)
    o.start(t); o.stop(t + 1.05)
  })
}

/* --------------------------------- VOZ ------------------------------------ */
let vozOn = true
export const setVoz = (b: boolean) => { vozOn = b }
export const vozDisponible = typeof window !== 'undefined' && 'speechSynthesis' in window

/** Consigna hablada: cancela la anterior para que nunca se encolen. */
export function decir(texto: string, rate = 1.05) {
  if (!vozOn || !vozDisponible) return
  const s = window.speechSynthesis
  const vs = s.getVoices()
  const u = new SpeechSynthesisUtterance(texto)
  u.voice = vs.find((v) => /^es[-_]es/i.test(v.lang)) ?? vs.find((v) => /^es/i.test(v.lang)) ?? null
  u.lang = 'es-ES'
  u.rate = rate
  s.cancel()
  s.speak(u)
}

/* ------------------------------ PERSISTENCIA ------------------------------ */
const CLAVE = 'asalto-config'

export function cargarConfig(): Config {
  try {
    const raw = localStorage.getItem(CLAVE)
    if (raw) return { ...CONFIG_INICIAL, ...(JSON.parse(raw) as Partial<Config>) }
  } catch { /* modo incógnito */ }
  return CONFIG_INICIAL
}

export function guardarConfig(c: Config) {
  try { localStorage.setItem(CLAVE, JSON.stringify(c)) } catch { /* sin storage */ }
}

/** Wake Lock: la pantalla del móvil no se apaga a mitad de asalto. */
export async function pedirWakeLock(): Promise<(() => void) | null> {
  try {
    const nav = navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }
    if (!nav.wakeLock) return null
    const wl = await nav.wakeLock.request('screen')
    return () => { void wl.release() }
  } catch { return null }
}
