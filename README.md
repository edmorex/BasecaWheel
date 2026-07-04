# BasecaWheel

A browser-based **spinning wheel of chance** — but a mischievous one. Add
entrants, give them weights, and spin. The wheel doesn't just pick a winner: it
can slow down, reverse, boost, shuffle entrants mid-spin, or occasionally
explode and declare that *nobody* wins. It's a single, self-contained web app
with no build step and no runtime dependencies — and it can optionally hook up
to a Twitch bot so chat drives the wheel.

![BasecaWheel](images/bascaSharon.png)

---

## Features

### Wheels (slots)
- Maintain **multiple independent wheels**, each with its own entrants,
  settings, title, and winner history.
- Reorder wheels by **drag-and-drop** (with auto-scroll when the list is long).
- **Clone** a wheel, **clear** all wheels, or **+ Add Wheel** — new and cloned
  wheels appear at the top of the list.
- **Save** all wheels to a timestamped JSON file and **Load** them back —
  a full backup/restore of everything.
- A resizable **divider** between the Wheels and Entrants lists lets you give
  each list more or less room (each keeps at least ~1.5 rows visible); the
  split is remembered across reloads.
- Click a wheel's name to **select** it; a per-row **gear** opens that wheel's
  settings (even for a non-active wheel).

### Entrants
- Add entrants by typing in the pinned input and pressing **Enter** — new
  entrants land at the top of the list.
- Optional **weighting**: type `Name, 5` to give an entrant weight 5. Heavier
  entrants occupy a proportionally larger slice.
- **Drag-to-reorder** entrants with grab handles (like the wheel list), inline
  underline-style name editing, per-entrant **+/− weight** controls, and bulk
  actions: shuffle order, ±1 to all, set all to 1, and clear the list.
- A running **Total Entrants / Total Weight** line sits at the bottom of the
  list and scrolls with it.

### Spin mechanics & "mischief"
During a spin, random events can fire based on per-wheel probabilities:

| Event | What it does |
|-------|--------------|
| ⏱️ Spin Time | Scales how long spins take |
| 💥 Explode | Wheel "breaks" — nobody wins, with a screen-shaking debris blast |
| 🔄 Reverse Spin | Wheel reverses direction mid-spin |
| 🐢 Slowdown | Wheel briefly drags |
| 🐇 Boost | Wheel speeds back up |
| 🔀 Late Shuffle | Entrants get swapped near the end |

The center reacts with an animated emoji/image that changes per state
(excited, nervous, shocked, relieved, …), a flame effect that flickers faster
the quicker the wheel spins, a clicking pointer, and a confetti-filled heart
when a winner lands.

### Settings: two menus
Settings are split by scope:

- **Mischief Settings** (per-wheel) — opened from each wheel row's gear. Holds
  everything that affects that wheel: Chances, Features, BasecaBot connection
  mode, and Wheel Sounds / Images. It edits the chosen wheel directly, so you
  can configure a wheel without making it active.
- **Global Settings** (bottom-left gear) — app-wide options: **Reduced
  Effects**, the **BasecaBot** connection, and **Edit Raw Data**.

#### Per-wheel feature toggles
- **Keep Winners Log** — persist a dated winner history (`YYYY-MM-DD`) with the
  wheel; off by default (session-only).
- **Hide Percentages** — show only names on the slices.
- **Idle Ticks** — play the pointer tick during the slow idle rotation.
- **Auto Increment Losers** — every non-winner gains +1 weight after a spin.
- **Auto Remove Winner** / **Auto Decrement Winner** / **Set Winner to 1** —
  mutually-exclusive post-spin actions on the winner.
- **BasecaBot: Auto Connect / Auto Disconnect** — when this wheel becomes
  active, automatically connect (if a bot URL + secret are saved) or drop the
  bot connection.

### Sounds & images
- Eight built-in sound effects (background loop, tick, boost, explode, fanfare,
  reverse, shuffle, slowdown). Each is overridable per-wheel with a custom
  relative path or external URL (cross-origin URLs fall back to an
  `<audio>` element automatically).
- The wheel's center artwork is fully customizable per emotional state. Pick
  from a built-in **image gallery** (browses everything in `images/`) or paste
  your own paths/URLs. Multiple images per state are chosen at random.

### BasecaBot integration (optional)
BasecaWheel can connect to a **BasecaBot** WebSocket hub so Twitch chat drives
the active wheel. Configured entirely in **Global Settings**:

- **Connection** — a Hub URL plus a masked **Secret** (never shown, even while
  typing); the app combines them into the room URL. Connect/Disconnect buttons,
  plus a **quick connect** button with live status in the sidebar footer.
