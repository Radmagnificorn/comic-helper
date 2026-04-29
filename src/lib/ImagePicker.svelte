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
        <button class="img-btn" on:click={() => dispatch('pick', { imageId: img.id })}>
          <img src={blobUrl(img.blob)} alt={img.name} />
          <span>{img.name}</span>
        </button>
      {/each}
    </div>
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
  .img-btn { background: #26263e; border: 1px solid #4a4a6a; border-radius: 4px; padding: 6px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 4px; color: #e0e0f0; }
  .img-btn:hover { border-color: #8080dd; background: #32324e; }
  .img-btn img { width: 64px; height: 64px; object-fit: contain; image-rendering: pixelated; background: #111; }
  .img-btn span { font-size: 0.65rem; color: #a0a0c0; max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .empty { color: #7070a0; font-size: 0.8rem; text-align: center; }
</style>
