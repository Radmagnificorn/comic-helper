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
  import type { Frame, Asset, FrameLayer, FrameBackground, SpeechBubble } from '../types';
  import ImagePicker from './ImagePicker.svelte';
  import pixelMplus10Url from '../assets/fonts/PixelMplus10-Regular.ttf';
  import {
    FRAME_GAP, STAGE_BOTTOM_PADDING, UI_NODE_NAME,
    canvasWidth as _canvasWidth,
    totalCanvasHeight as _totalCanvasHeight,
    frameOffsetY as _frameOffsetY,
  } from './canvasLayout';
  import {
    BUBBLE_FONT, loadBubbleFont, measureBubble, buildBubbleCanvas,
    naturalBase, clampBase, sideOfBase, updateBaseForTip,
    BUBBLE_PAD, BUBBLE_RADIUS, TAIL_HANDLE_R, TAIL_LEAD,
  } from './bubbleRenderer';
  import type { BubbleSide } from './bubbleRenderer';

  export let frames: Frame[] = [];
  export let assets: Asset[] = [];
  export let selectedFrameId: string | null = null;
  /** id of the frame whose background is currently being adjusted (drag/scale), or null */
  export let bgAdjustFrameId: string | null = null;
  /** Solid fill behind every frame (project-level). */
  export let projectBgColor: string = '#ffffff';
  /** How many screen pixels per canvas pixel before zoom */
  export let displayScale: number = 3;
  /** Vertical gap (in canvas px) between frames — re-exported for consumers. */
  export const frameGap: number = FRAME_GAP;

  // Keep STAGE_BOTTOM_PADDING and UI_NODE_NAME as local aliases.
  // Layout helpers delegate to the canvasLayout module so we always have
  // consistent geometry without duplicating the logic.

  const dispatch = createEventDispatcher<{
    change: { frame: Frame };
    resize: { id: string; height: number };
    select: { id: string };
    editbubble: { frameId: string; bubbleId: string };
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

  // ── Layout helpers (delegate to canvasLayout module) ────────
  function totalCanvasHeight(): number { return _totalCanvasHeight(frames); }
  function frameOffsetY(i: number): number { return _frameOffsetY(frames, i); }
  function canvasWidth(): number { return _canvasWidth(frames); }


  // ── Stage sizing ─────────────────────────────────────────────
  function applyStageSize() {
    if (!stage) return;
    const w = canvasWidth() * displayScale * zoom;
    // Add bottom padding so the last frame's resize handle stays inside the
    // stage canvas (and therefore remains draggable).
    const h = (totalCanvasHeight() + STAGE_BOTTOM_PADDING) * displayScale * zoom;
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
    layer = new Konva.Layer({ imageSmoothingEnabled: false });
    stage.add(layer);
    fitZoom();
    applyStageSize();
    renderAll();
    attachZoomHandlers();
    // Load PixelMplus10 once available, then re-render so bubbles use the
    // pixel font instead of the fallback sans-serif.
    loadBubbleFont(pixelMplus10Url).then(() => { if (layer) renderAll(); });
  });

  onDestroy(() => {
    stage?.destroy();
    for (const url of urlCache.values()) URL.revokeObjectURL(url);
    urlCache.clear();
    imageCache.clear();
  });

  // Re-render when frames or assets or adjust-mode changes
  $: if (layer) {
    void frames; void assets; void selectedFrameId; void bgAdjustFrameId; void projectBgColor;
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
        fill: projectBgColor || '#ffffff',
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
            imageSmoothingEnabled: false,
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
          // Flip horizontally by negating scaleX and offsetting so x/y still
          // refer to the visual top-left of the mirrored image.
          scaleX: fl.flippedX ? -1 : 1,
          offsetX: fl.flippedX ? img.naturalWidth : 0,
          draggable: !inAdjustMode,
          listening: !inAdjustMode,
          imageSmoothingEnabled: false,
        });
        kImg.dragBoundFunc((pos) => {
          // With offsetX = naturalWidth and scaleX = -1, kImg.x() still equals
          // the visual top-left X of the mirrored image, so no flip
          // compensation is needed here.
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
        attachLongPress(kImg, frame.id, fl.id);
        group.add(kImg);
      }

      // 3b. Speech bubbles (rendered above character layers)
      const bubbles = frame.bubbles ?? [];
      for (const raw of bubbles) {
        // Backfill tail coordinates for bubbles created before tails existed.
        const bubble: SpeechBubble = {
          ...raw,
          tailX: raw.tailX ?? raw.x + 8,
          tailY: raw.tailY ?? raw.y + 26,
        };
        renderBubble(group, frame, bubble);
      }

      // 4. Selection outline (drawn last so it's on top)
      if (frame.id === selectedFrameId) {
        const outline = new Konva.Rect({
          x: 0, y: 0, width: frame.width, height: frame.height,
          stroke: '#7070ff', strokeWidth: 1 / (displayScale * zoom),
          dash: [3 / (displayScale * zoom), 2 / (displayScale * zoom)],
          listening: false,
          name: UI_NODE_NAME,
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
        name: UI_NODE_NAME,
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
        stage.height((newTotal + STAGE_BOTTOM_PADDING) * displayScale * zoom);
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
          name: UI_NODE_NAME,
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
            name: UI_NODE_NAME,
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

  // ── Long-press context menu for character layers ─────────────
  const LONG_PRESS_MS = 500;
  const LONG_PRESS_MOVE_TOLERANCE = 6; // CSS pixels

  let menuOpen = false;
  let menuX = 0;
  let menuY = 0;
  let menuKind: 'layer' | 'bubble' | null = null;
  let menuFrameId: string | null = null;
  let menuLayerId: string | null = null;
  let menuBubbleId: string | null = null;
  let suppressNextClick = false;

  // ── Speech bubbles ───────────────────────────────────────────

  /**
   * Return the id of another bubble in the same frame whose background rect
   * contains the given absolute (frame-relative) point, or null if none.
   * Used to decide whether a bubble's tail should be rendered as a flat
   * connector strip linking it to that other bubble.
   */
  function findConnectedBubbleId(
    frame: Frame, selfId: string, ax: number, ay: number,
  ): string | null {
    for (const other of frame.bubbles ?? []) {
      if (other.id === selfId) continue;
      const { bgW, bgH } = measureBubble(other.text || ' ', other.fontSize);
      if (ax >= other.x && ax <= other.x + bgW && ay >= other.y && ay <= other.y + bgH) {
        return other.id;
      }
    }
    return null;
  }

  function renderBubble(group: Konva.Group, frame: Frame, bubble: SpeechBubble) {
    const { bgW, bgH, lines } = measureBubble(bubble.text || ' ', bubble.fontSize);

    // Mutable tail tip in bubble-local coords.
    const tip = { x: bubble.tailX - bubble.x, y: bubble.tailY - bubble.y };

    // Initialise tail base from persisted data, falling back to the natural
    // projection of the tip for bubbles that predate the base field.
    let base: { side: BubbleSide; bx: number; by: number } | null = (() => {
      if (bubble.tailBaseX !== undefined && bubble.tailBaseY !== undefined) {
        const lx = bubble.tailBaseX - bubble.x;
        const ly = bubble.tailBaseY - bubble.y;
        return { side: sideOfBase(bgW, bgH, lx, ly), bx: lx, by: ly };
      }
      return naturalBase(bgW, bgH, BUBBLE_RADIUS, tip.x, tip.y);
    })();
    if (base) base = clampBase(bgW, bgH, BUBBLE_RADIUS, base.side, base.bx, base.by);

    // Track whether the tail tip currently overlaps another bubble's rect.
    // While true, the tail is rendered as a flat-ended connector strip.
    let connectedTo: string | null = findConnectedBubbleId(
      frame, bubble.id, bubble.x + tip.x, bubble.y + tip.y,
    );

    let built = buildBubbleCanvas({ bubble, bgW, bgH, lines, tip, base, flatTip: !!connectedTo });
    const kImg = new Konva.Image({
      image: built.canvas,
      x: built.offX,
      y: built.offY,
      width: built.canvas.width,
      height: built.canvas.height,
      imageSmoothingEnabled: false,
      listening: true,
    });

    const bGroup = new Konva.Group({
      x: bubble.x,
      y: bubble.y,
      draggable: frame.id !== bgAdjustFrameId,
    });
    bGroup.add(kImg);
    bGroup.dragBoundFunc((pos) => {
      const groupAbs = group.getAbsolutePosition();
      const scale = stage.scaleX();
      const localX = (pos.x - groupAbs.x) / scale;
      const localY = (pos.y - groupAbs.y) / scale;
      return {
        x: groupAbs.x + Math.max(-bgW + 8, Math.min(frame.width - 8, localX)) * scale,
        y: groupAbs.y + Math.max(-bgH + 8, Math.min(frame.height - 8, localY)) * scale,
      };
    });
    bGroup.on('dragmove', () => {
      tipHandle.position({ x: bGroup.x() + tip.x, y: bGroup.y() + tip.y });
    });
    bGroup.on('dragend', () => {
      const newX = Math.round(bGroup.x()), newY = Math.round(bGroup.y());
      const tipAbsX = newX + Math.round(tip.x);
      const tipAbsY = newY + Math.round(tip.y);
      connectedTo = findConnectedBubbleId(frame, bubble.id, tipAbsX, tipAbsY);
      const updated: SpeechBubble = {
        ...bubble,
        x: newX, y: newY,
        tailX: tipAbsX,
        tailY: tipAbsY,
        ...(base ? { tailBaseX: newX + Math.round(base.bx), tailBaseY: newY + Math.round(base.by) } : {}),
        ...(connectedTo ? { connectedToBubbleId: connectedTo } : { connectedToBubbleId: undefined }),
      };
      dispatch('change', {
        frame: { ...frame, bubbles: (frame.bubbles ?? []).map(b => b.id === bubble.id ? updated : b) },
      });
    });
    group.add(bGroup);
    attachBubbleLongPress(bGroup, frame.id, bubble.id);
    let bubbleDragged = false;
    bGroup.on('dragstart', () => { bubbleDragged = true; });
    bGroup.on('click tap', () => {
      if (suppressNextClick) return;
      if (bubbleDragged) { bubbleDragged = false; return; }
      if (frame.id === bgAdjustFrameId) return;
      dispatch('editbubble', { frameId: frame.id, bubbleId: bubble.id });
    });

    // Draggable tip handle — sibling of bGroup so it doesn't drag the bubble.
    const tipHandle = new Konva.Circle({
      x: bubble.tailX,
      y: bubble.tailY,
      radius: TAIL_HANDLE_R,
      fill: '#7070ff',
      stroke: '#ffffff',
      strokeWidth: 1,
      draggable: frame.id !== bgAdjustFrameId,
      listening: frame.id !== bgAdjustFrameId,
      name: UI_NODE_NAME,
    });
    tipHandle.dragBoundFunc((pos) => {
      const groupAbs = group.getAbsolutePosition();
      const scale = stage.scaleX();
      const localX = (pos.x - groupAbs.x) / scale;
      const localY = (pos.y - groupAbs.y) / scale;
      return {
        x: groupAbs.x + Math.max(0, Math.min(frame.width, localX)) * scale,
        y: groupAbs.y + Math.max(0, Math.min(frame.height, localY)) * scale,
      };
    });
    tipHandle.on('dragmove', () => {
      tip.x = tipHandle.x() - bGroup.x();
      tip.y = tipHandle.y() - bGroup.y();
      base = updateBaseForTip(bgW, bgH, BUBBLE_RADIUS, tip, base);
      connectedTo = findConnectedBubbleId(
        frame, bubble.id, bGroup.x() + tip.x, bGroup.y() + tip.y,
      );
      built = buildBubbleCanvas({ bubble, bgW, bgH, lines, tip, base, flatTip: !!connectedTo });
      kImg.image(built.canvas);
      kImg.position({ x: built.offX, y: built.offY });
      kImg.size({ width: built.canvas.width, height: built.canvas.height });
      layer.batchDraw();
    });
    tipHandle.on('dragend', () => {
      const updated: SpeechBubble = {
        ...bubble,
        tailX: Math.round(tipHandle.x()),
        tailY: Math.round(tipHandle.y()),
        ...(base
          ? { tailBaseX: bGroup.x() + Math.round(base.bx), tailBaseY: bGroup.y() + Math.round(base.by) }
          : {}),
        ...(connectedTo ? { connectedToBubbleId: connectedTo } : { connectedToBubbleId: undefined }),
      };
      dispatch('change', {
        frame: { ...frame, bubbles: (frame.bubbles ?? []).map(b => b.id === bubble.id ? updated : b) },
      });
    });
    group.add(tipHandle);
  }

  function attachLongPress(node: Konva.Image, frameId: string, layerId: string) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0, startY = 0;

    const cancel = () => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
    };

    node.on('pointerdown', (e: any) => {
      const ev = e.evt as PointerEvent;
      startX = ev.clientX;
      startY = ev.clientY;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        // Stop the pending drag — Konva will start dragging on first move
        // after pointerdown unless we cancel it here.
        node.stopDrag();
        suppressNextClick = true;
        menuKind = 'layer';
        menuFrameId = frameId;
        menuLayerId = layerId;
        menuBubbleId = null;
        menuX = ev.clientX;
        menuY = ev.clientY;
        menuOpen = true;
      }, LONG_PRESS_MS);
    });
    node.on('pointermove', (e: any) => {
      if (timer === null) return;
      const ev = e.evt as PointerEvent;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > LONG_PRESS_MOVE_TOLERANCE) {
        cancel();
      }
    });
    node.on('pointerup pointercancel pointerleave dragstart', cancel);
  }

  function attachBubbleLongPress(node: Konva.Group, frameId: string, bubbleId: string) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let startX = 0, startY = 0;

    const cancel = () => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
    };

    node.on('pointerdown', (e: any) => {
      const ev = e.evt as PointerEvent;
      startX = ev.clientX;
      startY = ev.clientY;
      cancel();
      timer = setTimeout(() => {
        timer = null;
        node.stopDrag();
        suppressNextClick = true;
        menuKind = 'bubble';
        menuFrameId = frameId;
        menuBubbleId = bubbleId;
        menuLayerId = null;
        menuX = ev.clientX;
        menuY = ev.clientY;
        menuOpen = true;
      }, LONG_PRESS_MS);
    });
    node.on('pointermove', (e: any) => {
      if (timer === null) return;
      const ev = e.evt as PointerEvent;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > LONG_PRESS_MOVE_TOLERANCE) {
        cancel();
      }
    });
    node.on('pointerup pointercancel pointerleave dragstart', cancel);
  }

  function closeMenu() {
    menuOpen = false;
    menuKind = null;
    menuFrameId = null;
    menuLayerId = null;
    menuBubbleId = null;
    // The suppress flag exists to swallow the click that fires immediately
    // after a long-press on the canvas. If the user instead taps a menu
    // item (which lives outside the canvas), that click never arrives and
    // the flag would otherwise stay set and eat the next real click.
    suppressNextClick = false;
  }

  function menuMoveLayer(direction: 'up' | 'down') {
    const f = menuFrameId ? frames.find(fr => fr.id === menuFrameId) : null;
    if (!f || !menuLayerId) { closeMenu(); return; }
    const idx = f.layers.findIndex(l => l.id === menuLayerId);
    if (idx < 0) { closeMenu(); return;}
    // In storage order, end of array = topmost. "Up" = toward front = +1.
    const swapWith = direction === 'up' ? idx + 1 : idx - 1;
    if (swapWith < 0 || swapWith >= f.layers.length) { closeMenu(); return; }
    const newLayers = [...f.layers];
    [newLayers[idx], newLayers[swapWith]] = [newLayers[swapWith], newLayers[idx]];
    dispatch('change', { frame: { ...f, layers: newLayers } });
    closeMenu();
  }

  function menuFlipLayer() {
    const f = menuFrameId ? frames.find(fr => fr.id === menuFrameId) : null;
    if (!f || !menuLayerId) { closeMenu(); return; }
    dispatch('change', {
      frame: { ...f, layers: f.layers.map(l =>
        l.id === menuLayerId ? { ...l, flippedX: !l.flippedX } : l
      ) },
    });
    closeMenu();
  }

  function menuDeleteLayer() {
    const f = menuFrameId ? frames.find(fr => fr.id === menuFrameId) : null;
    if (!f || !menuLayerId) { closeMenu(); return; }
    dispatch('change', {
      frame: { ...f, layers: f.layers.filter(l => l.id !== menuLayerId) },
    });
    closeMenu();
  }

  function menuDeleteBubble() {
    const f = menuFrameId ? frames.find(fr => fr.id === menuFrameId) : null;
    if (!f || !menuBubbleId) { closeMenu(); return; }
    dispatch('change', {
      frame: { ...f, bubbles: (f.bubbles ?? []).filter(b => b.id !== menuBubbleId) },
    });
    closeMenu();
  }

  // Suppress the click event that fires immediately after a long-press,
  // so the image picker doesn't open on top of the menu.
  function onCanvasClickCapture(e: MouseEvent) {
    if (suppressNextClick) {
      e.stopPropagation();
      e.preventDefault();
      suppressNextClick = false;
    }
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

  /**
   * Export the entire stacked comic as a PNG data URL.
   *
   * The comic is always composed at native (1x) resolution. When `scale` > 1,
   * the resulting image is upscaled with nearest-neighbor sampling (via
   * Konva's `pixelRatio`, combined with `imageSmoothingEnabled: false` on every
   * raster node) so pixel art stays crisp.
   *
   * UI overlay elements (selection outline, frame resize handle, background
   * mask + handles, speech-bubble tail handles) are hidden during export.
   */
  export function exportPng(scale: number = 1): string {
    if (!stage) return '';
    const safeScale = Math.max(1, Math.floor(scale) || 1);

    // Hide all UI overlay nodes for the duration of the export.
    const uiNodes = stage.find(`.${UI_NODE_NAME}`);
    for (const n of uiNodes) n.hide();

    const oldScale = { x: stage.scaleX(), y: stage.scaleY() };
    const oldW = stage.width();
    const oldH = stage.height();

    // Render at native resolution (no displayScale, no zoom, no bottom padding)
    // so the exported PNG is exactly canvasWidth × totalCanvasHeight pixels at
    // 1x. Higher scales are achieved via pixelRatio (nearest-neighbor).
    stage.scale({ x: 1, y: 1 });
    stage.width(canvasWidth());
    stage.height(totalCanvasHeight());
    layer.batchDraw();

    let url = '';
    try {
      url = stage.toDataURL({ pixelRatio: safeScale });
    } finally {
      stage.scale(oldScale);
      stage.width(oldW);
      stage.height(oldH);
      for (const n of uiNodes) n.show();
      layer.batchDraw();
    }
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
      <div class="stage-host" bind:this={container} on:click|capture={onCanvasClickCapture}></div>
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

{#if menuOpen}
  <!-- Backdrop captures clicks/taps outside the menu to close it. -->
  <div class="ctx-backdrop" on:click={closeMenu} on:contextmenu|preventDefault={closeMenu}></div>
  <div class="ctx-menu" style="left: {menuX}px; top: {menuY}px;">
    {#if menuKind === 'bubble'}
      <button class="ctx-item ctx-item-danger" on:click={menuDeleteBubble}>✕ Delete</button>
    {:else}
      <button class="ctx-item" on:click={() => menuMoveLayer('up')}>▲ Move up</button>
      <button class="ctx-item" on:click={() => menuMoveLayer('down')}>▼ Move down</button>
      <button class="ctx-item" on:click={menuFlipLayer}>⇋ Flip horizontal</button>
      <button class="ctx-item ctx-item-danger" on:click={menuDeleteLayer}>✕ Delete</button>
    {/if}
  </div>
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
  .stage-host :global(canvas) { image-rendering: crisp-edges; image-rendering: pixelated; }

  .ctx-backdrop {
    position: fixed; inset: 0;
    z-index: 100;
    background: transparent;
  }
  .ctx-menu {
    position: fixed;
    z-index: 101;
    background: #1e1e30;
    border: 1px solid #4a4a6a;
    border-radius: 6px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    padding: 4px;
    min-width: 160px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .ctx-item {
    background: transparent;
    border: none;
    color: #e0e0f0;
    padding: 8px 12px;
    text-align: left;
    font-size: 0.85rem;
    cursor: pointer;
    border-radius: 4px;
  }
  .ctx-item:hover { background: #2a2a4a; }
  .ctx-item:active { background: #3a3a6a; }
  .ctx-item-danger { color: #ff8080; }
  .ctx-item-danger:hover { background: #4a2020; }
</style>
