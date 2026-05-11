/**
 * googleDrive.ts — Google Drive backup integration for comic-helper.
 *
 * Uses Google Identity Services (GIS) for OAuth in the browser (no backend)
 * and the Drive v3 REST API for file operations. All backups are stored as
 * JSON files inside a folder named "comic helper" at the root of the user's
 * Drive. Scope is `drive.file` so the app can only see files it created
 * itself — no broad access to the user's Drive.
 *
 * Setup: a Google Cloud OAuth 2.0 Client ID (Web application) must be
 * configured with the deployment origin listed under "Authorized JavaScript
 * origins". Provide the client id via either:
 *   - `VITE_GOOGLE_CLIENT_ID` build-time env var (recommended for prod), or
 *   - localStorage key `comic-helper:google-client-id` (per-browser override).
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'comic helper';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const CLIENT_ID_LS_KEY = 'comic-helper:google-client-id';

// ── GIS typings (just enough of the surface we use) ──────────────

interface TokenResponse {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
  error?: string;
}

interface TokenClient {
  requestAccessToken(opts?: { prompt?: string }): void;
  callback: (resp: TokenResponse) => void;
}

interface GoogleNamespace {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (resp: TokenResponse) => void;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}

declare global {
  interface Window { google?: GoogleNamespace }
}

// ── Module state ──────────────────────────────────────────────────

let tokenClient: TokenClient | null = null;
let accessToken: string | null = null;
let tokenExpiry: number = 0; // epoch ms
let cachedFolderId: string | null = null;
let signedInEmail: string | null = null;

// ── Client ID resolution ─────────────────────────────────────────

export function getConfiguredClientId(): string | null {
  // Build-time env var takes priority. Fall back to per-browser override.
  const fromEnv = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();
  if (fromEnv) return fromEnv;
  try {
    return localStorage.getItem(CLIENT_ID_LS_KEY) || null;
  } catch {
    return null;
  }
}

export function setOverrideClientId(id: string | null): void {
  try {
    if (id && id.trim()) localStorage.setItem(CLIENT_ID_LS_KEY, id.trim());
    else localStorage.removeItem(CLIENT_ID_LS_KEY);
  } catch { /* ignore */ }
  // Force re-init next time signIn is called.
  tokenClient = null;
  accessToken = null;
  tokenExpiry = 0;
  cachedFolderId = null;
  signedInEmail = null;
}

// ── GIS script loading + token client ────────────────────────────

let gisLoadPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Identity Services.')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services.'));
    document.head.appendChild(s);
  });
  return gisLoadPromise;
}

/**
 * Acquire an access token, prompting the user if needed.
 * @param interactive  When true, may show the consent popup; when false,
 *                     attempts a silent refresh (will reject if not possible).
 */
async function acquireToken(interactive: boolean): Promise<string> {
  const clientId = getConfiguredClientId();
  if (!clientId) {
    throw new Error('No Google OAuth Client ID configured.');
  }
  await loadGis();

  if (!tokenClient) {
    tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      // Real callback assigned per-request below.
      callback: () => { /* placeholder */ },
    });
  }

  return new Promise<string>((resolve, reject) => {
    tokenClient!.callback = (resp: TokenResponse) => {
      if (resp.error || !resp.access_token) {
        reject(new Error(resp.error || 'Failed to obtain access token.'));
        return;
      }
      accessToken = resp.access_token;
      // expires_in is in seconds; subtract a safety margin so we refresh early.
      tokenExpiry = Date.now() + (resp.expires_in - 60) * 1000;
      resolve(resp.access_token);
    };
    tokenClient!.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
}

async function getValidToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  // Try silent refresh first; if that fails, caller should retry interactively.
  return acquireToken(false);
}

// ── Public sign-in API ────────────────────────────────────────────

export interface DriveSession {
  email: string | null;
}

export async function signIn(): Promise<DriveSession> {
  await acquireToken(true);
  // Fetch profile email for display purposes.
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (r.ok) {
      const j = await r.json() as { email?: string };
      signedInEmail = j.email ?? null;
    }
  } catch { /* ignore — email is optional */ }
  return { email: signedInEmail };
}

