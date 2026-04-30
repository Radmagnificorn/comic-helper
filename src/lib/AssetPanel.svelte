<!-- AssetPanel.svelte – manage project-private assets and shared libraries -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Asset, AssetLibrary } from '../types';

  /** Assets owned exclusively by the current project. */
  export let projectAssets: Asset[] = [];
  /** Libraries currently attached to the project (in order). */
  export let attachedLibraries: AssetLibrary[] = [];
  /** Loaded assets per attached libraryId. */
  export let libraryAssets: Record<string, Asset[]> = {};
  /** Libraries that exist but are not attached — selectable from the picker. */
  export let availableLibraries: AssetLibrary[] = [];

  const dispatch = createEventDispatcher<{
    createAsset: { name: string; type: 'character' | 'background'; libraryId: string | null };
    uploadImages: { assetId: string; files: FileList };
    deleteImage: { assetId: string; imageId: string };
    deleteAsset: { assetId: string };
    createLibrary: { name: string };
    attachLibrary: { libraryId: string };
    detachLibrary: { libraryId: string };
    deleteLibrary: { libraryId: string };
    moveAssetToLibrary: { assetId: string; libraryId: string };
  }>();

  /** All libraries the asset can be moved into (attached + available). */
  $: allLibraries = [...attachedLibraries, ...availableLibraries];

  function handleMoveToLibrary(assetId: string, e: Event) {
    const sel = e.target as HTMLSelectElement;
    const libraryId = sel.value;
    sel.value = '';
    if (!libraryId) return;
    dispatch('moveAssetToLibrary', { assetId, libraryId });
  }

  // Per-section "add asset" form state, keyed by container id
  // ('__project' for project-private, libraryId otherwise).
  const PROJECT_KEY = '__project';
  let newName: Record<string, string> = {};
  let newType: Record<string, 'character' | 'background'> = {};
  let expandedId: string | null = null;

  // Library management form state
  let newLibraryName = '';
  let attachLibrarySelection = '';

  function containerKey(libraryId: string | null): string {
    return libraryId ?? PROJECT_KEY;
  }

  // Avoid `bind:value={obj[key]}` because Svelte 5's legacy compiler emits
  // an `invalidate_inner_signals` call on every set, which mis-evaluates
  // keyed `{#each}` blocks elsewhere in the template and throws
  // ReferenceErrors. Use explicit setters instead.
  function setNewName(key: string, value: string) {
    newName = { ...newName, [key]: value };
  }
  function setNewType(key: string, value: 'character' | 'background') {
    newType = { ...newType, [key]: value };
  }

  function handleCreate(libraryId: string | null) {
    const key = containerKey(libraryId);
    const name = (newName[key] ?? '').trim();
    if (!name) return;
    const type = newType[key] ?? 'character';
    dispatch('createAsset', { name, type, libraryId });
    newName = { ...newName, [key]: '' };
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

  function handleCreateLibrary() {
    const name = newLibraryName.trim();
    if (!name) return;
    dispatch('createLibrary', { name });
    newLibraryName = '';
  }

  function handleAttachLibrary() {
    if (!attachLibrarySelection) return;
    dispatch('attachLibrary', { libraryId: attachLibrarySelection });
    attachLibrarySelection = '';
  }

  function confirmDeleteLibrary(lib: AssetLibrary) {
    const ok = confirm(`Delete library "${lib.name}" and all of its assets? This affects every project that uses it.`);
    if (ok) dispatch('deleteLibrary', { libraryId: lib.id });
  }
</script>

<div class="asset-panel">
  <!-- ── Project-private assets ───────────────────────────────── -->
  <div class="section-header"><span>Project assets</span></div>

  <div class="create-row">
    <input
      value={newName[PROJECT_KEY] ?? ''}
      on:input={e => setNewName(PROJECT_KEY, (e.target as HTMLInputElement).value)}
      placeholder="Asset name"
      on:keydown={e => e.key === 'Enter' && handleCreate(null)}
    />
    <select
      value={newType[PROJECT_KEY] ?? 'character'}
      on:change={e => setNewType(PROJECT_KEY, (e.target as HTMLSelectElement).value as 'character' | 'background')}
    >
      <option value="character">Character</option>
      <option value="background">Background</option>
    </select>
    <button on:click={() => handleCreate(null)}>+ Add</button>
  </div>

  {#if projectAssets.length === 0}
    <p class="empty small">No project-private assets yet.</p>
  {:else}
    <ul class="asset-list">
      {#each projectAssets as asset (asset.id)}
        <li class="asset-item">
          <div class="asset-header-row">
            <button class="asset-header" on:click={() => expandedId = expandedId === asset.id ? null : asset.id}>
              <span class="asset-type-badge {asset.type}">{asset.type[0].toUpperCase()}</span>
              <span class="asset-name">{asset.name}</span>
            </button>
            {#if allLibraries.length > 0}
              <select
                class="move-select"
                title="Move asset to a shared library"
                on:change={e => handleMoveToLibrary(asset.id, e)}
              >
                <option value="">→ Library…</option>
                {#each allLibraries as targetLib (targetLib.id)}
                  <option value={targetLib.id}>{targetLib.name}</option>
                {/each}
              </select>
            {/if}
            <button class="icon-btn danger"
              on:click={() => dispatch('deleteAsset', { assetId: asset.id })}>✕</button>
          </div>

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
  {/if}

  <!-- ── Attached libraries ──────────────────────────────────── -->
  {#each attachedLibraries as attachedLib (attachedLib.id)}
    <div class="section-header library">
      <span>📚 {attachedLib.name}</span>
      <span class="lib-actions">
        <button class="lib-btn" title="Detach library from this project" on:click={() => dispatch('detachLibrary', { libraryId: attachedLib.id })}>Detach</button>
        <button class="lib-btn danger" title="Permanently delete this library" on:click={() => confirmDeleteLibrary(attachedLib)}>Delete</button>
      </span>
    </div>

    <div class="create-row">
      <input
        value={newName[attachedLib.id] ?? ''}
        on:input={e => setNewName(attachedLib.id, (e.target as HTMLInputElement).value)}
        placeholder="Asset name"
        on:keydown={e => e.key === 'Enter' && handleCreate(attachedLib.id)}
      />
      <select
        value={newType[attachedLib.id] ?? 'character'}
        on:change={e => setNewType(attachedLib.id, (e.target as HTMLSelectElement).value as 'character' | 'background')}
      >
        <option value="character">Character</option>
        <option value="background">Background</option>
      </select>
      <button on:click={() => handleCreate(attachedLib.id)}>+ Add</button>
    </div>

    {#if (libraryAssets[attachedLib.id] ?? []).length === 0}
      <p class="empty small">No assets in this library yet.</p>
    {:else}
      <ul class="asset-list">
        {#each libraryAssets[attachedLib.id] ?? [] as asset (asset.id)}
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
    {/if}
  {/each}

  <!-- ── Library management ──────────────────────────────────── -->
  <div class="section-header"><span>Libraries</span></div>
  <p class="hint-row">Libraries can be attached to multiple projects and are kept when a project is deleted.</p>

  <div class="create-row">
    <input
      bind:value={newLibraryName}
      placeholder="New library name"
      on:keydown={e => e.key === 'Enter' && handleCreateLibrary()}
    />
    <button on:click={handleCreateLibrary}>+ Create library</button>
  </div>

  {#if availableLibraries.length > 0}
    <div class="create-row">
      <select bind:value={attachLibrarySelection}>
        <option value="">Add existing library…</option>
        {#each availableLibraries as availLib (availLib.id)}
          <option value={availLib.id}>{availLib.name} ({availLib.assetIds.length})</option>
        {/each}
      </select>
      <button on:click={handleAttachLibrary} disabled={!attachLibrarySelection}>Attach</button>
    </div>
  {:else if attachedLibraries.length === 0}
    <p class="empty small">No shared libraries yet — create one above.</p>
  {/if}
</div>

<style>
  .asset-panel { display: flex; flex-direction: column; gap: 8px; padding: 8px; overflow-y: auto; color: #e0e0f0; }
  .section-header {
    display: flex; align-items: baseline; justify-content: space-between;
    margin-top: 8px; padding-bottom: 4px;
    border-bottom: 1px solid #33334d;
    font-size: 0.72rem; color: #9090b0;
    text-transform: uppercase; letter-spacing: 0.05em;
  }
  .section-header:first-child { margin-top: 0; }
  .section-header.library { color: #a0a0ff; }
  .lib-actions { display: flex; gap: 4px; }
  .lib-btn { font-size: 0.68rem; padding: 2px 6px; }
  .lib-btn.danger { background: #4a1e1e; border-color: #8a3a3a; color: #f0aeae; }
  .lib-btn.danger:hover:not(:disabled) { background: #6a2a2a; border-color: #b85a5a; }

  .create-row { display: flex; gap: 4px; }
  .create-row input { flex: 1; min-width: 0; color: #e0e0f0; }
  .create-row select { flex: 1; min-width: 0; }
  .empty.small { color: #6a6a8a; font-size: 0.75rem; text-align: center; padding: 6px; margin: 0; }
  .hint-row { color: #6a6a8a; font-size: 0.72rem; margin: 0; line-height: 1.3; }

  .asset-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .asset-item { background: #22223a; border-radius: 4px; overflow: hidden; }
  .asset-header-row { display: flex; align-items: center; gap: 4px; padding-right: 6px; }
  .asset-header { display: flex; align-items: center; gap: 6px; padding: 6px 8px; cursor: pointer; user-select: none; flex: 1; min-width: 0; background: none; border: none; color: #e0e0f0; text-align: left; }
  .asset-header:hover { background: #2e2e4a; }
  .asset-type-badge { font-size: 0.65rem; font-weight: bold; padding: 1px 4px; border-radius: 3px; }
  .asset-type-badge.character { background: #2a4a7a; color: #b0d4f0; }
  .asset-type-badge.background { background: #2a5a3a; color: #a0d4b0; }
  .asset-name { flex: 1; font-size: 0.85rem; color: #e0e0f0; }
  .move-select { font-size: 0.68rem; padding: 1px 2px; max-width: 110px; background: #1a1a2e; color: #c0c0e0; border: 1px solid #4a4a6a; border-radius: 3px; }
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
