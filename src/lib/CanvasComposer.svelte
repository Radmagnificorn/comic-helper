<!--
  CanvasComposer.svelte – Stacked multi-frame composer.

  Renders ALL frames in a single Konva stage, vertically stacked with a small
  gutter between them. Supports:
    - mouse wheel = scroll, ctrl+wheel = zoom (centered on cursor)
    - two-finger pinch on touch = zoom + pan together
    - middle-mouse drag = pan
    - click on a frame body = select that frame
    - drag the bottom edge of a frame = resize its height (frames below shift)
    - click on a character = open image picker
    - drag a character = move it within its frame
-->
<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher, tick } from 'svelte';
  import Konva from 'konva';
  import type { Frame, Asset, FrameLayer, FrameBackground } from '../types';
  import ImagePicker from './ImagePicker.svelte';

  export let frames: Frame[] = [];
  export let assets: Asset[] = [];
  export let selectedFrameId: string | null = null;
  /** id of the frame whose background is currently being adjusted (drag/scale), or null */
  export let bgAdjustFrameId: string | null = null;
  /** How many screen pixels per canvas pixel before zoom */
  export let displayScale: number = 3;
  /** Vertical gap (in canvas px) between frames */
  export const frameGap: number = 6;

  const dispatch = createEventDispatcher<{
    change: { frame: Frame };
    resize: { id: string; height: number };
    select: { id: string };
  }>();

  let viewport: HTMLDivElement;     // scrollable wrapper
  let container: HTMLDivElement;    // konva mount target
  let stage: Konva.Stage;
  let layer: Konva.Layer;

  let zoom = 1; // additional multiplier on top of displayScale

  // ── Image picker (character only) ───────────
  let pickerAssetId: string | null = null;
  let pickerLayerId: string | null = null;
  let pickerFrameId: string | null = null;

  $: pickerAsset = pickerAssetId ? assets.find(a => a.id === pickerAssetId) : null;

  // ── Caches ───────────────────────────────────────────────────
  const urlCache = new Map<string, string>();
  const imageCache = new Map<string, HTMLImageElement>();

  function getBlobUrl(blob: Blob, key: string): string {
    if (!urlCache.has(key)) urlCache.set(key, URL.createObjectURL(blob));
    return urlCache.get(key)!;
  }

  function loadImage(url: string, key: string): Promise<HTMLImageElement> {
    if (imageCache.has(key)) return Promise.resolve(imageCache.get(key)!);
    return new Promise(resolve => {
      const img = new window.Image();
      img.onload = () => { imageCache.set(key, img); resolve(img); };
      img.src = url;
    });
  }

  function getAsset(id: string) { return assets.find(a => a.id === id); }
  function getImageMeta(asset: Asset, imageId: string) { return asset.images.find(i => i.id === imageId); }

  // ── Layout calculation ───────────────────────────────────────
  /** Total stage height in canvas pixels (incl. inter-frame gaps) */
  function totalCanvasHeight(): number {
    if (frames.length === 0) return 0;
    return frames.reduce((sum, f) => sum + f.height, 0) + (frames.length - 1) * frameGap;
  }

  /** Y offset (in canvas pixels) of frame at index i */
  function frameOffsetY(i: number): number {
    let y = 0;
    for (let k = 0; k < i; k++) y += frames[k].height + frameGap;
    return y;
  }

  /** Width in canvas px (assumed equal across frames; falls back to 0) */
  function canvasWidth(): number { return frames[0]?.width ?? 0; }

  // ── Stage sizing ─────────────────────────────────────────────
  function applyStageSize() {
    if (!stage) return;
    const w = canvasWidth() * displayScale * zoom;
    const h = totalCanvasHeight() * displayScale * zoom;
    stage.width(Math.max(w, 1));
    stage.height(Math.max(h, 1));
    stage.scale({ x: displayScale * zoom, y: displayScale * zoom });
  }

  // ── Lifecycle ────────────────────────────────────────────────

  /** Set zoom so the canvas width fills ~90% of the available viewport width. */
  function fitZoom() {
    const cw = canvasWidth();
    if (!cw || !viewport) return;
    const availableW = viewport.clientWidth;
    if (!availableW) return;
    const target = (availableW * 0.9) / (cw * displayScale);
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, target));
  }

  onMount(() => {
    stage = new Konva.Stage({ container, width: 1, height: 1 });
    layer = new Konva.Layer();
    stage.add(layer);
    fitZoom();
    applyStageSize();
    renderAll();
    attachZoomHandlers();
  });

  onDestroy(() => {
    stage?.destroy();
    for (const url of urlCache.values()) URL.revokeObjectURL(url);
    urlCache.clear();
    imageCache.clear();
  });

  // Re-render when frames or assets or adjust-mode changes
  $: if (layer) {
    void frames; void assets; void selectedFrameId; void bgAdjustFrameId;
    applyStageSize();
    renderAll();
  }

  // ── Rendering ────────────────────────────────────────────────
  /** Map frame.id → its Konva.Group (used for live drag updates) */
  const frameGroups = new Map<string, Konva.Group>();

  async function renderAll() {
    if (!layer) return;
    layer.destroyChildren();
    frameGroups.clear();

    const w = canvasWidth();
    if (w === 0) { layer.batchDraw(); return; }

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const offsetY = frameOffsetY(i);
      const group = new Konva.Group({ x: 0, y: offsetY });
      frameGroups.set(frame.id, group);
      layer.add(group);

      // 1. Solid bg color (also receives clicks for "select frame")
      const inAdjustMode = frame.id === bgAdjustFrameId;
      const bgRect = new Konva.Rect({
        x: 0, y: 0, width: frame.width, height: frame.height,
        fill: frame.bgColor || '#ffffff',
        listening: !inAdjustMode,
      });
      bgRect.on('click tap', () => dispatch('select', { id: frame.id }));
      group.add(bgRect);

      // 2. Background image (always at native resolution, clipped to a mask rect).
      // In adjust mode the image is draggable (pan crop) and the mask gets handles.
      // We keep references for the adjust-mode overlay so it can render last.
      let adjustKBg: Konva.Image | null = null;
      let adjustBgRef: { img: HTMLImageElement; bg: FrameBackground; mask: { x: number; y: number; width: number; height: number } } | null = null;

      if (frame.background) {
        const bgAsset = getAsset(frame.background.assetId);
        const bgImgMeta = bgAsset ? getImageMeta(bgAsset, frame.background.imageId) : null;
        if (bgImgMeta) {
          const url = getBlobUrl(bgImgMeta.blob, bgImgMeta.id);
          const img = await loadImage(url, bgImgMeta.id);
          const bg = frame.background;
          const mask = bg.mask ?? { x: 0, y: 0, width: frame.width, height: frame.height };

          // Clipped group — background only renders inside the mask rect.
          // Image is anchored at frame top-left at native resolution; the mask
          // acts as a viewport revealing whatever pixels happen to be there.
          const bgGroup = new Konva.Group({
            x: 0, y: 0,
            clip: { x: mask.x, y: mask.y, width: mask.width, height: mask.height },
          });
          const kBg = new Konva.Image({
            image: img,
            x: bg.offsetX ?? 0,
            y: bg.offsetY ?? 0,
            width: img.naturalWidth,
            height: img.naturalHeight,
            draggable: inAdjustMode,
            listening: inAdjustMode,
          });
          if (inAdjustMode) {
            kBg.on('mouseenter', () => { stage.container().style.cursor = 'move'; });
            kBg.on('mouseleave', () => { stage.container().style.cursor = ''; });
            kBg.on('dragend', () => {
              dispatch('change', {
                frame: { ...frame, background: { ...bg, offsetX: Math.round(kBg.x()), offsetY: Math.round(kBg.y()) } },
              });
            });
          }
          bgGroup.add(kBg);
          group.add(bgGroup);

          if (inAdjustMode) {
            adjustKBg = kBg;
            adjustBgRef = { img, bg, mask };
          }
        }
      }

      // 3. Character layers
      for (const fl of frame.layers) {
        const asset = getAsset(fl.assetId);
        if (!asset) continue;
        const imgMeta = getImageMeta(asset, fl.imageId);
        if (!imgMeta) continue;
        const url = getBlobUrl(imgMeta.blob, imgMeta.id);
        const img = await loadImage(url, imgMeta.id);
        const kImg = new Konva.Image({
          image: img,
          x: fl.x, y: fl.y,
          width: img.naturalWidth, height: img.naturalHeight,
          draggable: !inAdjustMode,
          listening: !inAdjustMode,
        });
        kImg.dragBoundFunc((pos) => {
          const groupAbs = group.getAbsolutePosition();
          const scale = stage.scaleX();
          const localX = (pos.x - groupAbs.x) / scale;
          const localY = (pos.y - groupAbs.y) / scale;
          const clampedX = Math.max(-img.naturalWidth + 4, Math.min(frame.width - 4, localX));
          const clampedY = Math.max(-img.naturalHeight + 4, Math.min(frame.height - 4, localY));
          return {
            x: groupAbs.x + clampedX * scale,
            y: groupAbs.y + clampedY * scale,
          };
        });
        kImg.on('dragend', () => {
          dispatch('change', {
            frame: { ...frame, layers: frame.layers.map(l =>
              l.id === fl.id ? { ...l, x: Math.round(kImg.x()), y: Math.round(kImg.y()) } : l
            ) },
          });
        });
        kImg.on('click tap', () => openCharacterPicker(frame.id, fl.id, fl.assetId));
        group.add(kImg);
      }

      // 4. Selection outline (drawn last so it's on top)
      if (frame.id === selectedFrameId) {
        const outline = new Konva.Rect({
          x: 0, y: 0, width: frame.width, height: frame.height,
          stroke: '#7070ff', strokeWidth: 1 / (displayScale * zoom),
          dash: [3 / (displayScale * zoom), 2 / (displayScale * zoom)],
          listening: false,
        });
        group.add(outline);
      }

      // 5. Resize handle at the bottom edge of the frame
      const handleHeight = 4; // canvas px tall; visible bar
      const handle = new Konva.Rect({
        x: 0, y: frame.height,
        width: frame.width, height: handleHeight,
        fill: frame.id === selectedFrameId ? '#5a5acc' : '#3a3a5a',
        opacity: 0.85,
        draggable: true,
        listening: true,
        // cursor handled below
      });
      // Lock X axis: only Y movement matters for resize
      handle.dragBoundFunc((pos) => {
        const groupAbs = group.getAbsolutePosition();
        const scale = stage.scaleX();
        // Allow Y from a min height down to a max
        const localY = (pos.y - groupAbs.y) / scale;
        const minY = 8;
        const maxY = 1024;
        const clampedY = Math.max(minY, Math.min(maxY, localY));
        return { x: groupAbs.x, y: groupAbs.y + clampedY * scale };
      });
      handle.on('mouseenter', () => { stage.container().style.cursor = 'ns-resize'; });
      handle.on('mouseleave', () => { stage.container().style.cursor = ''; });
      handle.on('dragmove', () => {
        const newHeight = Math.round(handle.y());
        // Live-update: resize bg rect & shift later frame groups
        bgRect.height(newHeight);
        if (frame.id === selectedFrameId) {
          // Update selection outline if present
          const outlineNode = group.findOne((n: any) => n instanceof Konva.Rect && n.stroke() === '#7070ff') as Konva.Rect | undefined;
          if (outlineNode) outlineNode.height(newHeight);
        }
        // Shift all subsequent frame groups
        const delta = newHeight - frame.height;
        for (let k = i + 1; k < frames.length; k++) {
          const otherGroup = frameGroups.get(frames[k].id);
          if (otherGroup) otherGroup.y(frameOffsetY(k) + delta);
        }
        // Resize stage if growing
        const newTotal = totalCanvasHeight() + delta;
        stage.height(newTotal * displayScale * zoom);
        layer.batchDraw();
      });
      handle.on('dragend', () => {
        const newHeight = Math.max(8, Math.round(handle.y()));
        dispatch('resize', { id: frame.id, height: newHeight });
      });
      group.add(handle);

      // 6. Background-adjust overlay (rendered LAST so it sits on top of everything)
      if (inAdjustMode && adjustKBg && adjustBgRef) {
        const kBg = adjustKBg;
        const ref = adjustBgRef;

        // Live mask state — modified by handle drags, persisted on dragend.
        const maskState = { x: ref.mask.x, y: ref.mask.y, width: ref.mask.width, height: ref.mask.height };

        // Mask body — static orange outline showing the visible region.
        // Drag is handled on the bg image itself; handles resize the mask.
        const maskBody = new Konva.Rect({
          x: maskState.x, y: maskState.y,
          width: maskState.width, height: maskState.height,
          stroke: '#f0a040',
          strokeWidth: 1.5 / (displayScale * zoom),
          fill: 'rgba(240,160,64,0.05)',
          listening: false,
        });
        group.add(maskBody);
        type HandlePos = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
        const handlePositions: HandlePos[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        const handleSize = 6;
        const cursors: Record<HandlePos, string> = {
          nw: 'nwse-resize', se: 'nwse-resize',
          ne: 'nesw-resize', sw: 'nesw-resize',
          n: 'ns-resize', s: 'ns-resize',
          e: 'ew-resize', w: 'ew-resize',
        };
        const handleNodes: Record<string, Konva.Rect> = {};

        // Position a single handle from current maskState.
        function handleXY(pos: HandlePos): { x: number; y: number } {
          const cx =
            pos === 'nw' || pos === 'w' || pos === 'sw' ? maskState.x :
            pos === 'n' || pos === 's' ? maskState.x + maskState.width / 2 :
            maskState.x + maskState.width;
          const cy =
            pos === 'nw' || pos === 'n' || pos === 'ne' ? maskState.y :
            pos === 'w' || pos === 'e' ? maskState.y + maskState.height / 2 :
            maskState.y + maskState.height;
          return { x: cx - handleSize / 2, y: cy - handleSize / 2 };
        }

        function repositionHandles() {
          for (const p of handlePositions) {
            const xy = handleXY(p);
            handleNodes[p].x(xy.x);
            handleNodes[p].y(xy.y);
          }
        }

        function refreshBgPosition() {
          // Clip region tracks maskState; image position is driven by user drag.
          const parent = kBg.getParent() as Konva.Group | null;
          if (parent) {
            parent.clip({ x: maskState.x, y: maskState.y, width: maskState.width, height: maskState.height });
          }
        }

        // Build the 8 handles.
        const MIN_MASK = 8;
        for (const p of handlePositions) {
          const xy = handleXY(p);
          const h = new Konva.Rect({
            x: xy.x, y: xy.y,
            width: handleSize, height: handleSize,
            fill: '#f0a040',
            stroke: '#1a1a30',
            strokeWidth: 0.5,
            draggable: true,
            listening: true,
          });
          handleNodes[p] = h;

          h.on('mouseenter', () => { stage.container().style.cursor = cursors[p]; });
          h.on('mouseleave', () => { stage.container().style.cursor = ''; });

          // Lock movement axis based on handle type.
          h.dragBoundFunc((pos) => {
            const groupAbs = group.getAbsolutePosition();
            const s = stage.scaleX();
            let lx = (pos.x - groupAbs.x) / s + handleSize / 2;
            let ly = (pos.y - groupAbs.y) / s + handleSize / 2;

            // Determine which sides this handle controls.
            const movesLeft = p === 'nw' || p === 'w' || p === 'sw';
            const movesRight = p === 'ne' || p === 'e' || p === 'se';
            const movesTop = p === 'nw' || p === 'n' || p === 'ne';
            const movesBottom = p === 'sw' || p === 's' || p === 'se';

            // Constrain to frame bounds and minimum size.
            if (movesLeft) lx = Math.max(0, Math.min(maskState.x + maskState.width - MIN_MASK, lx));
            else if (movesRight) lx = Math.max(maskState.x + MIN_MASK, Math.min(frame.width, lx));
            else lx = maskState.x + maskState.width / 2;

            if (movesTop) ly = Math.max(0, Math.min(maskState.y + maskState.height - MIN_MASK, ly));
            else if (movesBottom) ly = Math.max(maskState.y + MIN_MASK, Math.min(frame.height, ly));
            else ly = maskState.y + maskState.height / 2;

            return {
              x: groupAbs.x + (lx - handleSize / 2) * s,
              y: groupAbs.y + (ly - handleSize / 2) * s,
            };
          });

          h.on('dragmove', () => {
            const cx = h.x() + handleSize / 2;
            const cy = h.y() + handleSize / 2;
            const movesLeft = p === 'nw' || p === 'w' || p === 'sw';
            const movesRight = p === 'ne' || p === 'e' || p === 'se';
            const movesTop = p === 'nw' || p === 'n' || p === 'ne';
            const movesBottom = p === 'sw' || p === 's' || p === 'se';

            if (movesLeft) {
              const newRight = maskState.x + maskState.width;
              maskState.x = Math.round(cx);
              maskState.width = newRight - maskState.x;
            } else if (movesRight) {
              maskState.width = Math.round(cx - maskState.x);
            }
            if (movesTop) {
              const newBottom = maskState.y + maskState.height;
              maskState.y = Math.round(cy);
              maskState.height = newBottom - maskState.y;
            } else if (movesBottom) {
              maskState.height = Math.round(cy - maskState.y);
            }
            // Update mask body & sibling handles & bg.
            maskBody.x(maskState.x);
            maskBody.y(maskState.y);
            maskBody.width(maskState.width);
            maskBody.height(maskState.height);
            repositionHandles();
            refreshBgPosition();
            layer.batchDraw();
          });

          h.on('dragend', () => {
            dispatch('change', {
              frame: { ...frame, background: { ...ref.bg, mask: { ...maskState } } },
            });
          });

          group.add(h);
        }
      }
    }

    layer.batchDraw();
  }

  // ── Pickers ──────────────────────────────────────────────────
  function openCharacterPicker(frameId: string, layerId: string, assetId: string) {
    pickerFrameId = frameId;
    pickerLayerId = layerId;
    pickerAssetId = assetId;
  }

  function closePicker() {
    pickerFrameId = null;
    pickerLayerId = null;
    pickerAssetId = null;
  }

  function onPickImage(e: CustomEvent<{ imageId: string }>) {
    const f = pickerFrameId ? frames.find(fr => fr.id === pickerFrameId) : null;
    if (!f) { closePicker(); return; }
    if (pickerLayerId) {
      dispatch('change', {
        frame: { ...f, layers: f.layers.map(l => l.id === pickerLayerId ? { ...l, imageId: e.detail.imageId } : l) },
      });
    }
    closePicker();
  }

  // ── Zoom & pan ───────────────────────────────────────────────
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 6;

  function setZoom(newZoom: number, anchorClientX?: number, anchorClientY?: number) {
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoom));
    if (clamped === zoom) return;

    // Preserve viewport-relative position of the anchor point if provided
    let preserveScroll: { sl: number; st: number } | null = null;
    if (anchorClientX !== undefined && anchorClientY !== undefined && viewport) {
      const rect = viewport.getBoundingClientRect();
      const localX = anchorClientX - rect.left + viewport.scrollLeft;
      const localY = anchorClientY - rect.top + viewport.scrollTop;
      const ratio = clamped / zoom;
      const newLocalX = localX * ratio;
      const newLocalY = localY * ratio;
      preserveScroll = {
        sl: newLocalX - (anchorClientX - rect.left),
        st: newLocalY - (anchorClientY - rect.top),
      };
    }

    zoom = clamped;
    applyStageSize();
    renderAll();
    if (preserveScroll && viewport) {
      // Wait for size change to apply
      tick().then(() => {
        viewport.scrollLeft = Math.max(0, preserveScroll!.sl);
        viewport.scrollTop = Math.max(0, preserveScroll!.st);
      });
    }
  }

  function attachZoomHandlers() {
    if (!viewport) return;

    // Mouse wheel: ctrl+wheel = zoom, plain wheel = scroll (default)
    viewport.addEventListener('wheel', (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setZoom(zoom * factor, e.clientX, e.clientY);
    }, { passive: false });

    // Touch pinch zoom (two-finger). Pan happens naturally via container scrolling.
    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    let pinchAnchor: { x: number; y: number } | null = null;

    viewport.addEventListener('touchstart', (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const t1 = e.touches[0], t2 = e.touches[1];
        pinchStartDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        pinchStartZoom = zoom;
        pinchAnchor = { x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 };
      }
    }, { passive: true });

    viewport.addEventListener('touchmove', (e: TouchEvent) => {
      if (e.touches.length === 2 && pinchStartDist > 0 && pinchAnchor) {
        e.preventDefault();
        const t1 = e.touches[0], t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        setZoom(pinchStartZoom * (dist / pinchStartDist), pinchAnchor.x, pinchAnchor.y);
      }
    }, { passive: false });

    viewport.addEventListener('touchend', () => {
      pinchStartDist = 0;
      pinchAnchor = null;
    });
  }

  // ── Public API ───────────────────────────────────────────────
  export function addCharacterLayer(frameId: string, assetId: string, imageId: string) {
    const f = frames.find(fr => fr.id === frameId);
    if (!f) return;
    const id = crypto.randomUUID();
    const newLayer: FrameLayer = { id, assetId, imageId, x: 0, y: 0 };
    dispatch('change', { frame: { ...f, layers: [...f.layers, newLayer] } });
  }

  export function removeCharacterLayer(frameId: string, layerId: string) {
    const f = frames.find(fr => fr.id === frameId);
    if (!f) return;
    dispatch('change', { frame: { ...f, layers: f.layers.filter(l => l.id !== layerId) } });
  }

  export function setBackground(frameId: string, assetId: string, imageId: string) {
    const f = frames.find(fr => fr.id === frameId);
    if (!f) return;
    const bg: FrameBackground = {
      assetId, imageId,
      offsetX: f.background?.offsetX ?? 0,
      offsetY: f.background?.offsetY ?? 0,
      mask: f.background?.mask ?? null,
    };
    dispatch('change', { frame: { ...f, background: bg } });
  }

  export function clearBackground(frameId: string) {
    const f = frames.find(fr => fr.id === frameId);
    if (!f) return;
    dispatch('change', { frame: { ...f, background: null } });
  }

  /** Export the entire stacked comic at native resolution (no zoom) */
  export function exportPng(): string {
    if (!stage) return '';
    const oldScale = { x: stage.scaleX(), y: stage.scaleY() };
    const oldW = stage.width();
    const oldH = stage.height();
    // Render at displayScale only (no zoom) for clean native-res export
    stage.scale({ x: displayScale, y: displayScale });
    stage.width(canvasWidth() * displayScale);
    stage.height(totalCanvasHeight() * displayScale);
    layer.batchDraw();
    const url = stage.toDataURL({ pixelRatio: 1 });
    stage.scale(oldScale);
    stage.width(oldW);
    stage.height(oldH);
    layer.batchDraw();
    return url;
  }

  export function zoomIn() { setZoom(zoom * 1.25); }
  export function zoomOut() { setZoom(zoom / 1.25); }
  export function zoomReset() { setZoom(1); }
  export function getZoom() { return zoom; }
