/**
 * portability.ts — Import/export serialization for comic-helper.
 *
 * All functions here are pure — none touch IndexedDB directly.
 * DB interaction stays in db.ts; state updates stay in App.svelte.
 */

import type { Project, Frame, Asset, AssetLibrary, AssetType } from '../types';

// ── Serialization types ──────────────────────────────────────────

export interface SerializedImage {
  id: string;
  assetId: string;
  name: string;
  mimeType: string;
  /** Base64-encoded image data (no data: URI prefix). */
  data: string;
}

export interface SerializedAsset {
  id: string;
  name: string;
  type: AssetType;
  ephemeral?: boolean;
}

export interface ProjectExport {
  type: 'comic-helper-project';
  version: 1;
  project: Project;
  frames: Frame[];
  assets: SerializedAsset[];
  images: SerializedImage[];
  exportedAt: number;
}

export interface LibraryExport {
  type: 'comic-helper-library';
  version: 1;
  library: AssetLibrary;
  assets: SerializedAsset[];
  images: SerializedImage[];
  exportedAt: number;
}

export interface FullBackup {
  type: 'comic-helper-backup';
  version: 1;
  projects: Project[];
  frames: Frame[];
  libraries: AssetLibrary[];
  assets: SerializedAsset[];
  images: SerializedImage[];
  exportedAt: number;
}

