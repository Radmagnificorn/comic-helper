<script lang="ts">
  import { onMount } from 'svelte';
  import type { Project, Frame, Asset } from './types';
  import {
    getProjects, saveProject, deleteProject,
    getFrames, saveFrame, deleteFrame,
    getAssets, saveAsset, deleteAsset, deleteAssetImage,
  } from './db';
  import ProjectScreen from './lib/ProjectScreen.svelte';
  import AssetPanel from './lib/AssetPanel.svelte';
  import FrameInspector from './lib/FrameInspector.svelte';
  import CanvasComposer from './lib/CanvasComposer.svelte';

  // ── State ────────────────────────────────────────────
  let projects: Project[] = [];
  let currentProject: Project | null = null;
  let frames: Frame[] = [];
  let assets: Asset[] = [];
  let selectedFrameId: string | null = null;
  /** id of the frame whose background is currently being adjusted */
  let bgAdjustFrameId: string | null = null;

  // Bottom drawer — only one panel visible at a time
  type DrawerTab = 'inspector' | 'assets' | null;
  let activeDrawer: DrawerTab = null;
  function toggleDrawer(t: Exclude<DrawerTab, null>) {
    activeDrawer = activeDrawer === t ? null : t;
  }

  let composerRef: CanvasComposer;

  $: currentFrame = frames.find(f => f.id === selectedFrameId) ?? null;
  $: currentFrameIndex = currentFrame ? frames.findIndex(f => f.id === currentFrame.id) : -1;

  // Auto-open the inspector when a frame becomes selected
  function handleSelectFrame(id: string) {
    selectedFrameId = id;
    if (activeDrawer === null) activeDrawer = 'inspector';
    // Selecting a different frame exits adjust mode
    if (bgAdjustFrameId && bgAdjustFrameId !== id) bgAdjustFrameId = null;
  }

  function handleAdjustBackground(e: CustomEvent<{ id: string | null }>) {
    bgAdjustFrameId = e.detail.id;
  }

  // ── Boot ───────────────────────────────────────────────────────
  onMount(async () => {
    projects = await getProjects();
  });

  // ── Project ops ────────────────────────────────────────────────
  async function openProject(id: string) {
    const p = projects.find(pr => pr.id === id);
    if (!p) return;
    currentProject = p;
    [frames, assets] = await Promise.all([getFrames(p.frameIds), getAssets(p.assetIds)]);
    selectedFrameId = frames[0]?.id ?? null;
  }

  async function createProject(e: CustomEvent<{ name: string; canvasWidth: number; bgColor: string }>) {
    const { name, canvasWidth, bgColor } = e.detail;
    const id = crypto.randomUUID();
    const p: Project = { id, name, canvasWidth, bgColor, frameIds: [], assetIds: [], createdAt: Date.now(), updatedAt: Date.now() };
    await saveProject(p);
    projects = [...projects, p];
    await openProject(id);
  }

  async function handleDeleteProject(e: CustomEvent<{ id: string }>) {
    await deleteProject(e.detail.id);
    projects = projects.filter(p => p.id !== e.detail.id);
  }

  function closeProject() {
    currentProject = null;
    frames = [];
    assets = [];
    selectedFrameId = null;
  }

  // ── Frame ops ──────────────────────────────────────────────────
  async function addFrame() {
    if (!currentProject) return;
    const id = crypto.randomUUID();
    const f: Frame = {
      id,
      label: `Frame ${frames.length + 1}`,
      width: currentProject.canvasWidth,
      height: 192,
      bgColor: currentProject.bgColor,
      background: null,
      layers: [],
    };
    await saveFrame(f);
    frames = [...frames, f];
    const updated: Project = { ...currentProject, frameIds: [...currentProject.frameIds, id], updatedAt: Date.now() };
    await saveProject(updated);
    currentProject = updated;
    selectedFrameId = id;
  }

  async function handleDeleteFrame(e: CustomEvent<{ id: string }>) {
    if (!currentProject) return;
    const id = e.detail.id;
    await deleteFrame(id);
    frames = frames.filter(f => f.id !== id);
    const updated: Project = { ...currentProject, frameIds: currentProject.frameIds.filter(i => i !== id), updatedAt: Date.now() };
    await saveProject(updated);
    currentProject = updated;
    if (selectedFrameId === id) selectedFrameId = frames[0]?.id ?? null;
  }

  async function handleMoveFrame(e: CustomEvent<{ id: string; direction: 'up' | 'down' }>) {
    if (!currentProject) return;
    const { id, direction } = e.detail;
    const idx = frames.findIndex(f => f.id === id);
    if (idx < 0) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= frames.length) return;
    const arr = [...frames];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    frames = arr;
    const updated: Project = { ...currentProject, frameIds: arr.map(f => f.id), updatedAt: Date.now() };
    await saveProject(updated);
    currentProject = updated;
  }

  async function handleFrameChange(e: CustomEvent<{ frame: Frame }>) {
    const updated = e.detail.frame;
    await saveFrame(updated);
    frames = frames.map(f => f.id === updated.id ? updated : f);
  }

  async function handleResizeFrame(e: CustomEvent<{ id: string; height: number }>) {
    const frame = frames.find(f => f.id === e.detail.id);
    if (!frame) return;
    const updated: Frame = { ...frame, height: e.detail.height };
    await saveFrame(updated);
    frames = frames.map(f => f.id === updated.id ? updated : f);
  }

  async function handleRecolorFrame(e: CustomEvent<{ id: string; bgColor: string }>) {
    const frame = frames.find(f => f.id === e.detail.id);
    if (!frame) return;
    const updated: Frame = { ...frame, bgColor: e.detail.bgColor };
    await saveFrame(updated);
    frames = frames.map(f => f.id === updated.id ? updated : f);
  }

  // ── Asset ops ──────────────────────────────────────────────────
  async function handleCreateAsset(e: CustomEvent<{ name: string; type: 'character' | 'background' }>) {
    if (!currentProject) return;
    const id = crypto.randomUUID();
    const asset: Asset = { id, name: e.detail.name, type: e.detail.type, images: [] };
    await saveAsset(asset);
    assets = [...assets, asset];
    const updated: Project = { ...currentProject, assetIds: [...currentProject.assetIds, id], updatedAt: Date.now() };
    await saveProject(updated);
    currentProject = updated;
  }

  async function handleUploadImages(e: CustomEvent<{ assetId: string; files: FileList }>) {
    const { assetId, files } = e.detail;
    const asset = assets.find(a => a.id === assetId);
    if (!asset) return;
    const newImages = await Promise.all(
      Array.from(files).map(async file => ({
        id: crypto.randomUUID(),
        name: file.name.replace(/\.[^.]+$/, ''),
        blob: file,
      }))
    );
    const updated: Asset = { ...asset, images: [...asset.images, ...newImages] };
    await saveAsset(updated);
    assets = assets.map(a => a.id === assetId ? updated : a);
  }

  async function handleDeleteImage(e: CustomEvent<{ assetId: string; imageId: string }>) {
    const { assetId, imageId } = e.detail;
    await deleteAssetImage(imageId);
    assets = assets.map(a =>
      a.id === assetId ? { ...a, images: a.images.filter(i => i.id !== imageId) } : a
    );
  }

  async function handleDeleteAsset(e: CustomEvent<{ assetId: string }>) {
    if (!currentProject) return;
    const { assetId } = e.detail;
    await deleteAsset(assetId);
    assets = assets.filter(a => a.id !== assetId);
    const updated: Project = { ...currentProject, assetIds: currentProject.assetIds.filter(i => i !== assetId), updatedAt: Date.now() };
    await saveProject(updated);
    currentProject = updated;
  }

  // ── Export ─────────────────────────────────────────────────────
  function exportComic() {
    if (!composerRef) return;
    const dataUrl = composerRef.exportPng();
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${currentProject?.name ?? 'comic'}.png`;
    a.click();
  }
</script>

{#if !currentProject}
  <ProjectScreen
    {projects}
    on:open={e => openProject(e.detail.id)}
    on:create={createProject}
    on:delete={handleDeleteProject}
  />
{:else}
  <div class="app-shell">
    <header class="topbar">
      <button class="back-btn" on:click={closeProject} title="Projects">←</button>
      <span class="project-title">{currentProject.name}</span>
      <button class="add-btn" on:click={addFrame} title="Add frame">+ Frame</button>
      <button class="export-btn" on:click={exportComic} disabled={frames.length === 0}>Export</button>
    </header>

    <main class="canvas-area">
      {#if frames.length > 0}
        <CanvasComposer
          bind:this={composerRef}
          {frames}
          {assets}
          {selectedFrameId}
          {bgAdjustFrameId}
          on:change={handleFrameChange}
          on:resize={handleResizeFrame}
          on:select={e => handleSelectFrame(e.detail.id)}
        />
      {:else}
        <div class="no-frame">
          <p>No frames yet.</p>
          <button on:click={addFrame}>+ Add first frame</button>
        </div>
      {/if}
    </main>

    {#if activeDrawer}
      <section class="drawer">
        <header class="drawer-header">
          <span class="drawer-title">
            {#if activeDrawer === 'inspector'}
              Inspector{currentFrame ?  ' — ' + (currentFrame.label || 'Frame') : ''}
            {:else}
              Assets
            {/if}
          </span>
          <button class="drawer-close" on:click={() => activeDrawer = null} title="Close">✕</button>
        </header>
        <div class="drawer-body">
          {#if activeDrawer === 'inspector'}
            <FrameInspector
              frame={currentFrame}
              {assets}
              frameIndex={currentFrameIndex}
              frameCount={frames.length}
              {bgAdjustFrameId}
              on:change={handleFrameChange}
              on:delete={handleDeleteFrame}
              on:move={handleMoveFrame}
              on:adjustBackground={handleAdjustBackground}
            />
          {:else if activeDrawer === 'assets'}
            <AssetPanel
              {assets}
              on:createAsset={handleCreateAsset}
              on:uploadImages={handleUploadImages}
              on:deleteImage={handleDeleteImage}
              on:deleteAsset={handleDeleteAsset}
            />
          {/if}
        </div>
      </section>
    {/if}

    <nav class="tabbar">
      <button class="tab" class:active={activeDrawer === 'inspector'} on:click={() => toggleDrawer('inspector')}>
        <span class="tab-icon">✎</span><span class="tab-label">Frame</span>
      </button>
      <button class="tab" class:active={activeDrawer === 'assets'} on:click={() => toggleDrawer('assets')}>
        <span class="tab-icon">▣</span><span class="tab-label">Assets</span>
      </button>
    </nav>
  </div>
{/if}

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; }
  :global(html, body) { margin: 0; height: 100%; background: #12121f; color: #e0e0f0; font-family: system-ui, sans-serif; }
  /* Form elements need explicit colors — browsers don't reliably inherit on all platforms */
  :global(input, select, textarea) {
    color: #e0e0f0;
    background: #1e1e32;
    border: 1px solid #4a4a6a;
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 0.85rem;
  }
  :global(input::placeholder) { color: #6a6a8a; }
  :global(select option) { background: #1e1e32; color: #e0e0f0; }
  :global(button) {
    color: #e0e0f0;
    background: #2a2a46;
    border: 1px solid #4a4a6a;
    border-radius: 4px;
    padding: 4px 10px;
    font-size: 0.85rem;
    cursor: pointer;
  }
  :global(button:hover:not(:disabled)) { background: #35356a; border-color: #7070cc; }
  :global(button:disabled) { opacity: 0.4; cursor: default; }

  .app-shell { display: flex; flex-direction: column; height: 100vh; overflow: hidden; }
  .topbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #1a1a2e; border-bottom: 1px solid #333; flex-shrink: 0; }
  .back-btn { background: none; border: none; color: #aaa; font-size: 1.1rem; padding: 4px 8px; }
  .back-btn:hover { color: #fff; background: none; border-color: transparent; }
  .project-title { flex: 1; font-weight: 600; color: #e0e0f0; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .add-btn { background: #22223a; border-color: #4a4a6a; color: #c0c0e0; font-size: 0.78rem; }
  .add-btn:hover:not(:disabled) { background: #35356a; border-color: #7070cc; color: #fff; }
  .export-btn { background: #1e4a2e; border-color: #3a8a5a; color: #aef0c0; }
  .export-btn:hover:not(:disabled) { background: #2a6a3e; border-color: #5ab87a; }

  .canvas-area { flex: 1; min-width: 0; min-height: 0; overflow: hidden; background: #0f0f1e; display: flex; flex-direction: column; }

  /* Bottom drawer */
  .drawer { flex-shrink: 0; max-height: 25vh; min-height: 160px; display: flex; flex-direction: column;
    background: #16162a; border-top: 1px solid #2a2a40; box-shadow: 0 -4px 16px rgba(0,0,0,0.3); }
  .drawer-header { display: flex; align-items: center; justify-content: space-between;
    padding: 6px 12px; background: #1a1a2e; border-bottom: 1px solid #2a2a40; flex-shrink: 0; }
  .drawer-title { font-size: 0.85rem; font-weight: 600; color: #c0c0e0; }
  .drawer-close { background: none; border: none; color: #8080a0; font-size: 1rem; padding: 2px 8px; }
  .drawer-close:hover { color: #fff; background: none; border-color: transparent; }
  .drawer-body { flex: 1; overflow-y: auto; }

  /* Bottom tab bar */
  .tabbar { display: flex; flex-shrink: 0; background: #16162a; border-top: 1px solid #2a2a40;
    padding-bottom: env(safe-area-inset-bottom, 0); }
  .tab { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;
    background: none; border: none; border-radius: 0; padding: 6px 4px;
    color: #7070a0; font-size: 0.7rem; }
  .tab:hover:not(:disabled) { background: #1e1e35; color: #c0c0e0; border-color: transparent; }
  .tab.active { color: #a0a0ff; background: #1a1a35; }
  .tab.active::before { content: ''; position: absolute; }
  .tab-icon { font-size: 1.1rem; line-height: 1; }
  .tab-label { font-size: 0.7rem; letter-spacing: 0.02em; }

  .no-frame { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; color: #6a6a9a; width: 100%; }
</style>
