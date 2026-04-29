import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Project, Frame, Asset } from './types';

interface ComicDB extends DBSchema {
  projects: { key: string; value: Project };
  frames: { key: string; value: Frame };
  assets: { key: string; value: Omit<Asset, 'images'> };
  assetImages: { key: string; value: { id: string; assetId: string; name: string; blob: Blob } };
}

let _db: IDBPDatabase<ComicDB>;

async function db(): Promise<IDBPDatabase<ComicDB>> {
  if (!_db) {
    _db = await openDB<ComicDB>('comic-helper', 1, {
      upgrade(db) {
        db.createObjectStore('projects', { keyPath: 'id' });
        db.createObjectStore('frames', { keyPath: 'id' });
        db.createObjectStore('assets', { keyPath: 'id' });
        db.createObjectStore('assetImages', { keyPath: 'id' });
      },
    });
  }
  return _db;
}

// ── Projects ────────────────────────────────────────────────────
export async function getProjects(): Promise<Project[]> {
  return (await db()).getAll('projects');
}

export async function getProject(id: string): Promise<Project | undefined> {
  return (await db()).get('projects', id);
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
  for (const aid of project.assetIds) {
    tx.objectStore('assets').delete(aid);
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
  const d = await db();
  const metas = await Promise.all(ids.map(id => d.get('assets', id)));
  const assets: Asset[] = [];
  for (const meta of metas) {
    if (!meta) continue;
    const imgRecords = await d.getAll('assetImages');
    const images = imgRecords
      .filter(r => r.assetId === meta.id)
      .map(r => ({ id: r.id, name: r.name, blob: r.blob }));
    assets.push({ ...meta, images });
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
  const imgRecords = await d.getAll('assetImages');
  const tx = d.transaction(['assets', 'assetImages'], 'readwrite');
  for (const r of imgRecords) {
    if (r.assetId === assetId) tx.objectStore('assetImages').delete(r.id);
  }
  tx.objectStore('assets').delete(assetId);
  await tx.done;
}
