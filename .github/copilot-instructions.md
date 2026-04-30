# Copilot Instructions — comic-helper

> **Keep this file up to date.** Whenever you make changes that affect the
> architecture, data model, build/test commands, dependencies, conventions, or
> major features described below, update this document in the same PR. Future
> agents rely on it as their primary orientation.

## What this project is

**Comic Helper** is a single-page, installable PWA for composing pixel-art
webtoon-style comics. Users create projects, define vertically stacked frames,
upload character/background images, position layers, add speech bubbles, and
export the result as a PNG. Everything is local-first — there is no backend.

## Tech stack

- **Svelte 5** (with `<script lang="ts">`, classic reactive `$:` syntax — not runes) + **TypeScript**
- **Vite 8** as the bundler/dev server
- **vite-plugin-pwa** for the installable PWA manifest + service worker (`autoUpdate`)
- **Konva 10** for canvas rendering, hit-testing, drag/resize
- **idb** (IndexedDB wrapper) for all persistence
- Bundled pixel font: `src/assets/fonts/PixelMplus10-Regular.ttf` (used for speech bubbles)
- Deployed to **GitHub Pages** via `.github/workflows/deploy.yml` on push to `main`
  (`base: './'` is set in `vite.config.ts` so it works under a subpath)

No test framework is configured. No linter beyond `svelte-check` + `tsc`.

## Commands

```bash
npm install            # install (CI uses --legacy-peer-deps)
npm run dev            # vite dev server with HMR
npm run build          # production build into dist/
npm run preview        # preview the production build
npm run check          # svelte-check + tsc -p tsconfig.node.json (type/lint pass)
```

Always run `npm run check` after non-trivial changes — it is the only
type/lint gate.

## Architecture

### Top-level layout

```
src/
  App.svelte            # Root: state owner + screen routing + drawer/tab UI
  main.ts               # Mounts App into #app
  app.css               # Global resets / base styles
  types.ts              # All shared TypeScript types (Project, Frame, Asset, …)
  db.ts                 # IndexedDB persistence layer (idb wrapper)
  assets/fonts/         # Bundled .ttf for canvas text
  lib/
    ProjectScreen.svelte    # Project list + "new project" form (shown when no project open)
    CanvasComposer.svelte   # The Konva stage — renders ALL frames stacked
    FrameInspector.svelte   # Drawer panel: edit selected frame's meta/bg/layers/bubbles
    AssetPanel.svelte       # Drawer panel: manage character + background assets
    ImagePicker.svelte      # Modal grid for choosing an image variant from an asset
    Counter.svelte          # (unused leftover from the Vite template — safe to remove)
public/                  # Static assets copied as-is (favicon, icons.svg)
```

### State & data flow

`App.svelte` is the **single source of truth** for all in-memory state:
`projects`, `currentProject`, `frames`, `assets`, `selectedFrameId`,
`bgAdjustFrameId`, and `activeDrawer`. Child components are dumb — they receive
data via props and dispatch typed `CustomEvent`s upward (`createEventDispatcher<{...}>`).
`App.svelte` mutates state and writes through to IndexedDB via `db.ts` helpers.

Reassign arrays/objects to trigger Svelte reactivity (e.g.
`frames = frames.map(...)` instead of mutating in place). This pattern is used
consistently throughout `App.svelte`.

UI shape: a top bar (project title, Add Frame, Export), the canvas area
(`CanvasComposer`), an optional bottom **drawer** showing exactly one of
`FrameInspector` or `AssetPanel`, and a bottom **tab bar** that toggles which
drawer is open. Only one drawer panel is ever visible at a time.

### Persistence (`src/db.ts`)

Database name: `comic-helper`, version `1`. Object stores:

| Store         | Key path | Value                                                  |
|---------------|----------|--------------------------------------------------------|
| `projects`    | `id`     | `Project`                                              |
| `frames`      | `id`     | `Frame`                                                |
| `assets`      | `id`     | `Asset` **without** its `images` (metadata only)       |
| `assetImages` | `id`     | `{ id, assetId, name, blob }` — image blobs split out  |

Asset images are stored separately so that loading an asset list doesn't pull
every blob into memory at once. `getAssets(ids)` re-joins them. `deleteProject`
cascades to its frames and assets in a single transaction; `deleteAsset`
cascades to that asset's images.

If you change any persisted shape in `types.ts`, **bump the IDB version in
`db.ts` and add an `upgrade` migration** — there is no migration framework.

### Canvas rendering (`CanvasComposer.svelte`)

This is the largest and most complex file (~1000 lines). Key facts:

