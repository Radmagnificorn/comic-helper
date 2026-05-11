<!-- ProjectScreen.svelte – create / open a project -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { Project } from '../types';
  import type { DriveBackupFile } from './googleDrive';

  export let projects: Project[] = [];

  // ── Google Drive props (state owned by App.svelte) ──
  export let driveConnected: boolean = false;
  export let driveEmail: string | null = null;
  export let driveBackups: DriveBackupFile[] = [];
  export let driveBusy: boolean = false;

  const dispatch = createEventDispatcher<{
    open: { id: string };
    create: { name: string; canvasWidth: number; bgColor: string };
    delete: { id: string };
    exportProject: { id: string };
    importProject: { file: File };
    exportBackup: Record<string, never>;
    importBackup: { file: File };
    driveConnect: Record<string, never>;
    driveDisconnect: Record<string, never>;
    driveRefresh: Record<string, never>;
    driveSaveBackup: Record<string, never>;
    driveRestore: { id: string; name: string };
    driveDelete: { id: string; name: string };
  }>();

  let newName = '';
  let newWidth = 128;
  let newBgColor = '#ffffff';

  let importProjectInput: HTMLInputElement;
  let importBackupInput: HTMLInputElement;

  function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    dispatch('create', { name, canvasWidth: newWidth, bgColor: newBgColor });
    newName = '';
  }

  function handleImportProjectFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    dispatch('importProject', { file });
    (e.target as HTMLInputElement).value = '';
  }

  function handleImportBackupFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    dispatch('importBackup', { file });
    (e.target as HTMLInputElement).value = '';
  }

  function fmt(ts: number) {
    return new Date(ts).toLocaleDateString();
  }

  function fmtDate(iso: string): string {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  function fmtSize(bytes: number): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
            <button class="icon-btn" title="Export project" on:click={() => dispatch('exportProject', { id: p.id })}>⤓</button>
            <button class="icon-btn danger" on:click={() => dispatch('delete', { id: p.id })}>✕</button>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="card">
    <h2>Import / Backup</h2>
    <div class="io-row">
      <button class="io-btn" on:click={() => importProjectInput.click()}>⤒ Import Project</button>
      <input
        type="file"
        accept=".json"
        hidden
        bind:this={importProjectInput}
        on:change={handleImportProjectFile}
      />
    </div>
    <div class="io-divider"></div>
    <div class="io-row">
      <button class="io-btn" on:click={() => dispatch('exportBackup', {})}>⤓ Export Backup</button>
      <button class="io-btn danger" on:click={() => importBackupInput.click()}>⤒ Restore Backup</button>
      <input
        type="file"
        accept=".json"
        hidden
        bind:this={importBackupInput}
        on:change={handleImportBackupFile}
      />
    </div>
    <p class="io-note">Restore replaces all current data with the backup file.</p>
  </section>

  <section class="card">
    <h2>Google Drive</h2>
    {#if !driveConnected}
      <button class="io-btn io-btn-google" on:click={() => dispatch('driveConnect', {})} disabled={driveBusy}>
        <svg class="google-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
        </svg>
        {driveBusy ? 'Connecting…' : 'Connect Google Account'}
      </button>
      <p class="io-note">Backups are saved to a folder named “omic helper” in your Drive. Comic Helper can only see files it created itself.</p>
    {:else}
      <div class="drive-status">
        <span class="drive-email">{driveEmail ?? 'Connected'}</span>
        <button class="icon-btn" title="Refresh" on:click={() => dispatch('driveRefresh', {})} disabled={driveBusy}>↻</button>
        <button class="icon-btn danger" title="Disconnect" on:click={() => dispatch('driveDisconnect', {})}>✕</button>
      </div>
      <div class="io-row" style="margin-top: 0.6rem;">
        <button class="io-btn" on:click={() => dispatch('driveSaveBackup', {})} disabled={driveBusy}>
          {driveBusy ? 'Working…' : '❐ Save Backup to Drive'}
        </button>
      </div>
      {#if driveBackups.length > 0}
        <ul class="drive-list">
          {#each driveBackups as f (f.id)}
            <li class="drive-item">
              <div class="drive-info">
                <span class="drive-name">{f.name}</span>
                <span class="drive-meta">{fmtDate(f.modifiedTime)}{f.size ? ' · ' + fmtSize(f.size) : ''}</span>
              </div>
              <button class="icon-btn" title="Restore" on:click={() => dispatch('driveRestore', { id: f.id, name: f.name })} disabled={driveBusy}>⤒</button>
              <button class="icon-btn danger" title="Delete" on:click={() => dispatch('driveDelete', { id: f.id, name: f.name })} disabled={driveBusy}>✕</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="io-note">No backups in Drive yet.</p>
      {/if}
    {/if}
  </section>
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

  .io-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .io-btn {
    flex: 1;
    min-width: 140px;
    padding: 0.55rem 0.75rem;
    background: #2a2a42;
    border: 1px solid #4a4a6a;
    border-radius: 6px;
    color: #c0c0e0;
    font-size: 0.88rem;
    font-weight: 500;
    cursor: pointer;
    letter-spacing: 0.02em;
  }

  .io-btn:hover {
    background: #38386a;
    color: #e0e0f0;
  }

  .io-btn.danger {
    border-color: #7a3a3a;
    color: #e08080;
  }

  .io-btn.danger:hover {
    background: rgba(200, 50, 50, 0.18);
    color: #f09090;
  }

  .io-divider {
    height: 1px;
    background: #3a3a5a;
    margin: 0.75rem 0;
  }

  .io-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .drive-status {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: #12121f;
    border: 1px solid #3a3a5a;
    border-radius: 7px;
    padding: 0.5rem 0.75rem;
  }

  .drive-email {
    flex: 1;
    font-size: 0.85rem;
    color: #c0c0e0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .drive-list {
    list-style: none;
    margin: 0.75rem 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .drive-item {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: #12121f;
    border: 1px solid #3a3a5a;
    border-radius: 7px;
    overflow: hidden;
  }

  .drive-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: 0.5rem 0.75rem;
    min-width: 0;
  }

  .drive-name {
    font-size: 0.85rem;
    color: #e0e0f0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .drive-meta {
    font-size: 0.72rem;
    color: #7070a0;
  }

  .io-btn-google {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6rem;
    background: #ffffff;
    border: 1px solid #dadce0;
    color: #3c4043;
    font-weight: 600;
    width: 100%;
  }

  .io-btn-google:hover:not(:disabled) {
    background: #f8f9fa;
    border-color: #c6c9cc;
    color: #3c4043;
  }

  .io-btn-google:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .google-icon {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  .io-note {
    margin: 0.6rem 0 0;
    font-size: 0.75rem;
    color: #6060a0;
    line-height: 1.4;
  }
</style>