/* ============================================================================
 * Timer.tsx — ASALTO · cronómetro HIIT/Tabata con entrenador de voz (vista única)
 * ----------------------------------------------------------------------------
 * Motor: reloj de alta precisión por intervalos + línea de tiempo residente
 * en src/lib/gym.ts. Consignas habladas (Web Speech API) y sonidos sintetizados
 * (WebAudio): campana de asalto, pitidos 3-2-1 y silbato final.
 * Extra pro: Wake Lock (la pantalla no se apaga), fullscreen y título de
 * pestaña con la cuenta atrás para seguirla desde otra app.
 * ==========================================================================*/
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Dumbbell, Play, Pause, RotateCcw, SkipForward, X, Bell, BellOff, Speech,
  Maximize, Minimize, Flame, Wind, Hourglass, Trophy, Minus, Plus,
} from 'lucide-react'
import {
  buildTimeline, totalFases, locate, fmt, PRESETS, COLORES, ETIQUETA,
  pedirWakeLock, cargarConfig, guardarConfig, pitido, campana, silbato,
  decir, setMutedAudio, setVoz, vozDisponible,
} from '@/lib/gym'
import type { Config, Fase } from '@/lib/gym'
import { cn } from '@/utils/cn'

const clampN = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

/* ------------------------- repetición al mantener ------------------------- */
function useHold(fn: () => void) {
  const t = useRef<number>(0)
  const stop = () => { window.clearInterval(t.current); t.current = 0 }
  const start = () => { fn(); stop(); t.current = window.setInterval(fn, 120) }
  useEffect(() => stop, [])
  return { onPointerDown: start, onPointerUp: stop, onPointerLeave: stop }
}

/* ------------------------------- stepper ---------------------------------- */
function Stepper({ etiqueta, valor, lectura, min, max, delta, onChange }: {
  etiqueta: string; valor: number; lectura: string; min: number; max: number; delta: number; onChange: (v: number) => void
}) {
  const menos = useHold(() => onChange(clampN(valor - delta, min, max)))
  const mas = useHold(() => onChange(clampN(valor + delta, min, max)))
  const btn = 'grid size-9 cursor-pointer place-items-center rounded-lg border border-edge text-fog transition-colors hover:border-edge2 hover:text-cream active:scale-90'
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-fog">{etiqueta}</span>
      <div className="flex items-center gap-2">
        <button className={btn} {...menos} aria-label={`Menos ${etiqueta}`}><Minus className="size-4" /></button>
        <span className="w-20 text-center font-mono text-xl font-semibold tabular-nums text-cream">{lectura}</span>
        <button className={btn} {...mas} aria-label={`Más ${etiqueta}`}><Plus className="size-4" /></button>
      </div>
    </div>
  )
}

/* ------------------------------ timeline ---------------------------------- */
function Timeline({ fases, progreso }: { fases: Fase[]; progreso: number | null }) {
  const total = totalFases(fases)
  if (!total) return null
  return (
    <div className="relative h-7 overflow-hidden rounded-full border border-edge bg-coal">
      <div className="flex h-full">
        {fases.map((f, i) => (
          <div
            key={i}
            style={{ width: `${(f.duracion / total) * 100}%`, background: COLORES[f.tipo], opacity: progreso === null ? 0.35 : undefined }}
            className={cn('h-full border-r border-ink/40 last:border-r-0 transition-opacity', progreso !== null && 'opacity-25')}
          />
        ))}
      </div>
      {progreso !== null && (
        <>
          <div className="absolute inset-y-0 left-0 bg-cream/10" style={{ width: `${progreso * 100}%` }} />
          <div className="absolute inset-y-0 w-[3px] rounded bg-cream shadow-[0_0_12px_rgba(241,234,223,0.8)]" style={{ left: `${progreso * 100}%` }} />
        </>
      )}
    </div>
  )
}

