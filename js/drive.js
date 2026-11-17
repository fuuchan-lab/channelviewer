/**
 * Google ログイン（Google Identity Services のトークン方式）と Google ドライブ操作。
 * LeadLog と同じ方式: ログイン状態とアクセストークンを localStorage に保存し、
 * 再訪問時は有効なトークンを再利用、期限切れなら無言で再取得を試みる。
 */
import { createTokenWaiter } from './token-waiter.js';

// 公開されるクライアントID（秘密ではない）。LeadLog と同じ Google Cloud のプロジェクト「LeadLog」の
// OAuth クライアント「LeadLog Web」。承認済みの生成元に https://channelviewer.doitmyself.net が必要。
const DEFAULT_CLIENT_ID = '942895331241-pjiplv9bi1but307aia3ansjp2d71ro0.apps.googleusercontent.com';

export const driveConfig = {
  folderName: 'ChannelViewer',
  fileName: 'data.json',
  scope: [
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
  ].join(' '),
};

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CLIENT_ID_KEY = 'subscope-client-id';
const TOKEN_KEY = 'channelviewer-drive-token';
const SESSION_KEY = 'channelviewer-drive-session';
const LOGIN_GRACE_MS = 8000;
const LOGIN_TIMEOUT_MS = 3 * 60_000;

let accessToken = null;
let tokenExpiresAt = 0;
let folderIdCache = null;
let fileIdCache;

const ls = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value); } catch { /* 保存できなくても続ける */ }
  },
};

/* ---------- クライアントID（詳細設定で別のクライアントに差し替えられる） ---------- */

export const getCustomClientId = () => (ls.get(CLIENT_ID_KEY) || '').trim();
export const setCustomClientId = (v) => ls.set(CLIENT_ID_KEY, v.trim() || null);
const clientId = () => getCustomClientId() || DEFAULT_CLIENT_ID;

/* ---------- ログイン状態とトークン ---------- */

export const hasSession = () => ls.get(SESSION_KEY) === '1';
export const setSession = (active) => ls.set(SESSION_KEY, active ? '1' : null);

function storeToken(token, expiresInSeconds) {
  const ms = Number(expiresInSeconds) > 0 ? Number(expiresInSeconds) * 1000 : 55 * 60_000;
  accessToken = token;
  tokenExpiresAt = Date.now() + ms;
  ls.set(TOKEN_KEY, JSON.stringify({ accessToken: token, expiresAt: tokenExpiresAt }));
}

/** 前回保存した有効なトークンがあればメモリに戻して true を返す */
export function restoreStoredToken() {
  try {
    const parsed = JSON.parse(ls.get(TOKEN_KEY) || 'null');
    if (!parsed?.accessToken || !(parsed.expiresAt > Date.now() + 30_000)) return false;
    accessToken = parsed.accessToken;
    tokenExpiresAt = parsed.expiresAt;
    return true;
  } catch {
    return false;
  }
}

export function clearToken() {
  accessToken = null;
  tokenExpiresAt = 0;
  ls.set(TOKEN_KEY, null);
}

const isGisLoaded = () => typeof google !== 'undefined' && !!google.accounts?.oauth2;

function waitForGis(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (isGisLoaded()) resolve();
      else if (Date.now() - start > timeoutMs) reject(new Error('google-identity-not-loaded'));
      else setTimeout(tick, 100);
    };
    tick();
  });
}

/**
 * アクセストークンを取得する。初回は consent、以降は無言の再取得 ('')、アカウント切替は select_account。
 * ブラウザはユーザー操作から離れたポップアップを止めるため、GIS が読み込み済みなら await を挟まずに呼ぶ。
 */
export function getAccessToken(interactive = true, promptOverride = null) {
  if (isGisLoaded()) return requestToken(interactive, promptOverride);
  return waitForGis().then(() => requestToken(interactive, promptOverride));
}