- One Konva `Stage` + `Layer` renders **all frames stacked vertically** with a
  small gutter (`frameGap`). Frames are not separate stages.
- Coordinates are **canvas pixels** (low-res). `displayScale` (default 3)
  multiplies to screen pixels; `zoom` is an additional user-controlled
  multiplier on top.
- Input handling: mouse wheel = scroll, `Ctrl+wheel` = zoom centered on
  cursor, two-finger pinch on touch = zoom + pan, middle-mouse drag = pan,
  click frame body = select, drag bottom edge = resize frame height,
  click character = open `ImagePicker`, drag character = move within frame.
- A frame can be put into **background-adjust mode** (`bgAdjustFrameId`); in
  that mode, dragging pans the background image inside its mask rect.
- Maintains `urlCache` / `imageCache` keyed by image id to avoid leaking
  `URL.createObjectURL` results — clean these up if you add new image flows.
- `exportPng(scale?)` is the public method called by `App.exportComic()`; it
  re-renders the stacked frames at native (1x) resolution into a data URL,
  optionally upscaled by an integer `scale` (UI exposes 1x / 4x / 8x) using
  nearest-neighbor sampling via Konva's `pixelRatio`. UI overlay nodes
  (selection outline, frame resize handle, background mask + handles, speech
  bubble tail handles) are tagged with the `UI_NODE_NAME` Konva name and
  hidden during export so they don't appear in the PNG.
- The bundled pixel font is loaded via the `BUBBLE_FONT` constant; rely on it
  rather than hardcoding font names elsewhere.

### Major features (current)

- **Projects**: create / open / delete; each has a fixed `canvasWidth` and a
  default `bgColor` for new frames.
- **Frames**: add / delete / reorder up & down / resize height / recolor;
  each frame stores its own `width`, `height`, `bgColor`, optional
  `background`, ordered `layers`, and optional `bubbles`.
- **Assets**: two types — `character` and `background`. Each asset holds
  multiple image variants (`AssetImage[]`). Backgrounds are assigned to a
  frame as a `FrameBackground` with pan offset + clipping `mask`. Characters
  are placed as `FrameLayer`s with `x/y` and optional `flippedX`.
- **Speech bubbles**: per-frame `SpeechBubble[]` rendered on top of layers,
  using the bundled pixel font, with a draggable tail tip.
- **Export**: stacked PNG of all frames at native (1x) resolution; optional
  4x / 8x nearest-neighbor upscale chosen from a select next to the Export
  button. UI overlay elements (handles, selection outline) are excluded.
- **PWA**: installable, offline-capable via `vite-plugin-pwa` autoUpdate.

## Conventions

- **TypeScript everywhere.** Add new shared types to `src/types.ts`.
- **Svelte 5 with classic syntax** (`export let`, `$:`, `createEventDispatcher`).
  Don't introduce runes (`$state`, `$props`, etc.) unless migrating the whole
  app — the codebase is consistent and mixing styles will confuse Svelte 5.
- **Child → parent communication** is via dispatched events with typed
  payloads. Do not mutate props directly.
- **Reassign for reactivity** (`x = [...x, y]`, `x = x.map(...)`), don't
  mutate in place.
- **All persistence goes through `src/db.ts`.** Don't call `openDB` or touch
  IndexedDB from components.
- **IDs are `crypto.randomUUID()`.**
- **Dark theme** with the palette defined in `App.svelte`'s `<style>` block
  (backgrounds in the `#12121f`–`#1e1e32` range, accent `#7070cc`/`#a0a0ff`,
  success-green for the Export button). Match this palette for any new UI.
- **Mobile-friendly**: the drawer/tab-bar layout and `env(safe-area-inset-bottom)`
  padding are intentional — preserve touch ergonomics.
- **No backend, no telemetry, no network calls.** Keep it local-first.
- **Konva is the only canvas library.** Don't add a second renderer.

## When adding a feature, consider

1. Does it need a new field on `Project` / `Frame` / `Asset`? → update
   `types.ts` and **bump the IDB version + add a migration** in `db.ts`.
2. Does the state live in `App.svelte`? Add the state + handler there and
   pass it down; keep child components dumb.
3. If it renders on the canvas, it goes in `CanvasComposer.svelte`; if it's a
   form/control for the selected frame, it goes in `FrameInspector.svelte`;
   if it's about the asset library, it goes in `AssetPanel.svelte`.
4. Run `npm run check` and `npm run build` before finishing.
5. **Update this file** if you changed architecture, the data model, the
   command list, dependencies, or any major feature surface.
