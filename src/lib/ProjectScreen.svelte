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
  <header class="hero">
    <h1>Comic Helper</h1>
    <p class="sub">Pixel art webtoon composer</p>
  </header>

  <section class="card">
    <h2>New Project</h2>
    <div class="fields">
      <label class="field">
        <span class="field-label">Name</span>
        <input bind:value={newName} placeholder="My Comic" on:keydown={e => e.key === 'Enter' && handleCreate()} />
      </label>
      <label class="field">
        <span class="field-label">Canvas width (px)</span>
        <input type="number" bind:value={newWidth} min="16" max="512" />
      </label>
      <label class="field">
        <span class="field-label">Background color</span>
        <div class="color-row">
          <input type="color" bind:value={newBgColor} class="color-swatch" />
          <input type="text" bind:value={newBgColor} class="color-text" maxlength="7" />
        </div>
      </label>
    </div>
    <button class="create-btn" on:click={handleCreate}>Create Project</button>
  </section>

  {#if projects.length > 0}
    <section class="card">
      <h2>Open Project</h2>
      <ul class="project-list">
        {#each projects as p (p.id)}
          <li class="project-item">
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

<style>
  .screen {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    padding: 2rem 1rem 3rem;
    min-height: 100dvh;
    background: #12121f;
    color: #e0e0f0;
    box-sizing: border-box;
  }

  .hero {
    text-align: center;
    padding: 0.5rem 0 0.25rem;
  }

  .hero h1 {
    margin: 0 0 0.25rem;
    font-size: 1.8rem;
    letter-spacing: 0.04em;
    color: #e0e0f0;
  }

  .sub {
    margin: 0;
    font-size: 0.85rem;
    color: #8080a0;
  }

  .card {
    width: 100%;
    max-width: 420px;
    background: #1e1e30;
    border: 1px solid #4a4a6a;
    border-radius: 10px;
    padding: 1.25rem 1.5rem 1.5rem;
    box-sizing: border-box;
  }

  .card h2 {
    margin: 0 0 1rem;
    font-size: 0.95rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #8080b0;
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    margin-bottom: 1.25rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .field-label {
    font-size: 0.8rem;
    color: #9090b0;
    letter-spacing: 0.03em;
  }

  .field input,
  .field .color-text {
    background: #12121f;
    border: 1px solid #4a4a6a;
    border-radius: 6px;
    color: #e0e0f0;
    padding: 0.45rem 0.6rem;
    font-size: 0.95rem;
    width: 100%;
    box-sizing: border-box;
  }

  .field input:focus,
  .field .color-text:focus {
    outline: none;
    border-color: #7070cc;
  }

  .color-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .color-swatch {
    width: 2.4rem !important;
    height: 2.2rem;
    padding: 0.15rem !important;
    cursor: pointer;
    flex-shrink: 0;
    border-radius: 6px;
  }

  .color-text {
    flex: 1;
  }

  .create-btn {
    width: 100%;
    padding: 0.6rem;
    background: #4a4acc;
    color: #e0e0f0;
    border: none;
    border-radius: 6px;
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    letter-spacing: 0.03em;
  }

  .create-btn:hover {
    background: #5a5adc;
  }

  .project-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .project-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: #12121f;
    border: 1px solid #3a3a5a;
    border-radius: 7px;
    overflow: hidden;
  }

  .project-btn {
    flex: 1;
    background: transparent;
    border: none;
    color: #e0e0f0;
    padding: 0.65rem 0.85rem;
    text-align: left;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }

  .project-btn:hover {
    background: #2a2a3e;
  }

  .p-name {
    font-size: 0.95rem;
    font-weight: 600;
  }

  .p-meta {
    font-size: 0.75rem;
    color: #7070a0;
  }

  .icon-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0.65rem 0.75rem;
    color: #7070a0;
    font-size: 0.85rem;
    align-self: stretch;
    display: flex;
    align-items: center;
  }

  .icon-btn.danger:hover {
    color: #e05050;
    background: rgba(200, 50, 50, 0.1);
  }
</style>