export function signOut(): void {
  if (accessToken && window.google?.accounts?.oauth2) {
    try { window.google.accounts.oauth2.revoke(accessToken); } catch { /* ignore */ }
  }
  accessToken = null;
  tokenExpiry = 0;
  cachedFolderId = null;
  signedInEmail = null;
}

export function isSignedIn(): boolean {
  return !!accessToken && Date.now() < tokenExpiry;
}

export function getSignedInEmail(): string | null {
  return signedInEmail;
}

// ── Drive REST helpers ────────────────────────────────────────────

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let token = await getValidToken();
  let resp = await fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (resp.status === 401) {
    // Token expired or revoked — try one interactive refresh.
    token = await acquireToken(true);
    resp = await fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
    });
  }
  return resp;
}

async function findOrCreateFolder(): Promise<string> {
  if (cachedFolderId) return cachedFolderId;

  // Search first — with drive.file scope we'll only find folders our app
  // previously created.
  const q = encodeURIComponent(
    `name = '${FOLDER_NAME}' and mimeType = '${FOLDER_MIME}' and trashed = false and 'root' in parents`,
  );
  const searchResp = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`,
  );
  if (searchResp.ok) {
    const j = await searchResp.json() as { files?: { id: string; name: string }[] };
    const hit = j.files?.[0];
    if (hit) { cachedFolderId = hit.id; return hit.id; }
  }

  // Create it.
  const createResp = await driveFetch(
    'https://www.googleapis.com/drive/v3/files?fields=id',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME, parents: ['root'] }),
    },
  );
  if (!createResp.ok) {
    throw new Error(`Failed to create Drive folder: ${createResp.status} ${await createResp.text()}`);
  }
  const created = await createResp.json() as { id: string };
  cachedFolderId = created.id;
  return created.id;
}

export interface DriveBackupFile {
  id: string;
  name: string;
  modifiedTime: string;
  size: number;
}

export async function listBackups(): Promise<DriveBackupFile[]> {
  const folderId = await findOrCreateFolder();
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const resp = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=100`,
  );
  if (!resp.ok) throw new Error(`Failed to list Drive backups: ${resp.status}`);
  const j = await resp.json() as { files?: { id: string; name: string; modifiedTime: string; size?: string }[] };
  return (j.files ?? []).map(f => ({
    id: f.id,
    name: f.name,
    modifiedTime: f.modifiedTime,
    size: f.size ? Number(f.size) : 0,
  }));
}

/** Upload a JSON-serializable backup as a new file in the comic-helper folder. */
export async function uploadBackup(filename: string, data: unknown): Promise<DriveBackupFile> {
  const folderId = await findOrCreateFolder();
  const json = JSON.stringify(data);

  // Multipart upload (one request) — metadata + content with a boundary.
  const boundary = `-------comic-helper-${Math.random().toString(36).slice(2)}`;
  const metadata = { name: filename, mimeType: 'application/json', parents: [folderId] };
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    `${json}\r\n` +
    `--${boundary}--`;

  const resp = await driveFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary="${boundary}"` },
      body,
    },
  );
  if (!resp.ok) {
    throw new Error(`Failed to upload backup: ${resp.status} ${await resp.text()}`);
  }
  const f = await resp.json() as { id: string; name: string; modifiedTime: string; size?: string };
  return { id: f.id, name: f.name, modifiedTime: f.modifiedTime, size: f.size ? Number(f.size) : 0 };
}

/** Download a backup file's JSON content from Drive. */
export async function downloadBackup(fileId: string): Promise<unknown> {
  const resp = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
  );
  if (!resp.ok) throw new Error(`Failed to download backup: ${resp.status}`);
  return resp.json();
}

/** Delete a backup file from Drive. */
export async function deleteBackup(fileId: string): Promise<void> {
  const resp = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    { method: 'DELETE' },
  );
  if (!resp.ok && resp.status !== 204) {
    throw new Error(`Failed to delete backup: ${resp.status}`);
  }
}
