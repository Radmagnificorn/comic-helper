<!-- ImagePicker.svelte – modal/popover to pick a specific image from an asset -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { AssetImage } from '../types';

  export let images: AssetImage[] = [];
  export let assetName: string = '';

  const dispatch = createEventDispatcher<{
    pick: { imageId: string };
    close: void;
  }>();

  function blobUrl(blob: Blob) {
    return URL.createObjectURL(blob);
  }

  let previewUrl: string | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressActive = false;

  function startPress(img: AssetImage) {
    longPressActive = false;
    longPressTimer = setTimeout(() => {
      longPressActive = true;
      previewUrl = URL.createObjectURL(img.blob);
    }, 500);
  }

  function endPress() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
  }

  function handlePick(img: AssetImage) {
    if (longPressActive) {
      longPressActive = false;
      return;
    }
    dispatch('pick', { imageId: img.id });
  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="overlay" on:click|self={() => dispatch('close')}>
  <div class="modal">
    <div class="modal-header">
      <span>Pick image for <strong>{assetName}</strong></span>
      <button on:click={() => dispatch('close')}>✕</button>
    </div>
    <div class="grid">
      {#each images as img (img.id)}
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <button
          class="img-btn"
          on:click={() => handlePick(img)}
          on:pointerdown={() => startPress(img)}
          on:pointerup={endPress}
          on:pointercancel={endPress}
          on:contextmenu|preventDefault
        >
          <div class="img-thumb" style="background-image: url({blobUrl(img.blob)})"></div>
          <span>{img.name}</span>
        </button>
      {/each}
    </div>

  {#if previewUrl}
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="preview-overlay" on:pointerup={endPress} on:contextmenu|preventDefault>
      <img src={previewUrl} alt="Preview" draggable="false" on:contextmenu|preventDefault />
    </div>
  {/if}
    {#if images.length === 0}
      <p class="empty">No images uploaded for this asset yet.</p>
    {/if}
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: #1e1e36; border: 1px solid #4a4a6a; border-radius: 8px; padding: 16px; max-width: 480px; width: 90%; max-height: 80vh; display: flex; flex-direction: column; gap: 12px; color: #e0e0f0; }
  .modal-header { display: flex; justify-content: space-between; align-items: center; }
  .modal-header span { font-size: 0.9rem; color: #e0e0f0; }
  .modal-header button { background: none; border: none; color: #a0a0c0; cursor: pointer; font-size: 1rem; }
  .modal-header button:hover { color: #fff; background: none; }
  .grid { display: flex; flex-wrap: wrap; gap: 8px; overflow-y: auto; }
  .img-btn { background: #26263e; border: 1px solid #4a4a6a; border-radius: 4px; padding: 6px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px; color: #e0e0f0; -webkit-touch-callout: none; user-select: none; }
  .img-btn:hover { border-color: #8080dd; background: #32324e; }
  .img-thumb { width: 64px; height: 64px; background-size: contain; background-repeat: no-repeat; background-position: center; image-rendering: pixelated; image-rendering: crisp-edges; background-color: #111; pointer-events: none; }
  .img-btn span { font-size: 0.65rem; color: #a0a0c0; max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: #7070a0; font-size: 0.8rem; text-align: center; }
  .preview-overlay { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,0.88); display: flex; align-items: center; justify-content: center; pointer-events: all; }
  .preview-overlay img { width: 92vw; height: 92vh; object-fit: contain; image-rendering: pixelated; image-rendering: crisp-edges; border: 2px solid #7070cc; border-radius: 4px; }
</style>