</script>

<div class="composer-root">
  <div class="zoom-bar">
    <button class="zoom-btn" on:click={zoomOut} title="Zoom out (Ctrl+Wheel)">−</button>
    <span class="zoom-label">{Math.round(zoom * 100)}%</span>
    <button class="zoom-btn" on:click={zoomIn} title="Zoom in (Ctrl+Wheel)">+</button>
    <button class="zoom-btn" on:click={zoomReset} title="Reset zoom">⟳</button>
    <span class="zoom-hint">Ctrl+Wheel · Pinch · Drag handle to resize</span>
  </div>

  <div class="viewport" bind:this={viewport}>
    <div class="stage-pad">
      <div class="stage-host" bind:this={container}></div>
    </div>
  </div>
</div>

{#if pickerAsset}
  <ImagePicker
    images={pickerAsset.images}
    assetName={pickerAsset.name}
    on:pick={onPickImage}
    on:close={closePicker}
  />
{/if}

<style>
  .composer-root { display: flex; flex-direction: column; height: 100%; min-width: 0; }
  .zoom-bar { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: #1a1a2e; border-bottom: 1px solid #2a2a40; flex-shrink: 0; font-size: 0.8rem; color: #c0c0e0; }
  .zoom-btn { width: 28px; height: 24px; padding: 0; background: #22223a; border: 1px solid #4a4a6a; border-radius: 3px; color: #e0e0f0; cursor: pointer; }
  .zoom-btn:hover { background: #33335a; }
  .zoom-label { min-width: 44px; text-align: center; font-variant-numeric: tabular-nums; color: #a0a0c0; }
  .zoom-hint { margin-left: auto; color: #6a6a8a; font-size: 0.72rem; }
  .viewport { flex: 1; overflow: auto; background: #0a0a14; touch-action: pan-x pan-y; position: relative; }
  .stage-pad { padding: 24px; display: inline-block; min-width: 100%; box-sizing: border-box; }
  .stage-host { display: inline-block; box-shadow: 0 0 0 1px #2a2a40, 0 8px 32px rgba(0,0,0,0.4); touch-action: none; }
</style>
