<script lang="ts">
  import { onMount } from 'svelte';
  import type { Project, Frame, Asset, AssetLibrary, FrameLayer, SpeechBubble } from './types';
  import {
    getProjects, saveProject, deleteProject,
    getFrames, saveFrame, deleteFrame,
    getAssets, saveAsset, deleteAsset, deleteAssetImage,
    getAssetLibraries, saveAssetLibrary, deleteAssetLibrary,
  } from './db';
  import ProjectScreen from './lib/ProjectScreen.svelte';
  import AssetPanel from './lib/AssetPanel.svelte';
  import FrameInspector from './lib/FrameInspector.svelte';
  import CanvasComposer from './lib/CanvasComposer.svelte';

  // ── State ────────────────────────────────────────────
  let projects: Project[] = [];
  let currentProject: Project | null = null;
  let frames: Frame[] = [];
  /** Project-private assets only. */
  let projectAssets: Asset[] = [];
  /** All known libraries (loaded once on boot). */
  let libraries: AssetLibrary[] = [];
  /** Assets belonging to libraries attached to the current project, keyed by libraryId. */
  let libraryAssets: Record<string, Asset[]> = {};
  /** Combined asset list passed down to the canvas + inspector. */
  $: assets = [
    ...projectAssets,
    ...Object.values(libraryAssets).flat(),
  ];
  let selectedFrameId: string | null = null;
  /** id of the frame whose background is currently being adjusted */
  let bgAdjustFrameId: string | null = null;

  // Bottom drawer — only one panel visible at a time
  type DrawerTab = 'inspector' | 'assets' | null;
  let activeDrawer: DrawerTab = null;
  function toggleDrawer(t: Exclude<DrawerTab, null>) {
    activeDrawer = activeDrawer === t ? null : t;
  }

  // ── Drawer height (user-resizable, persisted) ──────────────────
  const DRAWER_MIN = 120;
  const DRAWER_MAX_VH_FRACTION = 0.8; // never let the drawer eat more than 80% of the viewport
  const DRAWER_HEIGHT_KEY = 'comic-helper:drawerHeight';
  let drawerHeight = 220;
  if (typeof localStorage !== 'undefined') {
    const stored = Number(localStorage.getItem(DRAWER_HEIGHT_KEY));
    if (Number.isFinite(stored) && stored >= DRAWER_MIN) drawerHeight = stored;
  }
  function clampDrawerHeight(h: number): number {
    const max = typeof window !== 'undefined'
      ? Math.max(DRAWER_MIN, Math.floor(window.innerHeight * DRAWER_MAX_VH_FRACTION))
      : 800;
    return Math.max(DRAWER_MIN, Math.min(max, Math.round(h)));
  }
  function startDrawerResize(e: PointerEvent) {
    // Only handle primary pointer (left mouse / first touch).
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = drawerHeight;
    const target = e.currentTarget as HTMLElement;
    const onMove = (ev: PointerEvent) => {
      // Drag up = bigger drawer, drag down = smaller drawer.
      drawerHeight = clampDrawerHeight(startH + (startY - ev.clientY));
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      try { target.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(DRAWER_HEIGHT_KEY, String(drawerHeight));
      }
    };
    try { target.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  let composerRef: CanvasComposer;
  let inspectorRef: FrameInspector | null = null;

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

  function handleEditBubble(frameId: string, bubbleId: string) {
    selectedFrameId = frameId;
    activeDrawer = 'inspector';
    // Wait for the inspector to mount/update before focusing.
    requestAnimationFrame(() => inspectorRef?.focusBubble(bubbleId));
  }

  // ── Boot ───────────────────────────────────────────────────────
  onMount(async () => {
    [projects, libraries] = await Promise.all([getProjects(), getAssetLibraries()]);
  });

  // ── Project ops ────────────────────────────────────────────────
  async function openProject(id: string) {
    const p = projects.find(pr => pr.id === id);
    if (!p) return;
    currentProject = p;
    const attachedLibIds = p.libraryIds ?? [];
    const [loadedFrames, loadedProjectAssets, ...loadedLibAssets] = await Promise.all([
      getFrames(p.frameIds),
      getAssets(p.assetIds),
      ...attachedLibIds.map(libId => {
        const lib = libraries.find(l => l.id === libId);
        return getAssets(lib?.assetIds ?? []);
      }),
    ]);
    frames = loadedFrames;
    projectAssets = loadedProjectAssets;
    libraryAssets = Object.fromEntries(attachedLibIds.map((id, i) => [id, loadedLibAssets[i]]));
    selectedFrameId = frames[0]?.id ?? null;
  }

  async function createProject(e: CustomEvent<{ name: string; canvasWidth: number; bgColor: string }>) {
    const { name, canvasWidth, bgColor } = e.detail;
    const id = crypto.randomUUID();
    const p: Project = { id, name, canvasWidth, bgColor, frameIds: [], assetIds: [], libraryIds: [], createdAt: Date.now(), updatedAt: Date.now() };
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
    projectAssets = [];
    libraryAssets = {};
    selectedFrameId = null;
  }

  /**
   * Replace `currentProject` with a new value AND mirror the change into the
   * `projects` array. Without this, mutating currentProject (e.g. attaching a
   * library, adding a frame, creating an asset) would not be reflected if the
   * user closes and re-opens the project within the same session — the stale
   * entry in `projects` would be reloaded by `openProject`, and any newly
   * attached libraries / project-private assets / frames would appear to be
   * lost until a full page reload re-read them from IndexedDB.
   */
  function setCurrentProject(updated: Project) {
    currentProject = updated;
    projects = projects.map(p => p.id === updated.id ? updated : p);
  }

  // ── Frame ops ──────────────────────────────────────────────────
  async function addFrame() {
    if (!currentProject) return;
    const id = crypto.randomUUID();
    const f: Frame = {
      id,
      width: currentProject.canvasWidth,
      height: 192,
      background: null,
      layers: [],
    };
    await saveFrame(f);
    frames = [...frames, f];
    const updated: Project = { ...currentProject, frameIds: [...currentProject.frameIds, id], updatedAt: Date.now() };
    await saveProject(updated);
    setCurrentProject(updated);
    selectedFrameId = id;
  }

  async function handleDeleteFrame(e: CustomEvent<{ id: string }>) {
    if (!currentProject) return;
    const id = e.detail.id;
    await deleteFrame(id);
    frames = frames.filter(f => f.id !== id);
    const updated: Project = { ...currentProject, frameIds: currentProject.frameIds.filter(i => i !== id), updatedAt: Date.now() };
    await saveProject(updated);
    setCurrentProject(updated);
    if (selectedFrameId === id) selectedFrameId = frames[0]?.id ?? null;
  }

  async function handleDuplicateFrame(e: CustomEvent<{ id: string }>) {
    if (!currentProject) return;
    const id = e.detail.id;
    const idx = frames.findIndex(f => f.id === id);
    if (idx < 0) return;
    const src = frames[idx];
    const dup: Frame = {
      ...src,
      id: crypto.randomUUID(),
      background: src.background ? { ...src.background, mask: src.background.mask ? { ...src.background.mask } : null } : null,
      layers: src.layers.map(l => ({ ...l, id: crypto.randomUUID() })),
      bubbles: src.bubbles?.map(b => ({ ...b, id: crypto.randomUUID() })),
    };
    await saveFrame(dup);
    const arr = [...frames];
    arr.splice(idx + 1, 0, dup);
    frames = arr;
    const updated: Project = { ...currentProject, frameIds: arr.map(f => f.id), updatedAt: Date.now() };
    await saveProject(updated);
    setCurrentProject(updated);
    selectedFrameId = dup.id;
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
    setCurrentProject(updated);
  }

  async function handleFrameChange(e: CustomEvent<{ frame: Frame }>) {
    const updated = e.detail.frame;
    const prev = frames.find(f => f.id === updated.id);
    await saveFrame(updated);
    frames = frames.map(f => f.id === updated.id ? updated : f);
    // Clean up any ephemeral one-off assets whose layer was just removed.
    if (prev && currentProject) {
      const removedAssetIds = prev.layers
        .filter(l => !updated.layers.some(u => u.id === l.id))
        .map(l => l.assetId);
      for (const aid of removedAssetIds) {
        const asset = projectAssets.find(a => a.id === aid);
        if (!asset?.ephemeral) continue;
        // Should be unused now; double-check across all frames just in case.
        const stillUsed = frames.some(fr => fr.layers.some(l => l.assetId === aid));
        if (stillUsed) continue;
        await deleteAsset(aid);
        projectAssets = projectAssets.filter(a => a.id !== aid);
        const proj: Project = { ...currentProject, assetIds: currentProject.assetIds.filter(i => i !== aid), updatedAt: Date.now() };
        await saveProject(proj);
        setCurrentProject(proj);
      }
    }
  }

  async function handleResizeFrame(e: CustomEvent<{ id: string; height: number }>) {
    const frame = frames.find(f => f.id === e.detail.id);
    if (!frame) return;
    const updated: Frame = { ...frame, height: e.detail.height };
    await saveFrame(updated);
    frames = frames.map(f => f.id === updated.id ? updated : f);
  }

  // ── Asset ops ──────────────────────────────────────────────────
  /** Look up which container an existing asset id belongs to. Returns null
   * for project-private assets, the libraryId for library-owned assets, or
   * undefined if not found. */
  function findAssetContainer(assetId: string): string | null | undefined {
    if (projectAssets.some(a => a.id === assetId)) return null;
    for (const [libId, list] of Object.entries(libraryAssets)) {
      if (list.some(a => a.id === assetId)) return libId;
    }
    return undefined;
  }

  async function handleCreateAsset(e: CustomEvent<{ name: string; type: 'character' | 'background'; libraryId: string | null }>) {
    if (!currentProject) return;
    const { name, type, libraryId } = e.detail;
    const id = crypto.randomUUID();
    const asset: Asset = { id, name, type, images: [] };
    await saveAsset(asset);
    if (libraryId === null) {
      projectAssets = [...projectAssets, asset];
      const updated: Project = { ...currentProject, assetIds: [...currentProject.assetIds, id], updatedAt: Date.now() };
      await saveProject(updated);
      setCurrentProject(updated);
    } else {
      const lib = libraries.find(l => l.id === libraryId);
      if (!lib) return;
      const updatedLib: AssetLibrary = { ...lib, assetIds: [...lib.assetIds, id], updatedAt: Date.now() };
      await saveAssetLibrary(updatedLib);
      libraries = libraries.map(l => l.id === libraryId ? updatedLib : l);
      libraryAssets = { ...libraryAssets, [libraryId]: [...(libraryAssets[libraryId] ?? []), asset] };
    }
  }

  async function handleUploadImages(e: CustomEvent<{ assetId: string; files: FileList }>) {
    const { assetId, files } = e.detail;
    const container = findAssetContainer(assetId);
    if (container === undefined) return;
    const sourceList = container === null ? projectAssets : (libraryAssets[container] ?? []);
    const asset = sourceList.find(a => a.id === assetId);
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
    if (container === null) {
      projectAssets = projectAssets.map(a => a.id === assetId ? updated : a);
    } else {
      libraryAssets = { ...libraryAssets, [container]: (libraryAssets[container] ?? []).map(a => a.id === assetId ? updated : a) };
    }
  }

  async function handleDeleteImage(e: CustomEvent<{ assetId: string; imageId: string }>) {
    const { assetId, imageId } = e.detail;
    await deleteAssetImage(imageId);
    const container = findAssetContainer(assetId);
    if (container === null) {
      projectAssets = projectAssets.map(a =>
        a.id === assetId ? { ...a, images: a.images.filter(i => i.id !== imageId) } : a
      );
    } else if (container) {
      libraryAssets = { ...libraryAssets, [container]: (libraryAssets[container] ?? []).map(a =>
        a.id === assetId ? { ...a, images: a.images.filter(i => i.id !== imageId) } : a
      ) };
    }
  }

  async function handleDeleteAsset(e: CustomEvent<{ assetId: string }>) {
    if (!currentProject) return;
    const { assetId } = e.detail;
    const container = findAssetContainer(assetId);
    if (container === undefined) return;
    await deleteAsset(assetId);
    if (container === null) {
      projectAssets = projectAssets.filter(a => a.id !== assetId);
      const updated: Project = { ...currentProject, assetIds: currentProject.assetIds.filter(i => i !== assetId), updatedAt: Date.now() };
      await saveProject(updated);
      setCurrentProject(updated);
    } else {
      const lib = libraries.find(l => l.id === container);
      if (lib) {
        const updatedLib: AssetLibrary = { ...lib, assetIds: lib.assetIds.filter(i => i !== assetId), updatedAt: Date.now() };
        await saveAssetLibrary(updatedLib);
        libraries = libraries.map(l => l.id === container ? updatedLib : l);
      }
      libraryAssets = { ...libraryAssets, [container]: (libraryAssets[container] ?? []).filter(a => a.id !== assetId) };
    }
  }

  // ── Asset library ops ──────────────────────────────────────────
  async function handleCreateLibrary(e: CustomEvent<{ name: string }>) {
    if (!currentProject) return;
    const id = crypto.randomUUID();
    const lib: AssetLibrary = { id, name: e.detail.name, assetIds: [], createdAt: Date.now(), updatedAt: Date.now() };
    await saveAssetLibrary(lib);
    libraries = [...libraries, lib];
    // Auto-attach the freshly created library to the current project so the
    // user can immediately add assets to it.
    const updated: Project = { ...currentProject, libraryIds: [...(currentProject.libraryIds ?? []), id], updatedAt: Date.now() };
    await saveProject(updated);
    setCurrentProject(updated);
    libraryAssets = { ...libraryAssets, [id]: [] };
  }

  async function handleAttachLibrary(e: CustomEvent<{ libraryId: string }>) {
    if (!currentProject) return;
    const { libraryId } = e.detail;
    if ((currentProject.libraryIds ?? []).includes(libraryId)) return;
    const lib = libraries.find(l => l.id === libraryId);
    if (!lib) return;
    const loaded = await getAssets(lib.assetIds);
    const updated: Project = { ...currentProject, libraryIds: [...(currentProject.libraryIds ?? []), libraryId], updatedAt: Date.now() };
    await saveProject(updated);
    setCurrentProject(updated);
    libraryAssets = { ...libraryAssets, [libraryId]: loaded };
  }

  async function handleDetachLibrary(e: CustomEvent<{ libraryId: string }>) {
    if (!currentProject) return;
    const { libraryId } = e.detail;
    const updated: Project = { ...currentProject, libraryIds: (currentProject.libraryIds ?? []).filter(id => id !== libraryId), updatedAt: Date.now() };
    await saveProject(updated);
    setCurrentProject(updated);
    const next = { ...libraryAssets };
    delete next[libraryId];
    libraryAssets = next;
  }

  async function handleDeleteLibrary(e: CustomEvent<{ libraryId: string }>) {
    const { libraryId } = e.detail;
    await deleteAssetLibrary(libraryId);
    libraries = libraries.filter(l => l.id !== libraryId);
    const next = { ...libraryAssets };
    delete next[libraryId];
    libraryAssets = next;
    if (currentProject && (currentProject.libraryIds ?? []).includes(libraryId)) {
      const updated: Project = { ...currentProject, libraryIds: (currentProject.libraryIds ?? []).filter(id => id !== libraryId), updatedAt: Date.now() };
      setCurrentProject(updated);
    }
    // Other projects in `projects` may still reference the deleted library;
    // db.deleteAssetLibrary already detached them in IDB. Reflect that here.
    projects = projects.map(p => (p.libraryIds ?? []).includes(libraryId)
      ? { ...p, libraryIds: (p.libraryIds ?? []).filter(id => id !== libraryId) }
      : p);
  }

  // ── Export ─────────────────────────────────────────────────────
  /** PNG export scale: 1 = native, 4 / 8 = nearest-neighbor upscale */
  let exportScale: 1 | 4 | 8 = 1;
  function exportComic() {
    if (!composerRef) return;
    const dataUrl = composerRef.exportPng(exportScale);
    const a = document.createElement('a');
    a.href = dataUrl;
    const suffix = exportScale > 1 ? `@${exportScale}x` : '';
    a.download = `${currentProject?.name ?? 'comic'}${suffix}.png`;
    a.click();
  }

  // ── Topbar quick actions ───────────────────────────────────────
  // Background assets are only ever set as a frame's background (via the
  // FrameInspector), never added as scene layers, so the quick-add only
  // exposes character assets here.
  $: characterAssets = assets.filter(a => a.type === 'character');
  let quickAssetSelection = '';

  function quickToggleBgMove() {
    if (!currentFrame || !currentFrame.background) return;
    bgAdjustFrameId = bgAdjustFrameId === currentFrame.id ? null : currentFrame.id;
  }

  async function quickAddCharacter(assetId: string) {
    quickAssetSelection = '';
    if (!currentFrame || !assetId) return;
    if (assetId === '__upload__') {
      quickUploadInput?.click();
      return;
    }
    const asset = assets.find(a => a.id === assetId);
    if (!asset || asset.type !== 'character' || asset.images.length === 0) return;
    const newLayer: FrameLayer = {
      id: crypto.randomUUID(),
      assetId: asset.id,
      imageId: asset.images[0].id,
      x: 0, y: 0,
    };
    const updated: Frame = { ...currentFrame, layers: [...currentFrame.layers, newLayer] };
    await saveFrame(updated);
    frames = frames.map(f => f.id === updated.id ? updated : f);
  }

  let quickUploadInput: HTMLInputElement | null = null;
  async function onQuickUploadFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !currentFrame || !currentProject) return;
    const assetId = crypto.randomUUID();
    const imageId = crypto.randomUUID();
    const asset: Asset = {
      id: assetId,
      name: file.name.replace(/\.[^.]+$/, '') || 'One-off',
      type: 'character',
      images: [{ id: imageId, name: 'image', blob: file }],
      ephemeral: true,
    };
    await saveAsset(asset);
    projectAssets = [...projectAssets, asset];
    const proj: Project = { ...currentProject, assetIds: [...currentProject.assetIds, assetId], updatedAt: Date.now() };
    await saveProject(proj);
    setCurrentProject(proj);
    const newLayer: FrameLayer = {
      id: crypto.randomUUID(),
      assetId, imageId,
      x: 0, y: 0,
    };
    const updated: Frame = { ...currentFrame, layers: [...currentFrame.layers, newLayer] };
    await saveFrame(updated);
    frames = frames.map(f => f.id === updated.id ? updated : f);
  }

  async function quickAddBubble() {
    if (!currentFrame) return;
    const bubble: SpeechBubble = {
      id: crypto.randomUUID(),
      text: 'Hello!',
      x: 4, y: 4,
      fontSize: 10,
      tailX: 12, tailY: 30,
    };
    const updated: Frame = { ...currentFrame, bubbles: [...(currentFrame.bubbles ?? []), bubble] };
    await saveFrame(updated);
    frames = frames.map(f => f.id === updated.id ? updated : f);
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
      <span class="qa-divider"></span>
      <button
        class="qa-btn"
        class:active={bgAdjustFrameId !== null && bgAdjustFrameId === selectedFrameId}
        on:click={quickToggleBgMove}
        disabled={!currentFrame || !currentFrame.background}
        title="Toggle background move mode for selected frame"
      >✥</button>
      <select
        class="qa-select"
        bind:value={quickAssetSelection}
        on:change={() => quickAddCharacter(quickAssetSelection)}
        disabled={!currentFrame}
        title="Add character to selected frame"
      >
        <option value="">⊕ Character</option>
        <option value="__upload__">↑ Upload one-off…</option>
        {#each characterAssets as a (a.id)}
          <option value={a.id}>{a.name}</option>
        {/each}
      </select>
      <input
        type="file"
        accept="image/*"
        bind:this={quickUploadInput}
        on:change={onQuickUploadFile}
        style="display: none;"
      />
      <button
        class="qa-btn"
        on:click={quickAddBubble}
        disabled={!currentFrame}
        title="Add speech bubble to selected frame"
      >…</button>
      <span class="qa-divider"></span>
      <select
        class="export-scale"
        bind:value={exportScale}
        title="Export scale (nearest-neighbor for 4x / 8x)"
        disabled={frames.length === 0}
      >
        <option value={1}>1x</option>
        <option value={4}>4x</option>
        <option value={8}>8x</option>
      </select>
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
          projectBgColor={currentProject.bgColor}
          on:change={handleFrameChange}
          on:resize={handleResizeFrame}
          on:select={e => handleSelectFrame(e.detail.id)}
          on:editbubble={e => handleEditBubble(e.detail.frameId, e.detail.bubbleId)}
        />
      {:else}
        <div class="no-frame">
          <p>No frames yet.</p>
          <button on:click={addFrame}>+ Add first frame</button>
        </div>
      {/if}
    </main>

    {#if activeDrawer}
      <section class="drawer" style="height: {drawerHeight}px;">
        <div
          class="drawer-grip"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize panel"
          on:pointerdown={startDrawerResize}
        ><span class="drawer-grip-handle"></span></div>
        <header class="drawer-header">
          <span class="drawer-title">
            {#if activeDrawer === 'inspector'}
              Inspector{currentFrame && currentFrameIndex >= 0 ? ` — Frame ${currentFrameIndex + 1}` : ''}
            {:else}
              Assets
            {/if}
          </span>
          <button class="drawer-close" on:click={() => activeDrawer = null} title="Close">✕</button>
        </header>
        <div class="drawer-body">
          {#if activeDrawer === 'inspector'}
            <FrameInspector
              bind:this={inspectorRef}
              frame={currentFrame}
              {assets}
              frameIndex={currentFrameIndex}
              frameCount={frames.length}
              {bgAdjustFrameId}
              on:change={handleFrameChange}
              on:delete={handleDeleteFrame}
              on:duplicate={handleDuplicateFrame}
              on:move={handleMoveFrame}
              on:adjustBackground={handleAdjustBackground}
            />
          {:else if activeDrawer === 'assets'}
            <AssetPanel
              {projectAssets}
              attachedLibraries={(currentProject.libraryIds ?? [])
                .map(id => libraries.find(l => l.id === id))
                .filter((l): l is AssetLibrary => !!l)}
              {libraryAssets}
              availableLibraries={libraries.filter(l => !(currentProject?.libraryIds ?? []).includes(l.id))}
              on:createAsset={handleCreateAsset}
              on:uploadImages={handleUploadImages}
              on:deleteImage={handleDeleteImage}
              on:deleteAsset={handleDeleteAsset}
              on:createLibrary={handleCreateLibrary}
              on:attachLibrary={handleAttachLibrary}
              on:detachLibrary={handleDetachLibrary}
              on:deleteLibrary={handleDeleteLibrary}
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
  .qa-btn {
    background: #22223a; border-color: #4a4a6a; color: #c0c0e0;
    font-size: 0.95rem; padding: 2px 8px; min-width: 28px; line-height: 1;
  }
  .qa-btn:hover:not(:disabled) { background: #35356a; border-color: #7070cc; color: #fff; }
  .qa-btn.active { background: #3a3a8a; border-color: #a0a0ff; color: #fff; }
  .qa-select { font-size: 0.78rem; padding: 3px 6px; max-width: 110px; }
  .qa-divider { width: 1px; align-self: stretch; background: #2a2a40; margin: 2px 2px; }
  .export-scale { font-size: 0.78rem; padding: 3px 6px; }
  .export-btn { background: #1e4a2e; border-color: #3a8a5a; color: #aef0c0; }
  .export-btn:hover:not(:disabled) { background: #2a6a3e; border-color: #5ab87a; }

  .canvas-area { flex: 1; min-width: 0; min-height: 0; overflow: hidden; background: #0f0f1e; display: flex; flex-direction: column; }

  /* Bottom drawer */
  .drawer { flex-shrink: 0; min-height: 120px; display: flex; flex-direction: column;
    background: #16162a; border-top: 1px solid #2a2a40; box-shadow: 0 -4px 16px rgba(0,0,0,0.3); }
  .drawer-grip {
    flex-shrink: 0;
    height: 10px;
    cursor: ns-resize;
    display: flex; align-items: center; justify-content: center;
    background: #1a1a2e;
    border-bottom: 1px solid #2a2a40;
    touch-action: none;
    user-select: none;
  }
  .drawer-grip:hover { background: #22223a; }
  .drawer-grip-handle {
    display: block; width: 36px; height: 3px; border-radius: 2px;
    background: #4a4a6a;
  }
  .drawer-grip:hover .drawer-grip-handle { background: #7070cc; }
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
