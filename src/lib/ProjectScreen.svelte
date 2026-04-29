<!-- ProjectScreen.svelte – create / open a project -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Project } from '../types';

  export let projects: Project[] = [];

  const dispatch = createEventDispatcher<{
    open: { id: string };
    create: { name: string; canvasWidth: number; bgColor: string };
    delete: { id: string };
  }>();

  let newName = '';
  let newWidth = 128;
  let newBgColor = '#ffffff';

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    dispatch('create', { name, canvasWidth: newWidth, bgColor: newBgColor });
    newName = '';
  }

  function fmt(ts: number) {
    return new Date(ts).toLocaleDateString();
  }
</script>

<div class="screen">
  <h1>Comic Helper</h1>
  <p class="sub">Pixel art webtoon composer</p>

  <section class="card">
    <h2>New Project</h2>
    <div class="form-row">
      <label>Name <input bind:value={newName} placeholder="My Comic" on:keydown={e => e.key === 'Enter' && handleCreate()} /></label>
      <label>Canvas Width (px) <input type="number" bind:value={newWidth} min="16" max="512" /></label>
      <label>Background color
        <div class="color-row">
          <input type="color" bind:value={newBgColor} class="color-swatch" />
          <input type="text" bind:value={newBgColor} class="color-text" maxlength="7" />
        </div>
      </label>
    </div>
    <button on:click={handleCreate}>Create</button>
  </section>

  {#if projects.length > 0}
    <section class="card">
      <h2>Open Project</h2>
      <ul class="project-list">
        {#each projects as p (p.id)}
          <li>
            <button class="project-btn" on:click={() => dispatch('open', { id: p.id })}>
              <span class="p-name">{p.name}</span>
              <span class="p-meta">{p.canvasWidth}px wide · {new Date(p.updatedAt).toLocaleDateString()}</span>
            </button>
            <button class="icon-btn danger" on:click={() => dispatch('delete', { id: p.id })}>✕</button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>