/* ================================= VISTA =================================== */
export default function Timer() {
  const [config, setConfig] = useState<Config>(() => cargarConfig())
  const fases = useMemo(() => buildTimeline(config), [config])
  const total = useMemo(() => totalFases(fases), [fases])

  const [enMarcha, setEnMarcha] = useState(false)
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const [campanaOn, setCampanaOn] = useState(true)
  const [vozOn, setVozOn] = useState(vozDisponible)
  const [fs, setFs] = useState(false)

  /* refs del reloj */
  const t0Ref = useRef(0)
  const accRef = useRef(0)
  const keyRef = useRef('')
  const secRef = useRef(-1)
  const mitadRef = useRef(false)
  const wakeRef = useRef<(() => void) | null>(null)
  const fasesRef = useRef(fases); fasesRef.current = fases
  const totalRef = useRef(total); totalRef.current = total

  const upd = (patch: Partial<Config>) => setConfig((c) => {
    const n = { ...c, ...patch }
    guardarConfig(n)
    return n
  })

  /* ---------------------------- motor del reloj --------------------------- */
  useEffect(() => {
    if (!running) return
    t0Ref.current = performance.now()
    const id = setInterval(() => {
      const el = accRef.current + (performance.now() - t0Ref.current) / 1000
      setElapsed(el)
      if (el >= totalRef.current) {
        accRef.current = totalRef.current
        setElapsed(totalRef.current)
        setRunning(false)
        setFinished(true)
        silbato()
        decir('¡Sesión completada! Buen trabajo.', 0.98)
        wakeRef.current?.()
        wakeRef.current = null
        return
      }
      const cur = locate(fasesRef.current, el)
      if (!cur) return
      const key = `${cur.fase.tipo}-${cur.fase.asalto}`
      if (keyRef.current !== key) {
        keyRef.current = key
        mitadRef.current = false
        if (cur.fase.tipo === 'prep') decir('Preparación')
        else if (cur.fase.tipo === 'work') { campana(); decir(cur.fase.asalto === 1 ? '¡A trabajar!' : `¡Asalto ${cur.fase.asalto}!`, 1.08) }
        else { pitido(520, 0.18, 0.13); decir('Descanso') }
      }
      if (cur.fase.tipo === 'work' && !mitadRef.current && cur.fase.duracion >= 20 && cur.dentro >= cur.fase.duracion / 2) {
        mitadRef.current = true
        decir('Mitad')
      }
      const rest = Math.ceil(cur.restante)
      if (rest !== secRef.current) {
        secRef.current = rest
        if (rest > 0 && rest <= 3) pitido(880, 0.1, 0.13)
      }
    }, 100)
    return () => clearInterval(id)
  }, [running])

  /* ------------------------------ acciones -------------------------------- */
  const empezar = async () => {
    if (!fases.length) return
    keyRef.current = ''
    secRef.current = -1
    accRef.current = 0
    setElapsed(0)
    setFinished(false)
    setEnMarcha(true)
    wakeRef.current = await pedirWakeLock()
    setRunning(true)
  }

  const togglePausa = () => {
    if (running) {
      accRef.current += (performance.now() - t0Ref.current) / 1000
      setRunning(false)
    } else {
      t0Ref.current = performance.now()
      setRunning(true)
    }
  }

  const reiniciar = () => {
    accRef.current = 0
    secRef.current = -1
    keyRef.current = ''
    setElapsed(0)
    t0Ref.current = performance.now()
    if (!running) setRunning(true)
  }

  const saltarFase = () => {
    const el = accRef.current + (running ? (performance.now() - t0Ref.current) / 1000 : 0)
    const cur = locate(fases, el)
    if (!cur || cur.indice >= fases.length - 1) return
    const objetivo = fases.slice(0, cur.indice + 1).reduce((a, p) => a + p.duracion, 0) + 0.03
    accRef.current = objetivo
    if (running) t0Ref.current = performance.now()
    setElapsed(objetivo)
    keyRef.current = ''
  }

  const salir = () => {
    setRunning(false)
    setEnMarcha(false)
    setFinished(false)
    accRef.current = 0
    setElapsed(0)
    wakeRef.current?.()
    wakeRef.current = null
    if (vozDisponible) window.speechSynthesis.cancel()
  }

  /* ------------------------- toggles y fullscreen ------------------------- */
  useEffect(() => {
    const h = () => setFs(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', h)
    return () => document.removeEventListener('fullscreenchange', h)
  }, [])

  const toggleFs = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen().catch(() => undefined)
  }

  useEffect(() => () => { wakeRef.current?.() }, [])

  /* ------------------------------ teclado --------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        if (!enMarcha || finished) void empezar()
        else togglePausa()
      }
      if (e.code === 'Escape' && enMarcha) salir()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ------------------------- título de la pestaña ------------------------- */
  useEffect(() => {
    if (!enMarcha) { document.title = 'ASALTO · Cronómetro HIIT y Tabata'; return }
    const cur = locate(fases, elapsed)
    document.title = finished
      ? 'ASALTO · ¡Sesión completada!'
      : cur ? `${fmt(Math.ceil(cur.restante))} ${ETIQUETA[cur.fase.tipo]} · ASALTO` : 'ASALTO'
  }, [elapsed, enMarcha, finished, fases])

  /* ------------------------------ derivados ------------------------------- */
  const cur = enMarcha ? locate(fases, elapsed) : null
  const color = finished ? COLORES.fin : cur ? COLORES[cur.fase.tipo] : COLORES.prep
  const faseKey = cur ? `${cur.fase.tipo}-${cur.fase.asalto}` : 'fin'
  const restanteInt = cur ? Math.ceil(cur.restante) : 0
  const progFase = cur ? cur.dentro / cur.fase.duracion : 1
  const IconoFase = cur?.fase.tipo === 'work' ? Flame : cur?.fase.tipo === 'rest' ? Wind : Hourglass
  let asaltosHechos = 0
  {
    let acc = 0
    for (const f of fases) {
      acc += f.duracion
      if (f.tipo === 'work' && elapsed >= acc - 0.001 && enMarcha) asaltosHechos++
    }
  }
  if (finished) asaltosHechos = config.asaltos

  /* ================================== UI =================================== */
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-ink text-cream">
      <div className="pointer-events-none fixed inset-0 z-[60] bg-grain" />
      {/* tinte de fase */}
      <div
        className="pointer-events-none absolute inset-0 transition-colors duration-700"
        style={{ background: `radial-gradient(75% 60% at 50% 42%, ${color}14 0%, #0C0A08 62%)` }}
      />
      {/* flash al cambiar de fase */}
      <AnimatePresence>
        {enMarcha && !finished && (
          <motion.div
            key={faseKey}
            className="pointer-events-none absolute inset-0"
            style={{ background: color }}
            initial={{ opacity: 0.16 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>

      {/* ================================ HEADER ============================ */}
      <header className="relative z-30 flex items-center justify-between px-4 py-4 md:px-8">
        <div className="flex items-center gap-3">
          <Dumbbell className="size-5" style={{ color }} />
          <h1 className="font-display text-lg font-black uppercase tracking-[0.2em]">Asalto</h1>
          <span className="hidden h-px w-8 bg-edge2 sm:block" />
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.28em] text-fog sm:block">cronómetro de intervalos</span>
        </div>
        <div className="flex items-center gap-2">
          <button className="icon-btn" aria-label="Sonido" onClick={() => { setMutedAudio(campanaOn); setCampanaOn(!campanaOn) }}>
            {campanaOn ? <Bell className="size-4" /> : <BellOff className="size-4" />}
          </button>
          {vozDisponible && (
            <button className="icon-btn" aria-label="Voz" onClick={() => { setVoz(!vozOn); setVozOn(!vozOn) }}>
              <Speech className={cn('size-4', !vozOn && 'opacity-40')} />
            </button>
          )}
          <button className="icon-btn" aria-label="Pantalla completa" onClick={toggleFs}>
            {fs ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
          </button>
          {enMarcha && (
            <button className="icon-btn" aria-label="Salir de la sesión" onClick={salir}>
              <X className="size-4" />
            </button>
          )}
        </div>
      </header>

      {/* ============================ CONFIGURACIÓN ========================== */}
      {!enMarcha && (
        <main className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 pb-16 pt-4">
          <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
            <p className="text-center font-mono text-[10px] uppercase tracking-[0.4em] text-fog">hiit · tabata · boxeo</p>
            <h2 className="mt-2 text-center font-display text-6xl font-black uppercase tracking-tight">
              Al <span className="text-signal">ring</span>
            </h2>

            {/* presets */}
            <div className="mt-7 grid grid-cols-2 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => upd(p.config)}
                  className="cursor-pointer rounded-xl border border-edge bg-panel px-3.5 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-edge2"
                >
                  <p className="text-[13px] font-semibold">{p.nombre}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-fog">{p.detalle}</p>
                </button>
              ))}
            </div>

            {/* parámetros */}
            <div className="mt-4 divide-y divide-edge rounded-2xl border border-edge bg-panel px-4 py-1">
              <Stepper etiqueta="Preparación" valor={config.preparacion} lectura={fmt(config.preparacion)} min={0} max={900} delta={5} onChange={(v) => upd({ preparacion: v })} />
              <Stepper etiqueta="Trabajo" valor={config.trabajo} lectura={fmt(config.trabajo)} min={5} max={900} delta={5} onChange={(v) => upd({ trabajo: v })} />
              <Stepper etiqueta="Descanso" valor={config.descanso} lectura={fmt(config.descanso)} min={0} max={600} delta={5} onChange={(v) => upd({ descanso: v })} />
              <Stepper etiqueta="Asaltos" valor={config.asaltos} lectura={`${config.asaltos}`} min={1} max={60} delta={1} onChange={(v) => upd({ asaltos: v })} />
            </div>

            <div className="mt-4 flex items-center justify-between rounded-xl border border-dashed border-edge px-4 py-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-fog">Sesión total</span>
              <span className="font-mono text-xl font-semibold text-cream">{fmt(total)}</span>
            </div>

            <div className="mt-3"><Timeline fases={fases} progreso={null} /></div>

            <button
              onClick={() => void empezar()}
              className="mt-6 flex w-full cursor-pointer items-center justify-center gap-3 rounded-2xl bg-signal py-4 font-mono text-[13px] font-bold uppercase tracking-[0.3em] text-ink shadow-[0_0_40px_rgba(255,74,51,0.35)] transition-all hover:brightness-110 active:scale-[0.98]"
            >
              <Play className="size-5" /> Empezar · espacio
            </button>
            <p className="mt-4 text-center font-mono text-[9px] uppercase tracking-[0.24em] text-fog/60">
              voz en español · campana por asalto · la pantalla no se apaga
            </p>
          </motion.div>
        </main>
      )}

      {/* ============================== EN CURSO ============================= */}
      {enMarcha && (
        <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 pb-10">
          {/* etiqueta de fase */}
          <motion.div
            key={`label-${faseKey}`}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 flex items-center gap-3"
          >
            <IconoFase className="size-5" style={{ color }} />
            <span className="font-display text-2xl font-black uppercase tracking-[0.14em] md:text-4xl" style={{ color }}>
              {finished ? 'Completado' : cur ? ETIQUETA[cur.fase.tipo] : ''}
            </span>
          </motion.div>

          {/* anillo + dígitos */}
          {(() => {
            const S = 480, R = S / 2 - 14, CIRC = 2 * Math.PI * R
            return (
              <div className="relative" style={{ width: 'min(78vw, 460px)', aspectRatio: 1 }}>
                <svg viewBox={`0 0 ${S} ${S}`} className="size-full -rotate-90">
                  <circle cx={S / 2} cy={S / 2} r={R} fill="none" stroke="var(--color-edge)" strokeWidth={7} />
                  <circle
                    cx={S / 2} cy={S / 2} r={R} fill="none"
                    stroke={color} strokeWidth={10} strokeLinecap="round"
                    strokeDasharray={CIRC}
                    strokeDashoffset={CIRC * (1 - (finished ? 1 : progFase))}
                    style={{ transition: 'stroke-dashoffset 0.25s linear, stroke 0.7s ease', filter: `drop-shadow(0 0 14px ${color}66)` }}
                  />
                </svg>
                <div className="absolute inset-0 grid place-items-center">
                  <div className="text-center">
                    <AnimatePresence mode="popLayout">
                      <motion.p
                        key={`${faseKey}-${restanteInt}`}
                        initial={{ opacity: 0, scale: 1.06 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.12 }}
                        className="font-mono text-[clamp(4rem,17vw,8.5rem)] font-bold leading-none tabular-nums"
                        style={{ textShadow: `0 0 46px ${color}55` }}
                      >
                        {finished ? 'FIN' : fmt(restanteInt)}
                      </motion.p>
                    </AnimatePresence>
                    <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.34em] text-fog">
                      {finished ? `${asaltosHechos} asaltos · ${fmt(total)}` : cur && cur.fase.tipo !== 'prep'
                        ? <>asalto <span className="text-cream">{cur?.fase.asalto}</span>/{config.asaltos}</>
                        : 'a punto…'}
                    </p>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* puntos de asalto */}
          {config.asaltos <= 24 && !finished && (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {[...Array(config.asaltos)].map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'size-2.5 rounded-full transition-all duration-300',
                    i < asaltosHechos ? 'bg-cream' : i === asaltosHechos && cur?.fase.tipo === 'work' ? 'scale-125 bg-signal shadow-[0_0_10px_rgba(255,74,51,0.8)]' : 'bg-edge2',
                  )}
                />
              ))}
            </div>
          )}

          {/* timeline de sesión */}
          <div className="mt-6 w-full max-w-2xl">
            <Timeline fases={fases} progreso={Math.min(1, elapsed / total)} />
            <div className="mt-2 flex justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-fog">
              <span>{fmt(elapsed)}</span>
              <span>{fmt(total)}</span>
            </div>
          </div>

          {/* controles */}
          <div className="mt-7 flex items-center gap-3">
            <button className="icon-btn !size-11" onClick={saltarFase} disabled={finished} aria-label="Saltar fase">
              <SkipForward className="size-5" />
            </button>
            <button
              onClick={togglePausa}
              disabled={finished}
              aria-label={running ? 'Pausar' : 'Continuar'}
              className="grid cursor-pointer place-items-center rounded-full bg-cream text-ink shadow-[0_0_36px_rgba(241,234,223,0.25)] transition-all hover:brightness-110 active:scale-95 disabled:opacity-30"
              style={{ width: 72, height: 72 }}
            >
              {running ? <Pause className="size-8" /> : <Play className="size-8 translate-x-0.5" />}
            </button>
            <button className="icon-btn !size-11" onClick={reiniciar} disabled={finished} aria-label="Reiniciar">
              <RotateCcw className="size-5" />
            </button>
          </div>

          {/* overlay de fin */}
          <AnimatePresence>
            {finished && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-40 grid place-items-center bg-ink/80 p-4 backdrop-blur-sm"
              >
                <motion.div
                  initial={{ scale: 0.9, y: 20 }}
                  animate={{ scale: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                  className="w-full max-w-sm rounded-2xl border border-edge bg-panel p-8 text-center shadow-2xl"
                >
                  <Trophy className="mx-auto size-10" style={{ color: COLORES.fin }} />
                  <h3 className="mt-4 font-display text-3xl font-black uppercase tracking-tight">Sesión completada</h3>
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-edge p-3">
                      <p className="font-mono text-2xl font-semibold">{config.asaltos}</p>
                      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-fog">asaltos</p>
                    </div>
                    <div className="rounded-xl border border-edge p-3">
                      <p className="font-mono text-2xl font-semibold">{fmt(config.asaltos * config.trabajo)}</p>
                      <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.2em] text-fog">trabajo efectivo</p>
                    </div>
                  </div>
                  <div className="mt-6 flex gap-2">
                    <button onClick={() => void empezar()} className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl bg-signal py-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink transition-all hover:brightness-110">
                      <Play className="size-4" /> Repetir
                    </button>
                    <button onClick={salir} className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border border-edge py-3 font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-fog transition-colors hover:border-edge2 hover:text-cream">
                      <RotateCcw className="size-4" /> Configurar
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      )}
    </div>
  )
}
