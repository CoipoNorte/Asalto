# [ASALTO · Cronómetro HIIT / Tabata — Documentación técnica](https://coiponorte.github.io/Asalto/)

Cronómetro de intervalos con entrenador de voz. Aplicación de **una sola vista**
sin backend: el motor corre íntegramente en el navegador (reloj de alta
precisión, audio sintetizado con WebAudio, voz con Web Speech API, persistencia
local). La build es *single-file* y se despliega directo a GitHub Pages.

## Stack

| Capa | Tecnología |
|---|---|
| Framework | React 19 + TypeScript (strict) |
| Bundler | Vite 7 + `vite-plugin-singlefile` (JS/CSS inyectados en `dist/index.html`) |
| Estilos | Tailwind CSS 4 (tokens en `@theme`) |
| Animación | framer-motion (transición de vistas, flash de fase, dígitos popLayout) |
| Iconos | lucide-react |
| Audio | WebAudio API — síntesis procedural, sin archivos |
| Voz | Web Speech API (`speechSynthesis`) |
| Persistencia | `localStorage` (`asalto-config`) |
| Alias | `@/*` → `src/*` (vite + tsconfig) |

Notas de toolchain: `noUnusedLocals` / `noUnusedParameters` activos; target
ES2020 (evitar `String.replaceAll`).

## Estructura

```
├── index.html                 # lang es · favicon campana SVG inline
├── src/
│   ├── App.tsx                # render directo de la vista única
│   ├── main.tsx
│   ├── index.css              # tema: carbón + señal coral, faders, ecualizador, ON AIR
│   ├── lib/
│   │   └── gym.ts             # CONTRATO: Config/Fase + timeline + audio + voz + wake lock
│   ├── components/            # (vacío — la UI vive en views por simplicidad)
│   ├── utils/cn.ts            # clsx + tailwind-merge
│   └── views/
│       └── Timer.tsx          # editor de sesión + pantalla en curso + overlay fin
├── .gitignore                 # node_modules, dist, .env, cachés, SO, editores
└── README.md
```

## Contrato de datos (src/lib/gym.ts)

- **Config**: `{ preparacion: number; trabajo: number; descanso: number; asaltos: number }`
  (duraciones en **segundos**; `preparacion`/`descanso` admiten 0 = fase omitida).
- **Fase**: `{ tipo: 'prep' | 'work' | 'rest'; asalto: number; duracion: number }`.
- **Semántica de colores (esquinas de ring)**: `COLORES = { prep: #FFB224, work: #FF4B33, rest: #4FA3FF, fin: #E9C46A }`
  y `ETIQUETA` con los literales de UI.
- **Presets**: `PRESETS[]` — Tabata 20/10×8, HIIT 40/20×10, Boxeo 3:00/1:00×12,
  Sprints 30/90×6. Extensión: añadir objetos, el grid los renderiza solo.
- **Timeline**: `buildTimeline(config)` genera la secuencia plana
  `[prep?] + asaltos×(work + rest?)`; `totalFases()` suma; `locate(fases, t)`
  devuelve `{ indice, fase, restante, dentro }` o `null` pasado el final.
  `fmt(s)` → `m:ss` (o `h:mm:ss`).

## Motor del reloj (src/views/Timer.tsx)

- Precisión por **intervalos con acumulador**: `accRef` guarda el tiempo ya
  transcurrido; en cada tick `elapsed = acc + (performance.now() - t0) / 1000`.
  La pausa congela el acumulador sin matar el intervalo. No se usa
  `setTimeout` encadenado (deriva) ni `Date.now()` (salto de reloj del SO).
- **Refs espejo** (`statusRef`, `idxRef`, etc.) para que los callbacks
  asíncronos del motor (intervalo, `onend`, teclado) lean el estado actual
  sin re-suscribir listeners en cada render.
- **Cambio de fase detectado por clave** `tipo-asalto` (`keyRef`): dispara
  campana + consigna exactamente una vez por fase; flash de color via
  `<AnimatePresence key={faseKey}>`.
- Eventos temporales: pitido 3-2-1 (`secRef` evita repetición),
  aviso "Mitad" a la mitad de fases `work` ≥ 20 s (`mitadRef`).
- Fin de sesión: `silbato()` + consigna "¡Sesión completada!" + libera wake lock.
- `document.title` se actualiza con la cuenta atrás para seguirla desde otra app.