// ── Blob <-> base64 ──────────────────────────────────────────────

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(data: string, mimeType: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

// ── Serialization helpers ─────────────────────────────────────────

/**
 * Serialize a list of fully-loaded assets (with blob images) into a
 * portable format suitable for JSON export.
 */
export async function serializeAssets(assets: Asset[]): Promise<{
  assets: SerializedAsset[];
  images: SerializedImage[];
}> {
  const serializedAssets: SerializedAsset[] = assets.map(a => ({
    id: a.id,
    name: a.name,
    type: a.type,
    ...(a.ephemeral ? { ephemeral: true } : {}),
  }));

  const images: SerializedImage[] = [];
  for (const asset of assets) {
    for (const img of asset.images) {
      const data = await blobToBase64(img.blob);
      images.push({
        id: img.id,
        assetId: asset.id,
        name: img.name,
        mimeType: img.blob.type || 'image/png',
        data,
      });
    }
  }

  return { assets: serializedAssets, images };
}

/**
 * Deserialize serialized assets back into in-memory Asset objects with Blobs.
 */
export function deserializeAssets(
  rawAssets: SerializedAsset[],
  rawImages: SerializedImage[],
): Asset[] {
  const imagesByAsset = new Map<string, { id: string; name: string; blob: Blob }[]>();
  for (const img of rawImages) {
    const blob = base64ToBlob(img.data, img.mimeType);
    const list = imagesByAsset.get(img.assetId) ?? [];
    list.push({ id: img.id, name: img.name, blob });
    imagesByAsset.set(img.assetId, list);
  }
  return rawAssets.map(a => ({
    ...a,
    images: imagesByAsset.get(a.id) ?? [],
  }));
}

// ── File I/O ──────────────────────────────────────────────────────

/** Trigger a browser file download for the given JSON-serializable data. */
export function triggerDownload(filename: string, data: unknown): void {
  const json = JSON.stringify(data);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Read a File object as text and parse as JSON. Rejects on invalid JSON. */
export async function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result as string));
      } catch {
        reject(new Error('The selected file is not valid JSON.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}

// ── Validation / parsing ──────────────────────────────────────────

function assertFileType(raw: unknown, expected: string): void {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid file format.');
  }
  const got = (raw as Record<string, unknown>).type;
  if (got !== expected) {
    throw new Error(
      `Expected a ${expected} file, but got "${got ?? 'unknown'}". ` +
      'Make sure you selected the correct file type.',
    );
  }
}

export function parseProjectExport(raw: unknown): ProjectExport {
  assertFileType(raw, 'comic-helper-project');
  const d = raw as ProjectExport;
  if (!d.project || !Array.isArray(d.frames) || !Array.isArray(d.assets) || !Array.isArray(d.images)) {
    throw new Error('Project file is missing required fields.');
  }
  return d;
}

export function parseLibraryExport(raw: unknown): LibraryExport {
  assertFileType(raw, 'comic-helper-library');
  const d = raw as LibraryExport;
  if (!d.library || !Array.isArray(d.assets) || !Array.isArray(d.images)) {
    throw new Error('Library file is missing required fields.');
  }
  return d;
}

export function parseFullBackup(raw: unknown): FullBackup {
  assertFileType(raw, 'comic-helper-backup');
  const d = raw as FullBackup;
  if (
    !Array.isArray(d.projects) ||
    !Array.isArray(d.frames) ||
    !Array.isArray(d.assets) ||
    !Array.isArray(d.images)
  ) {
    throw new Error('Backup file is missing required fields.');
  }
  return d;
}

// ── ID remapping ──────────────────────────────────────────────────
// When importing a project or library individually, we remap all IDs to
// fresh UUIDs so the import can coexist with existing data without collision.

type IdMap = Map<string, string>;

function remapId(idMap: IdMap, oldId: string): string {
  if (!idMap.has(oldId)) idMap.set(oldId, crypto.randomUUID());
  return idMap.get(oldId)!;
}

/**
 * Remap all IDs in a project export to fresh UUIDs so it can be imported
 * alongside existing projects without collision.
 * Returns fully deserialized, ready-to-save objects.
 */
export function remapProjectIds(data: ProjectExport): {
  project: Project;
  frames: Frame[];
  assets: Asset[];
} {
  const assetIdMap: IdMap = new Map();
  const imageIdMap: IdMap = new Map();
  const frameIdMap: IdMap = new Map();

  // Precompute all new asset/image IDs so cross-references can be resolved.
  for (const a of data.assets) remapId(assetIdMap, a.id);
  for (const img of data.images) remapId(imageIdMap, img.id);
  for (const f of data.frames) remapId(frameIdMap, f.id);

  const assets = deserializeAssets(data.assets, data.images).map(a => ({
    ...a,
    id: assetIdMap.get(a.id)!,
    images: a.images.map(img => ({
      ...img,
      id: imageIdMap.get(img.id)!,
    })),
  }));

  const frames: Frame[] = data.frames.map(f => ({
    ...f,
    id: frameIdMap.get(f.id)!,
    background: f.background
      ? {
          ...f.background,
          assetId: assetIdMap.get(f.background.assetId) ?? f.background.assetId,
          imageId: imageIdMap.get(f.background.imageId) ?? f.background.imageId,
        }
      : null,
    layers: f.layers.map(l => ({
      ...l,
      assetId: assetIdMap.get(l.assetId) ?? l.assetId,
      imageId: imageIdMap.get(l.imageId) ?? l.imageId,
    })),
  }));

  const project: Project = {
    ...data.project,
    id: crypto.randomUUID(),
    name: data.project.name + ' (imported)',
    frameIds: data.project.frameIds.map(id => frameIdMap.get(id) ?? id),
    assetIds: data.project.assetIds.map(id => assetIdMap.get(id) ?? id),
    libraryIds: [], // imported projects don't carry library attachments
    updatedAt: Date.now(),
  };

  return { project, frames, assets };
}

/**
 * Remap all IDs in a library export to fresh UUIDs so it can be imported
 * alongside existing libraries without collision.
 * Returns fully deserialized, ready-to-save objects.
 */
export function remapLibraryIds(data: LibraryExport): {
  library: AssetLibrary;
  assets: Asset[];
} {
  const assetIdMap: IdMap = new Map();
  const imageIdMap: IdMap = new Map();

  for (const a of data.assets) remapId(assetIdMap, a.id);
  for (const img of data.images) remapId(imageIdMap, img.id);

  const assets = deserializeAssets(data.assets, data.images).map(a => ({
    ...a,
    id: assetIdMap.get(a.id)!,
    images: a.images.map(img => ({
      ...img,
      id: imageIdMap.get(img.id)!,
    })),
  }));

  const library: AssetLibrary = {
    ...data.library,
    id: crypto.randomUUID(),
    name: data.library.name + ' (imported)',
    assetIds: data.library.assetIds.map(id => assetIdMap.get(id) ?? id),
    updatedAt: Date.now(),
  };

  return { library, assets };
}

/**
 * Deserialize a full backup without ID remapping.
 * The restore operation will clear the DB first, so original IDs are safe.
 */
export function deserializeFullBackup(data: FullBackup): {
  projects: Project[];
  frames: Frame[];
  libraries: AssetLibrary[];
  assets: Asset[];
} {
  const assets = deserializeAssets(data.assets, data.images);
  return {
    projects: data.projects,
    frames: data.frames,
    libraries: data.libraries ?? [],
    assets,
  };
}