function requestToken(interactive, promptOverride) {
  const waiter = createTokenWaiter({ graceMs: LOGIN_GRACE_MS, timeoutMs: LOGIN_TIMEOUT_MS });
  const client = google.accounts.oauth2.initTokenClient({
    client_id: clientId(),
    scope: driveConfig.scope,
    callback: (res) => {
      if (res.error) return waiter.fail(res.error);
      // 確認画面で Google ドライブの項目のチェックが外されていたら失敗にする
      if (!google.accounts.oauth2.hasGrantedAllScopes(res, DRIVE_SCOPE)) return waiter.fail('drive_scope_not_granted');
      storeToken(res.access_token, res.expires_in);
      waiter.resolve(res.access_token);
    },
    error_callback: (err) => waiter.fail(err.type),
  });
  client.requestAccessToken({ prompt: promptOverride ?? (interactive && !accessToken ? 'consent' : '') });
  return waiter.promise;
}

/** ボタンを押した直後に呼ぶ。期限が近ければ、ポップアップを開ける今のうちに取り直す */
export function ensureFreshToken(marginMs = 120_000) {
  if (accessToken && tokenExpiresAt > Date.now() + marginMs) return Promise.resolve();
  return getAccessToken(false).then(() => undefined);
}

/* ---------- ドライブ ---------- */

async function errorReason(res) {
  try {
    const data = await res.json();
    const reason = data.error?.errors?.[0]?.reason ?? data.error?.status;
    const message = data.error?.message?.split('\n')[0];
    return reason ? ` ${reason}${message ? `: ${message.slice(0, 160)}` : ''}` : '';
  } catch {
    return '';
  }
}

async function driveFetch(url, init = {}, allowRetry = true) {
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401 && allowRetry) {
    await getAccessToken(false);
    return driveFetch(url, init, false);
  }
  if (!res.ok) throw new Error(`drive-request-failed-${res.status}${await errorReason(res)}`);
  return res;
}

const escapeQuery = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function findFirst(query) {
  const q = encodeURIComponent(query);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&orderBy=createdTime&spaces=drive`);
  const { files } = await res.json();
  return files?.[0]?.id ?? null;
}

/** アプリ用フォルダーの ID を返す。なければ作る。複数できていても全端末が一番古いものを使う */
async function ensureFolder() {
  if (folderIdCache) return folderIdCache;
  const found = await findFirst(`name='${escapeQuery(driveConfig.folderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  if (found) return (folderIdCache = found);
  const res = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: driveConfig.folderName, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return (folderIdCache = (await res.json()).id);
}

async function dataFileId() {
  if (fileIdCache !== undefined) return fileIdCache;
  const folderId = await ensureFolder();
  return (fileIdCache = await findFirst(`'${folderId}' in parents and name='${driveConfig.fileName}' and trashed=false`));
}

/** ドライブに保存したデータを読む。まだなければ null */
export async function loadData() {
  const id = await dataFileId();
  if (!id) return null;
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  return res.json();
}

export async function saveData(obj) {
  const id = await dataFileId();
  const boundary = `channelviewer-${Date.now()}`;
  const metadata = id ? { name: driveConfig.fileName } : { name: driveConfig.fileName, parents: [await ensureFolder()] };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}\r\n--${boundary}--`,
  ]);
  const base = 'https://www.googleapis.com/upload/drive/v3/files';
  const res = await driveFetch(`${base}${id ? `/${id}` : ''}?uploadType=multipart&fields=id`, {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  fileIdCache = (await res.json()).id;
}

export async function fetchUserInfo() {
  try {
    const res = await driveFetch('https://www.googleapis.com/oauth2/v2/userinfo');
    const data = await res.json();
    return { email: data.email ?? null, name: data.name ?? null, avatarUrl: data.picture ?? null };
  } catch (e) {
    if (e instanceof TypeError) throw e;
    return { email: null, name: null, avatarUrl: null };
  }
}

/** トークンを失効させ、保存済みのログイン状態を消す */
export function signOutDrive() {
  const token = accessToken;
  setSession(false);
  folderIdCache = null;
  fileIdCache = undefined;
  clearToken();
  if (token && isGisLoaded()) google.accounts.oauth2.revoke(token, () => {});
}

/* ---------- エラーの判定 ---------- */

export function describeError(e) {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/** 電波がない・通信できないことによる失敗か（認証の失敗やユーザーの中止は含めない） */
export function isNetworkError(e) {
  return e instanceof TypeError || (e instanceof Error && e.message === 'google-identity-not-loaded');
}