## Audio (WebAudio, síntesis procedural)

`AudioContext` perezoso (se crea/resume en el primer gesto del usuario —
política de autoplay). Estado global `audioMuted`.

| Función | Implementación |
|---|---|
| `pitido(freq, dur, vol)` | seno con ataque exponencial 8 ms + decaimiento |
| `campana()` | 3 parciales (622/933/1246 Hz, triángulo+senos), decaimientos 1,3/1,0/0,7 s |
| `silbato()` | 2 cuadradas desafinadas (2150/2218 Hz) + lowpass 3,6 kHz, envolvente 1 s |

Sustitución por samples reales: meter MP3 en `public/sfx/` y reemplazar las
tres funciones por `new Audio('./sfx/campana.mp3').play()` (rutas relativas
por el subdirectorio de gh-pages).

## Voz (Web Speech API)

`decir(texto, rate)`: selecciona voz `es-ES` > cualquier `es-*`, cancela la
utterance anterior (`speechSynthesis.cancel()`) para que nunca se encolen las
consignas, y respeta el toggle `vozOn` (estado global + `setVoz`).
`vozDisponible` comprueba `'speechSynthesis' in window` para ocultar el botón
cuando no hay soporte.

## Wake Lock y fullscreen

- `pedirWakeLock()` solicita `navigator.wakeLock.request('screen')` al empezar
  y devuelve el callback de liberación; se invoca al terminar/salir y en el
  `useEffect` de desmontaje. Fallback silencioso (`null`) si no hay API.
- Fullscreen: `document.documentElement.requestFullscreen()` con listener
  `fullscreenchange` para reflejar el icono.

## Persistencia

`cargarConfig()` / `guardarConfig()` escriben `localStorage['asalto-config']`
con `try/catch` (modo incógnito / storage deshabilitado). La UI persiste cada
cambio de parámetro (`upd()`).

## Atajos de teclado

`ESPACIO` → empezar/pausa · `ESC` → salir de la sesión. Listener global con
guardia para no interferir con inputs (`e.target.closest('textarea, input…')`).

## Sistema de diseño (index.css)

Tokens `@theme`: `ink #0C0A08 · coal #12100C · panel #171410 · raise #201B15 ·
edge #2A231B · edge2 #3A3125 · fog #A2937E · cream #F1EADF · signal #FF6A3D` +
fuentes Archivo / Inter / JetBrains Mono / Fraunces (serif del guion).
Utilidades custom: `.fader` (range estilizado, thumb coral con halo),
`.eq-bar` + `.eq-activo` (ecualizador pausado/activo), `.dot-live` (parpadeo
ON AIR), `.icon-btn`, `.bg-grain`, scrollbar themada, `no-scrollbar`.

## Build

`npm run build` → `dist/index.html` único (~397 KB, gzip ~126 KB), JS/CSS
inyectados; sin assets externos (favicon y todo el arte son SVG inline/código).
Sin SSR ni code-splitting por diseño. `homepage` + scripts `predeploy`/`deploy`
(`gh-pages -d dist`) ya declarados en `package.json`; `.gitignore` excluye
`dist/`, `node_modules/`, `.env*`, cachés de gh-pages, logs y ficheros de SO.

## Checklist técnico (extensión futura)

1. **Sonidos reales**: reemplazar síntesis por `public/sfx/*.mp3` (mismo contrato
   de funciones, sin tocar la UI).
2. **Voz configurable**: selector de voz `es-*` y velocidad de consigna.
3. **Presets propios**: guardar configs del usuario en `localStorage` junto a
   los cuatro built-in (clave `asalto-presets`).
4. **Modo espejo TV**: ruta adicional que renderice solo la pantalla en curso
   (`?mode=clock`) para un segundo dispositivo en el gimnasio.
5. **Historial**: registrar sesiones completadas (fecha, config, duración real)
   en `localStorage` o IndexedDB; exportar a JSON.
6. **PWA**: `vite-plugin-pwa` + `manifest` para instalar en el móvil con
   icono propio (ya hay favicon SVG base).
7. **Vibración**: `navigator.vibrate()` en cambios de fase para uso sin audio.
8. **Internacionalización**: extraer `ETIQUETA`/consignas a diccionarios si se
   añaden idiomas.
