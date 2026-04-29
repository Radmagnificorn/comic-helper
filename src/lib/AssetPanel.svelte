<!-- AssetPanel.svelte – manage character and background assets -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Asset, AssetImage } from '../types';

  export let assets: Asset[] = [];

  const dispatch = createEventDispatcher<{
    createAsset: { name: string; type: 'character' | 'background' };
    uploadImages: { assetId: string; files: FileList };
    deleteImage: { assetId: string; imageId: string };
    deleteAsset: { assetId: string };
  }>();

  let newName = '';
  let newType: 'character' | 'background' = 'character';
  let expandedId: string | null = null;

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    dispatch('createAsset', { name, type: newType });
    newName = '';
  }

  function handleUpload(assetId: string, e: Event) {
    const files = (e.target as HTMLInputElement).files;
    if (!files || files.length === 0) return;
    dispatch('uploadImages', { assetId, files });
    (e.target as HTMLInputElement).value = '';
  }

  function blobUrl(blob: Blob) {
    return URL.createObjectURL(blob);
  }
</script>

<div class="asset-panel">
  <h3>Assets</h3>

  <div class="create-row">
    <input bind:value={newName} placeholder="Asset name" on:keydown={e => e.key === 'Enter' && handleCreate()} />
    <select bind:value={newType}>
      <option value="character">Character</option>
      <option value="background">Background</option>
    </select>
    <button on:click={handleCreate}>+ Add</button>
  </div>

  <ul class="asset-list">
    {#each assets as asset (asset.id)}
      <li class="asset-item">
        <button class="asset-header" on:click={() => expandedId = expandedId === asset.id ? null : asset.id}>
          <span class="asset-type-badge {asset.type}">{asset.type[0].toUpperCase()}</span>
          <span class="asset-name">{asset.name}</span>
          <span class="icon-btn danger" role="button" tabindex="0"
            on:click|stopPropagation={() => dispatch('deleteAsset', { assetId: asset.id })}
            on:keydown={e => e.key === 'Enter' && dispatch('deleteAsset', { assetId: asset.id })}>✕</span>
        </button>

        {#if expandedId === asset.id}
          <div class="asset-images">
            {#each asset.images as img (img.id)}
              <div class="thumb-wrap">
                <img src={blobUrl(img.blob)} alt={img.name} class="thumb" />
                <span class="thumb-label">{img.name}</span>
                <button class="icon-btn danger thumb-del" on:click={() => dispatch('deleteImage', { assetId: asset.id, imageId: img.id })}>✕</button>
              </div>
            {/each}

            <label class="upload-btn">
              + Upload
              <input type="file" accept="image/*" multiple on:change={e => handleUpload(asset.id, e)} hidden />
            </label>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .asset-panel { display: flex; flex-direction: column; gap: 8px; padding: 8px; overflow-y: auto; color: #e0e0f0; }
  h3 { margin: 0 0 4px; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.05em; color: #9090b0; }
  .create-row { display: flex; gap: 4px; }
  .create-row input { flex: 1; min-width: 0; color: #e0e0f0; }
  .asset-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .asset-item { background: #22223a; border-radius: 4px; overflow: hidden; }
  .asset-header { display: flex; align-items: center; gap: 6px; padding: 6px 8px; cursor: pointer; user-select: none; width: 100%; background: none; border: none; color: #e0e0f0; text-align: left; }
  .asset-header:hover { background: #2e2e4a; }
  .asset-type-badge { font-size: 0.65rem; font-weight: bold; padding: 1px 4px; border-radius: 3px; }
  .asset-type-badge.character { background: #2a4a7a; color: #b0d4f0; }
  .asset-type-badge.background { background: #2a5a3a; color: #a0d4b0; }
  .asset-name { flex: 1; font-size: 0.85rem; color: #e0e0f0; }
  .icon-btn { background: none; border: none; cursor: pointer; padding: 2px 4px; border-radius: 3px; color: #7070a0; }
  .icon-btn:hover { color: #c0c0e0; }
  .icon-btn.danger:hover { background: #7a2020; color: #fff; }
  .asset-images { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 8px 8px; border-top: 1px solid #16162a; }
  .thumb-wrap { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .thumb { width: 48px; height: 48px; object-fit: contain; image-rendering: pixelated; background: #111; border-radius: 2px; }
  .thumb-label { font-size: 0.6rem; color: #9090b0; max-width: 52px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .thumb-del { position: absolute; top: -4px; right: -4px; font-size: 0.6rem; background: #7a2020; color: #fff; border-radius: 50%; width: 14px; height: 14px; padding: 0; display: flex; align-items: center; justify-content: center; }
  .upload-btn { display: flex; align-items: center; justify-content: center; width: 48px; height: 48px; background: #1a1a30; border: 1px dashed #4a4a6a; border-radius: 4px; cursor: pointer; font-size: 0.7rem; color: #8080a0; text-align: center; }
  .upload-btn:hover { border-color: #9090cc; color: #e0e0f0; }
</style>
