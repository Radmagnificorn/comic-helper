<!--
  FrameInspector.svelte – all controls for the currently selected frame.
  Sections: Frame meta · Background · Layers (drag to reorder, top of list = topmost render)
-->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Frame, Asset, FrameBackground, FrameLayer, SpeechBubble } from '../types';

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
      offsetX: frame.background?.offsetX ?? 0,
      offsetY: frame.background?.offsetY ?? 0,
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

  function moveLayerUp(idx: number) {
    if (!frame || idx <= 0) return;
    const reordered = [...displayLayers];
    [reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]];
    dispatch('change', { frame: { ...frame, layers: [...reordered].reverse() } });
  }
  function moveLayerDown(idx: number) {
    if (!frame || idx >= displayLayers.length - 1) return;
    const reordered = [...displayLayers];
    [reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]];
    dispatch('change', { frame: { ...frame, layers: [...reordered].reverse() } });
  }

  // ── Speech bubbles ────────────────────────────────────────────
  function addBubble() {
    if (!frame) return;
    const bubble: SpeechBubble = {
      id: crypto.randomUUID(),
      text: 'Hello!',
      x: 4,
      y: 4,
      fontSize: 10,
      // Default tail tip points down-left from the bubble.
      tailX: 12,
      tailY: 30,
    };
    dispatch('change', { frame: { ...frame, bubbles: [...(frame.bubbles ?? []), bubble] } });
  }
  function updateBubble(id: string, patch: Partial<SpeechBubble>) {
    if (!frame) return;
    dispatch('change', {
      frame: { ...frame, bubbles: (frame.bubbles ?? []).map(b => b.id === id ? { ...b, ...patch } : b) },
    });
  }
  function removeBubble(id: string) {
    if (!frame) return;
    dispatch('change', { frame: { ...frame, bubbles: (frame.bubbles ?? []).filter(b => b.id !== id) } });
  }

  /** Called by parent (App) to scroll to + focus a specific bubble's textarea. */
  export function focusBubble(bubbleId: string) {
    // Wait a frame so the textarea exists if the inspector was just opened.
    requestAnimationFrame(() => {
      const ta = document.querySelector<HTMLTextAreaElement>(
        `textarea.bubble-text[data-bubble-id="${bubbleId}"]`,
      );
      if (!ta) return;
      ta.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      ta.focus();
      ta.select();
    });
  }
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
      <span class="hint">top = front</span>
    </div>
    {#if displayLayers.length === 0}
      <p class="empty small">No layers yet.</p>
    {:else}
      <ul class="layers">
        {#each displayLayers as fl, idx (fl.id)}
          {@const asset = getAsset(fl.assetId)}
          <li class="layer-row">
            <div class="order-btns">
              <button class="nudge" title="Move layer forward" disabled={idx === 0} on:click={() => moveLayerUp(idx)}>▲</button>
              <button class="nudge" title="Move layer back" disabled={idx === displayLayers.length - 1} on:click={() => moveLayerDown(idx)}>▼</button>
            </div>
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

    <!-- ── Speech bubbles ───────────────────────── -->
    <div class="section-header">Speech bubbles</div>
    {#if (frame.bubbles ?? []).length === 0}
      <p class="empty small">No bubbles yet.</p>
    {:else}
      <ul class="bubbles">
        {#each frame.bubbles ?? [] as b (b.id)}
          <li class="bubble-row">
            <textarea
              class="bubble-text"
              data-bubble-id={b.id}
              rows="2"
              value={b.text}
              on:input={e => updateBubble(b.id, { text: (e.target as HTMLTextAreaElement).value })}
            ></textarea>
            <label class="field bubble-size">
              <span class="field-label">Size</span>
              <input
                type="number"
                min="6" max="48"
                value={b.fontSize}
                on:change={e => updateBubble(b.id, { fontSize: Math.max(6, Math.min(48, +(e.target as HTMLInputElement).value)) })}
              />
            </label>
            <button class="icon-btn danger" title="Remove bubble" on:click={() => removeBubble(b.id)}>✕</button>
          </li>
        {/each}
      </ul>
    {/if}
    <button class="btn" on:click={addBubble}>+ Add speech bubble</button>
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
    border-radius: 4px;
  }
  .order-btns { display: flex; flex-direction: column; gap: 2px; flex-shrink: 0; }
  .layer-thumb { width: 40px; height: 40px; object-fit: contain; background: #000; border-radius: 3px; flex-shrink: 0; image-rendering: pixelated; }
  .layer-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .layer-name { font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .picker { width: 100%; background: #1a1a30; color: #e0e0f0; border: 1px solid #4a4a6a; border-radius: 4px; padding: 5px; font-size: 0.82rem; }
  .picker.small { padding: 2px 4px; font-size: 0.72rem; }

  .icon-btn { background: none; border: none; cursor: pointer; padding: 4px 6px; color: #7070a0; border-radius: 3px; }
  .icon-btn:hover { color: #c0c0e0; }
  .icon-btn.danger:hover { background: #7a2020; color: #fff; }

  /* Speech bubbles */
  .bubbles { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .bubble-row {
    display: flex; align-items: flex-start; gap: 6px;
    padding: 6px; background: #1a1a30; border: 1px solid transparent;
    border-radius: 4px;
  }
  .bubble-text {
    flex: 1; min-width: 0; resize: vertical;
    background: #0e0e1a; color: #e0e0f0;
    border: 1px solid #4a4a6a; border-radius: 3px;
    padding: 4px 6px; font-size: 0.82rem; font-family: inherit;
  }
  .bubble-size { width: 60px; flex-shrink: 0; }
  .bubble-size input { width: 100%; }
</style>