- **Commands** received from the bot: `title`, `add`, `spin`, `clear` (remove
  the sender's own entries), and `reset` (wipe the wheel). Each has a
  configurable **minimum permission level** (Viewer → Admin); `clear` shares
  `add`'s level and `reset` shares `title`'s.
- **Entry config** — max entries per user, **Reject after limit** vs **Replace
  oldest**, and an optional **append username** to each entry.
- **Chat messages back** — toggles to announce the winner, announce when an
  entry is replaced, and announce when a command is rejected (limit /
  permission / wheel-is-spinning).

Commands are ignored while a spin is in progress (title/add/clear/reset), and a
`spin` command cleans up any winner/"nobody" state first. The full wire
protocol is documented in the **BasecaBot** repo
(`basecawheel-integration.md`).

### History, mute, raw data
- A **winner history** panel lists results for the active wheel.
- A **mute** toggle for all audio.
- An **Edit Raw Data** view exposes the full JSON state for direct editing.

### Quality-of-life
- Smooth sidebar collapse/expand with the wheel, center image, pointer, and
  title all tracking the animation in lockstep.
- **Lucide SVG icons** (recolored white) throughout the UI, so it looks
  identical on every platform, plus consistent thin scrollbars across browsers.
- Modals dismiss only when the click **starts** on the backdrop — dragging to
  select text inside a field and releasing outside won't close them.
- **Reduced Effects** — a global toggle that strips the GPU-expensive effects
  (backdrop blur, flame blur/blend, drop-shadows, glow animations) for low-end
  machines (notably Firefox on Windows) while keeping the layout and the spin.
- **Idle sleep**: after 5 minutes of no interaction, all animations pause to
  save battery/CPU, resuming instantly on any input.

---

## Running it

The app is plain static files. The included Python server sets no-cache headers
(handy during development) and regenerates the image gallery manifest on
startup:

```bash
python3 serve.py
```

This serves at `http://localhost:8081/BasecaWheel.html` and opens it in your
browser. Any static file server works too — or just open `BasecaWheel.html`
directly (`file://`), though the image gallery needs `images/manifest.json`
present (which `serve.py` regenerates automatically; drop new images into
`images/` and restart).

> The bot hub is a **separate** server; its URL/port is configured in Global
> Settings and is unrelated to the `8081` the app is served on.

No installation, no build, no `node_modules`.

---

## Infrastructure

### Single-page, no build system
Everything is hand-written HTML/CSS/JS. There is no bundler, transpiler, or
package manager. The code is split across several plain `<script>` files that
share a global scope (no ES modules), loaded in a **strict order** because later
files depend on globals and functions declared earlier:

```
constants.js → state.js → storage.js → emoji.js → audio.js
            → wheel.js → spin.js → ui.js → ws.js → boot.js
```

Each file begins with a header comment documenting what it reads, mutates, and
calls, plus any cross-file pitfalls.

| File | Responsibility |
|------|----------------|
| `constants.js` | Read-only constants: storage keys, defaults, colors, labels, sound/image maps |
| `state.js` | DOM element references and all shared mutable state |
| `storage.js` | localStorage read/write helpers + `activateSlot()` |
| `emoji.js` | Center image / emoji state system |
| `audio.js` | Web Audio playback, preloading, cross-origin fallback |
| `wheel.js` | Canvas drawing + offscreen face cache, wheel math, layout, idle rotation, flame speed |
| `spin.js` | Spin loop, mischief events, confetti, explosion, nobody-wins |
| `ui.js` | Sidebar/list rendering, both settings menus, modals, controls, drag, history |
| `ws.js` | BasecaBot WebSocket client: connection, command handling, config UI |
| `boot.js` | Startup: load slots, size the canvas, pre-cache images, observers |

### Persistence
State lives in **localStorage** (no backend):

- `basca_active_slot` — id of the currently selected wheel
- `basca_wheel_list` — ordered list of `{ id, title }`
- `basca_slot_<id>` — per-wheel data (title, entrants, settings, history)
- `basca_divider_h` — saved Wheels/Entrants divider height
- `basca_reduced_effects` — global Reduced Effects flag
- `basca_ws_config` — global BasecaBot settings (URL, secret, permissions,
  limits, message toggles)

All writes go through a `safeSetItem()` wrapper so a quota error (e.g. Safari
Private Browsing) degrades gracefully instead of throwing.

### Rendering & performance
- The wheel is drawn on a `<canvas>`. Because the face (slices + labels) only
  changes when entrants/weights/labels do — not while it spins — it's rendered
  **once into an offscreen canvas** and each animation frame just rotates and
  blits that bitmap, so full-speed spins stay smooth even with many entrants.
- The center image, pointer, title, and winner/"nobody" popup are HTML/CSS
  layered over the canvas, kept in sync via JS measurement.
- Animations use `requestAnimationFrame` (idle rotation, spin physics, flame
  speed) and CSS keyframes (flames, emoji reactions, glow, confetti).
- Cross-browser handling includes `-webkit-backdrop-filter` for Safari, a
  first-load relayout pass to avoid a Chrome layout-timing race, and the
  Reduced Effects escape hatch for weak GPUs.

### Audio
Web Audio API with buffers decoded up-front and the context resumed on the
first user gesture (to satisfy autoplay policies). Cross-origin sound URLs that
can't be fetched fall back to an `<HTMLAudioElement>`.

### Bot integration
`ws.js` is a self-contained WebSocket client. It joins the bot's `baseca-wheel`
room, translates inbound `wheel` commands into wheel actions (respecting the
per-command permission levels and entry limits), and can send `announce` /
`result` messages back to chat. Connection settings are global; the per-wheel
**Auto Connect / Auto Disconnect** policy is applied on `activateSlot()`.

### Assets
- `images/` — center artwork (`*.png`) plus a generated `manifest.json` the
  gallery reads.
- `sounds/` — the eight default `*.wav` effects.
- `icons/` — Lucide SVG icons (recolored white) used throughout the UI.

---

## Project layout

```
BasecaWheel.html      markup + <link>/<script> tags only
serve.py              dev server (no-cache headers, manifest regeneration)
css/
  basca.css           all styles
js/
  constants.js  state.js  storage.js  emoji.js  audio.js
  wheel.js  spin.js  ui.js  ws.js  boot.js
icons/                Lucide SVG icons
images/               center artwork + manifest.json
sounds/               default sound effects
```
