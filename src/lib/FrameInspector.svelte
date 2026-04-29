<!--
  FrameInspector.svelte – all controls for the currently selected frame.
  Sections: Frame meta · Background · Layers (drag to reorder, top of list = topmost render)
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Frame, Asset, FrameBackground, FrameLayer } from '../types';

  export let frame: Frame | null = null;
  export let assets: Asset[] = [];
  export let frameIndex: number = -1;
  export let frameCount: number = 0;
  /** id of the frame whose background is currently being adjusted, or null */
  export let bgAdjustFrameId: string | null = null;

  const dispatch = createEventDispatcher<{
    change: { frame: Frame };
    delete: { id: string };
    move: { id: string; direction: 'up' | 'down' };
    adjustBackground: { id: string | null };
  }>();

  $: isAdjusting = !!frame && bgAdjustFrameId === frame.id;

  $: backgroundAssets = assets.filter(a => a.type === 'background');
  $: characterAssets = assets.filter(a => a.type === 'character');

  function getAsset(id: string) { return assets.find(a => a.id === id); }
  function getImageMeta(asset: Asset | undefined, imageId: string) {
    return asset?.images.find(i => i.id === imageId);
  }
  function imageUrl(asset: Asset | undefined, imageId: string): string {
    const m = getImageMeta(asset, imageId);
    return m ? URL.createObjectURL(m.blob) : '';
  }

  // ── Frame meta ────────────────────────────────────────────────
  function setHeight(h: number) {
    if (!frame) return;
    const clamped = Math.max(8, Math.min(1024, Math.round(h)));
    dispatch('change', { frame: { ...frame, height: clamped } });
  }
  function setBgColor(c: string) {
    if (!frame) return;
    dispatch('change', { frame: { ...frame, bgColor: c } });
  }
  function setLabel(label: string) {
    if (!frame) return;
    dispatch('change', { frame: { ...frame, label } });
  }

  // ── Background ────────────────────────────────────────────────
  function setBackgroundAsset(assetId: string) {
    if (!frame) return;
    const asset = getAsset(assetId);
    if (!asset || asset.images.length === 0) return;
    const bg: FrameBackground = {
      assetId, imageId: asset.images[0].id,
      mask: frame.background?.mask ?? null,
    };
    dispatch('change', { frame: { ...frame, background: bg } });
  }
  function setBackgroundImage(imageId: string) {
    if (!frame || !frame.background) return;
    dispatch('change', { frame: { ...frame, background: { ...frame.background, imageId } } });
  }
  function clearBackground() {
    if (!frame) return;
    dispatch('change', { frame: { ...frame, background: null } });
  }

  // ── Layers ────────────────────────────────────────────────────
  function addCharacter(assetId: string) {
    if (!frame) return;
    const asset = getAsset(assetId);
    if (!asset || asset.images.length === 0) return;
    const newLayer: FrameLayer = { id: crypto.randomUUID(), assetId, imageId: asset.images[0].id, x: 0, y: 0 };
    dispatch('change', { frame: { ...frame, layers: [...frame.layers, newLayer] } });
  }
  function removeLayer(layerId: string) {
    if (!frame) return;
    dispatch('change', { frame: { ...frame, layers: frame.layers.filter(l => l.id !== layerId) } });
  }
  function setLayerImage(layerId: string, imageId: string) {
    if (!frame) return;
    dispatch('change', {
      frame: { ...frame, layers: frame.layers.map(l => l.id === layerId ? { ...l, imageId } : l) },
    });
  }

  /** Layers sorted top-of-list = topmost render = end of frame.layers array */
  $: displayLayers = frame ? [...frame.layers].reverse() : [];

  // Drag-to-reorder. Indices are into displayLayers (visual top→bottom).
  let dragIndex: number | null = null;
  let overIndex: number | null = null;

  function onDragStart(e: DragEvent, idx: number) {
    dragIndex = idx;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(idx));
    }
  }
  function onDragOver(e: DragEvent, idx: number) {
    if (dragIndex === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    overIndex = idx;
  }
  function onDragLeave() { overIndex = null; }
  function onDrop(e: DragEvent, idx: number) {
    e.preventDefault();
    if (!frame || dragIndex === null || dragIndex === idx) {
      dragIndex = null; overIndex = null; return;
    }
    const reordered = [...displayLayers];
    const [moved] = reordered.splice(dragIndex, 1);
    reordered.splice(idx, 0, moved);
    // Reverse back into storage order (last = topmost)
    const newStorageOrder = [...reordered].reverse();
    dispatch('change', { frame: { ...frame, layers: newStorageOrder } });
    dragIndex = null;
    overIndex = null;
  }
  function onDragEnd() { dragIndex = null; overIndex = null; }
</script>

<div class="inspector">
  {#if !frame}
    <p class="empty">Tap a frame in the canvas to inspect it.</p>
  {:else}
    <!-- ── Frame meta ───────────────────────────── -->
    <div class="section-header">Frame</div>
    <div class="row">
      <label class="field grow">
        <span class="field-label">Label</span>
        <input
          type="text"
          value={frame.label}
          on:change={e => setLabel((e.target as HTMLInputElement).value)}
        />
      </label>
    </div>
    <div class="row">
      <label class="field">
        <span class="field-label">Height</span>
        <input
          type="number"
          min="8" max="1024"
          value={frame.height}
          on:change={e => setHeight(+(e.target as HTMLInputElement).value)}
        />
      </label>
      <label class="field grow">
        <span class="field-label">Background color</span>
        <div class="color-row">
          <input
            type="color"
            value={frame.bgColor}
            class="color-swatch"
            on:input={e => setBgColor((e.target as HTMLInputElement).value)}
          />
          <input
            type="text"
            value={frame.bgColor}
            maxlength="7"
            class="color-hex"
            on:change={e => setBgColor((e.target as HTMLInputElement).value)}
          />
        </div>
      </label>
    </div>
    <div class="row actions-row">
      <button
        class="btn"
        disabled={frameIndex <= 0}
        on:click={() => frame && dispatch('move', { id: frame.id, direction: 'up' })}
        title="Move frame up"
      >▲ Up</button>
      <button
        class="btn"
        disabled={frameIndex < 0 || frameIndex >= frameCount - 1}
        on:click={() => frame && dispatch('move', { id: frame.id, direction: 'down' })}
        title="Move frame down"
      >▼ Down</button>
      <button
        class="btn danger"
        on:click={() => frame && dispatch('delete', { id: frame.id })}
        title="Delete frame"
      >✕ Delete frame</button>
    </div>

    <!-- ── Background ───────────────────────────── -->
    <div class="section-header">Background</div>
    {#if frame.background}
      {@const bgAsset = getAsset(frame.background.assetId)}
      <div class="bg-current">
        {#if bgAsset}
          <img class="bg-thumb" src={imageUrl(bgAsset, frame.background.imageId)} alt={bgAsset.name} draggable="false" />
        {/if}
        <div class="bg-meta">
          <div class="bg-name">{bgAsset?.name ?? '?'}</div>
          {#if bgAsset && bgAsset.images.length > 1}
            <select
              class="picker small"
              value={frame.background.imageId}
              on:change={e => setBackgroundImage((e.target as HTMLSelectElement).value)}
            >
              {#each bgAsset.images as img (img.id)}
                <option value={img.id}>{img.name}</option>
              {/each}
            </select>
          {/if}
        </div>
        <button class="icon-btn danger" title="Clear background" on:click={clearBackground}>✕</button>
      </div>
      <div class="adjust-row">
        <button
          class="btn adjust-btn"
          class:active={isAdjusting}
          on:click={() => dispatch('adjustBackground', { id: isAdjusting ? null : frame.id })}
        >{isAdjusting ? '✓ Done adjusting' : '✎ Adjust background'}</button>
        {#if isAdjusting}
          <span class="adjust-hint">Drag the box to move it · drag the corners or edges to resize</span>
        {/if}
      </div>
    {/if}
    <select
      class="picker"
      on:change={e => {
        const v = (e.target as HTMLSelectElement).value;
        (e.target as HTMLSelectElement).value = '';
        if (v) setBackgroundAsset(v);
      }}
    >
      <option value="">{frame.background ? 'Change background…' : 'Set background…'}</option>
      {#each backgroundAssets as a (a.id)}
        <option value={a.id}>{a.name}</option>
      {/each}
    </select>

    <!-- ── Assets (character layers) ─────── -->
    <div class="section-header">
      <span>Assets</span>
      <span class="hint">drag to reorder · top = front</span>
    </div>
    {#if displayLayers.length === 0}
      <p class="empty small">No layers yet.</p>
    {:else}
      <ul class="layers" on:dragleave={onDragLeave}>
        {#each displayLayers as fl, idx (fl.id)}
          {@const asset = getAsset(fl.assetId)}
          <li
            class="layer-row"
            class:dragging={dragIndex === idx}
            class:drop-target={overIndex === idx && dragIndex !== idx}
            draggable="true"
            on:dragstart={e => onDragStart(e, idx)}
            on:dragover={e => onDragOver(e, idx)}
            on:drop={e => onDrop(e, idx)}
            on:dragend={onDragEnd}
          >
            <span class="grip" title="Drag to reorder">⋮⋮</span>
            {#if asset}
              <img class="layer-thumb" src={imageUrl(asset, fl.imageId)} alt={asset.name} draggable="false" />
            {/if}
            <div class="layer-meta">
              <div class="layer-name">{asset?.name ?? '?'}</div>
              {#if asset && asset.images.length > 1}
                <select
                  class="picker small"
                  value={fl.imageId}
                  on:change={e => setLayerImage(fl.id, (e.target as HTMLSelectElement).value)}
                >
                  {#each asset.images as img (img.id)}
                    <option value={img.id}>{img.name}</option>
                  {/each}
                </select>
              {/if}
            </div>
            <button class="icon-btn danger" title="Remove layer" on:click={() => removeLayer(fl.id)}>✕</button>
          </li>
        {/each}
      </ul>
    {/if}
    <select
      class="picker"
      on:change={e => {
        const v = (e.target as HTMLSelectElement).value;
        (e.target as HTMLSelectElement).value = '';
        if (v) addCharacter(v);
      }}
    >
      <option value="">+ Add character layer…</option>
      {#each characterAssets as a (a.id)}
        <option value={a.id}>{a.name}</option>
      {/each}
    </select>
  {/if}
</div>

<style>
  .inspector { display: flex; flex-direction: column; gap: 6px; padding: 10px; color: #e0e0f0; }
  .empty { color: #6a6a8a; font-size: 0.85rem; text-align: center; padding: 16px; }
  .empty.small { padding: 6px; font-size: 0.75rem; }

  .section-header {
    display: flex; align-items: baseline; justify-content: space-between;
    margin-top: 8px; padding-bottom: 4px;
    border-bottom: 1px solid #33334d;
    font-size: 0.72rem; color: #9090b0;
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .section-header:first-child { margin-top: 0; }
  .hint { font-size: 0.65rem; color: #6a6a8a; text-transform: none; letter-spacing: 0; }

  .row { display: flex; gap: 8px; align-items: flex-end; }
  .row.actions-row { flex-wrap: wrap; }
  .field { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .field.grow { flex: 1; }
  .field-label { font-size: 0.68rem; color: #7070a0; }
  .field input[type="text"] { width: 100%; }
  .field input[type="number"] { width: 80px; }

  .color-row { display: flex; gap: 4px; align-items: center; }
  .color-swatch { width: 32px; height: 28px; padding: 1px; cursor: pointer; border-radius: 3px; border: 1px solid #4a4a6a; background: none; flex-shrink: 0; }
  .color-hex { width: 80px; font-family: monospace; font-size: 0.78rem; }

  .btn { font-size: 0.78rem; }
  .btn.danger { background: #4a1e1e; border-color: #8a3a3a; color: #f0aeae; }
  .btn.danger:hover:not(:disabled) { background: #6a2a2a; border-color: #b85a5a; }

  /* Background */
  .bg-current { display: flex; gap: 8px; align-items: center; padding: 6px; background: #1a1a30; border-radius: 4px; }
  .bg-thumb { width: 56px; height: 40px; object-fit: cover; background: #000; border-radius: 3px; flex-shrink: 0; }
  .bg-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .bg-name { font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Adjust mode */
  .adjust-row { display: flex; flex-direction: column; gap: 4px; padding: 6px 0 2px; }
  .adjust-btn { align-self: flex-start; }
  .adjust-btn.active { background: #5a3a1e; border-color: #b07a3a; color: #ffd9a0; }
  .adjust-btn.active:hover:not(:disabled) { background: #7a5028; border-color: #d09a4a; }
  .adjust-hint { font-size: 0.7rem; color: #9090b0; line-height: 1.3; }

  /* Layers */
  .layers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .layer-row {
    display: flex; align-items: center; gap: 8px;
    padding: 6px; background: #1a1a30; border: 1px solid transparent;
    border-radius: 4px; cursor: grab;
    transition: background 0.1s, border-color 0.1s, opacity 0.1s;
  }
  .layer-row:active { cursor: grabbing; }
  .layer-row.dragging { opacity: 0.4; }
  .layer-row.drop-target { border-color: #7070ff; background: #2a2a50; }
  .grip { color: #5a5a7a; font-family: monospace; cursor: grab; user-select: none; padding: 0 2px; }
  .layer-thumb { width: 40px; height: 40px; object-fit: contain; background: #000; border-radius: 3px; flex-shrink: 0; image-rendering: pixelated; }
  .layer-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .layer-name { font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .picker { width: 100%; background: #1a1a30; color: #e0e0f0; border: 1px solid #4a4a6a; border-radius: 4px; padding: 5px; font-size: 0.82rem; }
  .picker.small { padding: 2px 4px; font-size: 0.72rem; }

  .icon-btn { background: none; border: none; cursor: pointer; padding: 4px 6px; color: #7070a0; border-radius: 3px; }
  .icon-btn:hover { color: #c0c0e0; }
  .icon-btn.danger:hover { background: #7a2020; color: #fff; }
</style>
