import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Project, Frame, Asset, AssetLibrary } from './types';

interface ComicDB extends DBSchema {
  projects: { key: string; value: Project };
  frames: { key: string; value: Frame };
  assets: { key: string; value: Omit<Asset, 'images'> };
  assetImages: { key: string; value: { id: string; assetId: string; name: string; blob: Blob } };
  assetLibraries: { key: string; value: AssetLibrary };
}

let _db: IDBPDatabase<ComicDB>;

async function db(): Promise<IDBPDatabase<ComicDB>> {
  if (!_db) {
    _db = await openDB<ComicDB>('comic-helper', 2, {
      upgrade: async (db, oldVersion, _newVersion, tx) => {
        if (oldVersion < 1) {
          db.createObjectStore('projects', { keyPath: 'id' });
          db.createObjectStore('frames', { keyPath: 'id' });
          db.createObjectStore('assets', { keyPath: 'id' });
          db.createObjectStore('assetImages', { keyPath: 'id' });
        }
        if (oldVersion < 2) {
          db.createObjectStore('assetLibraries', { keyPath: 'id' });
          // Backfill libraryIds on existing projects so callers can rely on
          // the field being defined.
          const store = tx.objectStore('projects');
          let cursor = await store.openCursor();
          while (cursor) {
            const p = cursor.value as Project;
            if (!p.libraryIds) {
              await cursor.update({ ...p, libraryIds: [] });
            }
            cursor = await cursor.continue();
          }
        }
      },
    });
  }
  return _db;
}

// ── Projects ────────────────────────────────────────────────────
export async function getProjects(): Promise<Project[]> {
  const all = await (await db()).getAll('projects');
  // Backfill libraryIds for any project that pre-dates the migration race.
  return all.map(p => p.libraryIds ? p : { ...p, libraryIds: [] });
}

export async function getProject(id: string): Promise<Project | undefined> {
  const p = await (await db()).get('projects', id);
  if (!p) return p;
  return p.libraryIds ? p : { ...p, libraryIds: [] };
}

export async function saveProject(project: Project): Promise<void> {
  await (await db()).put('projects', project);
}

export async function deleteProject(id: string): Promise<void> {
  const d = await db();
  const project = await d.get('projects', id);
  if (!project) return;
  const tx = d.transaction(['projects', 'frames', 'assets', 'assetImages'], 'readwrite');
  for (const fid of project.frameIds) tx.objectStore('frames').delete(fid);
  // Only delete project-private assets. Library-owned assets stay intact so
  // other projects that attach the same library keep working.
  for (const aid of project.assetIds) {
    tx.objectStore('assets').delete(aid);
  }
  // Cascade asset image blobs for the deleted project-private assets.
  const privateSet = new Set(project.assetIds);
  if (privateSet.size > 0) {
    let cursor = await tx.objectStore('assetImages').openCursor();
    while (cursor) {
      if (privateSet.has(cursor.value.assetId)) {
        await cursor.delete();
      }
      cursor = await cursor.continue();
    }
  }
  tx.objectStore('projects').delete(id);
  await tx.done;
}

// ── Frames ──────────────────────────────────────────────────────
export async function getFrame(id: string): Promise<Frame | undefined> {
  return (await db()).get('frames', id);
}

export async function getFrames(ids: string[]): Promise<Frame[]> {
  const d = await db();
  const results = await Promise.all(ids.map(id => d.get('frames', id)));
  return results.filter((f): f is Frame => !!f);
}

export async function saveFrame(frame: Frame): Promise<void> {
  await (await db()).put('frames', frame);
}

export async function deleteFrame(id: string): Promise<void> {
  await (await db()).delete('frames', id);
}

// ── Assets ──────────────────────────────────────────────────────
export async function getAssets(ids: string[]): Promise<Asset[]> {
  if (ids.length === 0) return [];
  const d = await db();
  const wanted = new Set(ids);
  const metas = await Promise.all(ids.map(id => d.get('assets', id)));
  // Load all image rows once and bucket by assetId — avoids N full-store scans.
  const allImages = await d.getAll('assetImages');
  const byAsset = new Map<string, { id: string; name: string; blob: Blob }[]>();
  for (const r of allImages) {
    if (!wanted.has(r.assetId)) continue;
    const list = byAsset.get(r.assetId) ?? [];
    list.push({ id: r.id, name: r.name, blob: r.blob });
    byAsset.set(r.assetId, list);
  }
  const assets: Asset[] = [];
  for (const meta of metas) {
    if (!meta) continue;
    assets.push({ ...meta, images: byAsset.get(meta.id) ?? [] });
  }
  return assets;
}

export async function saveAsset(asset: Asset): Promise<void> {
  const d = await db();
  const { images, ...meta } = asset;
  const tx = d.transaction(['assets', 'assetImages'], 'readwrite');
  tx.objectStore('assets').put(meta);
  for (const img of images) {
    tx.objectStore('assetImages').put({ id: img.id, assetId: asset.id, name: img.name, blob: img.blob });
  }
  await tx.done;
}

export async function deleteAssetImage(imageId: string): Promise<void> {
  await (await db()).delete('assetImages', imageId);
}

export async function deleteAsset(assetId: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['assets', 'assetImages'], 'readwrite');
  let cursor = await tx.objectStore('assetImages').openCursor();
  while (cursor) {
    if (cursor.value.assetId === assetId) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
  tx.objectStore('assets').delete(assetId);
  await tx.done;
}

// ── Asset libraries ─────────────────────────────────────────────
export async function getAssetLibraries(): Promise<AssetLibrary[]> {
  return (await db()).getAll('assetLibraries');
}

export async function getAssetLibrary(id: string): Promise<AssetLibrary | undefined> {
  return (await db()).get('assetLibraries', id);
}

export async function saveAssetLibrary(lib: AssetLibrary): Promise<void> {
  await (await db()).put('assetLibraries', lib);
}

/**
 * Permanently delete a library and all of its assets (and their images).
 * Also detaches the library from any project that has it attached.
 */
export async function deleteAssetLibrary(libraryId: string): Promise<void> {
  const d = await db();
  const lib = await d.get('assetLibraries', libraryId);
  if (!lib) return;
  const assetSet = new Set(lib.assetIds);
  const tx = d.transaction(['assetLibraries', 'assets', 'assetImages', 'projects'], 'readwrite');
  for (const aid of lib.assetIds) {
    tx.objectStore('assets').delete(aid);
  }
  if (assetSet.size > 0) {
    let imgCursor = await tx.objectStore('assetImages').openCursor();
    while (imgCursor) {
      if (assetSet.has(imgCursor.value.assetId)) {
        await imgCursor.delete();
      }
      imgCursor = await imgCursor.continue();
    }
  }
  let projCursor = await tx.objectStore('projects').openCursor();
  while (projCursor) {
    const p = projCursor.value;
    if (p.libraryIds && p.libraryIds.includes(libraryId)) {
      await projCursor.update({ ...p, libraryIds: p.libraryIds.filter(id => id !== libraryId), updatedAt: Date.now() });
    }
    projCursor = await projCursor.continue();
  }
  tx.objectStore('assetLibraries').delete(libraryId);
  await tx.done;
}
