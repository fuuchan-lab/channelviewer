/* ===== 設定の保存キー ===== */
const API_KEY_KEY = 'subscope-api-key';
const CLIENT_ID_KEY = 'subscope-client-id';
const ACCOUNT_KEY = 'subscope-drive-account';
const CHANNELS_KEY = 'subscope-channels';

const DRIVE_FOLDER_NAME = 'ChannelViewer';
const DATA_FILE_NAME = 'data.json';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_SCOPE = DRIVE_SCOPE + ' https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email';

function getApiKey() { return localStorage.getItem(API_KEY_KEY) || '' }
function setApiKey(v) { localStorage.setItem(API_KEY_KEY, v) }
function getClientId() { return localStorage.getItem(CLIENT_ID_KEY) || '' }
function setClientId(v) { localStorage.setItem(CLIENT_ID_KEY, v) }

function loadCachedAccount() {
  try { const raw = localStorage.getItem(ACCOUNT_KEY); return raw ? JSON.parse(raw) : null }
  catch { return null }
}
function saveCachedAccount(acc) {
  if (acc) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(acc));
  else localStorage.removeItem(ACCOUNT_KEY);
}

/* ===== チャンネルデータ（実データのみ。id を持たない旧デモデータは除外する） ===== */
let channels = [];
try {
  const stored = JSON.parse(localStorage.getItem(CHANNELS_KEY) || 'null');
  if (Array.isArray(stored)) channels = stored.filter(c => c && c.id);
} catch { /* 無視 */ }

let visibleCount = Math.max(channels.length, 7);
const yen = new Intl.NumberFormat('ja-JP');
const rows = document.querySelector('#channelRows');
const search = document.querySelector('#searchInput');
const sort = document.querySelector('#sortSelect');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

function persistChannels() {
  localStorage.setItem(CHANNELS_KEY, JSON.stringify(channels));
  void syncToDrive();
}

function avatar(channel) {
  const initial = escapeHtml((channel.initial || channel.name || '?').slice(0, 2));
  const img = channel.thumbnail ? `<img src="${channel.thumbnail}" alt="${escapeHtml(channel.name)}のサムネイル" onerror="this.style.display='none'">` : '';
  return `<span class="avatar-image" style="background:${channel.color || '#d7e3da'}">${img}<span>${initial}</span></span>`;
}

function formatSubs(value) {
  return value === null || value === undefined ? '非公開' : yen.format(value);
}

/** 記録した登録者数の履歴から、行に表示する小さな折れ線グラフ（SVG）を作る */
function sparklineSvg(history) {
  if (!history || history.length < 2) return '';
  const values = history.map(h => h.subs);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 64, h = 22;
  const points = values.map((v, i) => {
    const x = values.length > 1 ? (i / (values.length - 1)) * w : 0;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const trendUp = values[values.length - 1] >= values[0];
  const color = trendUp ? '#2bdf99' : '#ff5468';
  return `<svg class="row-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

/** 「30日間の増加」列の中身。記録が2件以上たまったら、実際の差分からグラフと増減率を出す */
function renderGainCell(c) {
  const history = c.history || [];
  const spark = sparklineSvg(history);
  if (history.length < 2) {
    return { cls: '', html: `<small>収集中</small>` };
  }
  const first = history[0].subs;
  const last = history[history.length - 1].subs;
  const diff = last - first;
  const pct = first > 0 ? (diff / first) * 100 : 0;
  const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
  const sign = diff > 0 ? '+' : '';
  return { cls, html: `${spark}<small>${sign}${pct.toFixed(1)}%</small>` };
}

function render() {
  const query = search.value.toLowerCase();
  const mode = sort.value;
  const filtered = channels.filter(c => `${c.name}${c.handle}`.toLowerCase().includes(query));
  if (mode === 'name') filtered.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  else if (mode === 'subscribers') filtered.sort((a, b) => (b.subs ?? -1) - (a.subs ?? -1));
  else if (mode === 'growth') {
    filtered.sort((a, b) => {
      const da = a.history && a.history.length > 1 ? a.history[a.history.length - 1].subs - a.history[0].subs : -Infinity;
      const db = b.history && b.history.length > 1 ? b.history[b.history.length - 1].subs - b.history[0].subs : -Infinity;
      return db - da;
    });
  }

  rows.innerHTML = filtered.slice(0, visibleCount).map(c => {
    const gain = renderGainCell(c);
    return `<div class="channel-row" draggable="true" data-channel="${escapeHtml(c.handle)}">
      <div class="drag-handle" aria-hidden="true">⋮⋮</div>
      <div class="channel-info">${avatar(c)}<div><div class="channel-name">${escapeHtml(c.name)}</div><div class="channel-handle">${escapeHtml(c.handle)}</div></div></div>
      <span class="number">${formatSubs(c.subs)}</span>
      <span class="gain ${gain.cls}">${gain.html}</span>
      <span class="category">ー</span>
      <span class="status">Tracking</span>
      <button class="row-menu" aria-label="${escapeHtml(c.name)}を削除" data-remove-id="${escapeHtml(c.id)}">•••</button>
    </div>`;
  }).join('');

  rows.querySelectorAll('.channel-row').forEach(row => {
    row.addEventListener('dragstart', () => row.classList.add('dragging'));
    row.addEventListener('dragend', () => { row.classList.remove('dragging'); saveDraggedOrder() });
    row.addEventListener('dragover', event => {
      event.preventDefault();
      const dragging = rows.querySelector('.dragging');
      if (dragging && dragging !== row) {
        const box = row.getBoundingClientRect();
        rows.insertBefore(dragging, event.clientY < box.top + box.height / 2 ? row : row.nextSibling);
      }
    });
  });
  rows.querySelectorAll('.row-menu').forEach(btn => {
    btn.addEventListener('click', () => removeChannel(btn.dataset.removeId));
  });

  document.querySelector('#resultCount').textContent = `${filtered.length} channels`;
  document.querySelector('#loadMore').style.display = filtered.length > visibleCount ? 'block' : 'none';
}

function updateMetrics() {
  const known = channels.filter(c => typeof c.subs === 'number');
  const total = known.reduce((sum, c) => sum + c.subs, 0);
  document.querySelector('#totalSubscribers').textContent = known.length > 0 ? formatSubs(total) : 'ー';
  document.querySelector('.nav-count').textContent = String(channels.length);
}

function saveDraggedOrder() {
  const order = [...rows.querySelectorAll('.channel-row')].map(row => row.dataset.channel);
  const reordered = order.map(handle => channels.find(channel => channel.handle === handle)).filter(Boolean);
  if (reordered.length === channels.length) channels.splice(0, reordered.length, ...reordered);
  persistChannels();
  toast('表示順を保存しました');
}

function removeChannel(id) {
  const target = channels.find(c => c.id === id);
  if (!target) return;
  if (!confirm(`「${target.name}」を削除しますか？`)) return;
  channels = channels.filter(c => c.id !== id);
  persistChannels();
  updateMetrics();
  render();
  toast('削除しました');
}

function openModal() { document.querySelector('#modal').classList.add('open'); document.querySelector('#channelInput').focus() }
function closeModal() { document.querySelector('#modal').classList.remove('open') }
function toast(message) {
  const el = document.querySelector('#toast');
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

/* ===== YouTube Data API ===== */

function parseChannelInput(raw) {
  const value = raw.trim();
  if (!value) return null;

  const idMatch = value.match(/UC[a-zA-Z0-9_-]{22}/);
  if (idMatch) return { type: 'id', value: idMatch[0] };

  const urlMatch = value.match(/youtube\.com\/(channel\/|@|c\/|user\/)([^/?&#]+)/i);
  if (urlMatch) {
    const prefix = urlMatch[1];
    const name = urlMatch[2];
    if (prefix === 'channel/') return { type: 'id', value: name };
    if (prefix === '@') return { type: 'handle', value: '@' + name };
    if (prefix === 'user/') return { type: 'username', value: name };
    return { type: 'handle', value: '@' + name };
  }

  if (value.startsWith('@')) return { type: 'handle', value };
  return { type: 'handle', value: '@' + value };
}

function toChannelRecord(item) {
  const handle = item.snippet.customUrl
    ? (item.snippet.customUrl.startsWith('@') ? item.snippet.customUrl : '@' + item.snippet.customUrl)
    : '@' + item.id;
  return {
    id: item.id,
    name: item.snippet.title,
    handle,
    thumbnail: item.snippet.thumbnails?.default?.url || '',
    initial: item.snippet.title.slice(0, 2),
    color: '#d7e3da',
    subs: item.statistics.hiddenSubscriberCount ? null : Number(item.statistics.subscriberCount),
  };
}

async function fetchChannelByRef(ref, apiKey) {
  let url;
  if (ref.type === 'id') url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${encodeURIComponent(ref.value)}&key=${apiKey}`;
  else if (ref.type === 'handle') url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${encodeURIComponent(ref.value)}&key=${apiKey}`;
  else url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forUsername=${encodeURIComponent(ref.value)}&key=${apiKey}`;

  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'APIエラー');
  if (!data.items || data.items.length === 0) throw new Error('チャンネルが見つかりませんでした。');
  return toChannelRecord(data.items[0]);
}

async function fetchChannelsByIds(ids, apiKey) {
  if (ids.length === 0) return [];
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${encodeURIComponent(ids.join(','))}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'APIエラー');
  return (data.items || []).map(toChannelRecord);
}

const MAX_HISTORY_POINTS = 30;

/** 取得した最新の登録者数を、前回記録した値と違う時だけ履歴に積む（実際の変化だけをグラフにするため） */
function appendHistory(history, subs) {
  const next = Array.isArray(history) ? history.slice() : [];
  if (typeof subs !== 'number') return next;
  const last = next[next.length - 1];
  if (!last || last.subs !== subs) next.push({ t: Date.now(), subs });
  if (next.length > MAX_HISTORY_POINTS) next.splice(0, next.length - MAX_HISTORY_POINTS);
  return next;
}

async function refreshAllChannels() {
  const apiKey = getApiKey();
  if (channels.length === 0) return;
  if (!apiKey) { toast('先に設定でAPIキーを登録してください'); return; }
  try {
    const updated = await fetchChannelsByIds(channels.map(c => c.id), apiKey);
    const byId = new Map(updated.map(c => [c.id, c]));
    channels = channels.map(c => {
      const fresh = byId.get(c.id);
      if (!fresh) return c;
      return { ...c, ...fresh, history: appendHistory(c.history, fresh.subs) };
    });
    persistChannels();
    updateMetrics();
    render();
    toast('登録者数を更新しました');
  } catch (err) {
    toast('更新に失敗しました: ' + err.message);
  }
}

/* ===== Googleログイン & ドライブ保存（LeadLogと同じGIS方式） ===== */

let accessToken = null;
let account = loadCachedAccount();
let folderIdCache = null;
let driveFileId = null;

/** Google公式の「G」ロゴ（4色）。未ログイン時のボタンに表示する */
const GOOGLE_LOGO_SVG = `<svg class="google-logo" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;

function waitForGis(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (typeof google !== 'undefined' && google.accounts?.oauth2) resolve();
      else if (Date.now() - start > timeoutMs) reject(new Error('Googleログイン機能の読み込みに失敗しました。'));
      else setTimeout(tick, 100);
    };
    tick();
  });
}

async function getAccessToken(promptOverride) {
  const clientId = getClientId();
  if (!clientId) throw new Error('先に設定でGoogle OAuthクライアントIDを登録してください。');
  await waitForGis();
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: AUTH_SCOPE,
      callback: (res) => {
        if (res.error) { reject(new Error(res.error)); return; }
        accessToken = res.access_token;
        resolve(res.access_token);
      },
      error_callback: (err) => reject(new Error(err.type || 'ログインに失敗しました。')),
    });
    client.requestAccessToken({ prompt: promptOverride ?? 'consent' });
  });
}

async function driveFetch(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Googleドライブとの通信に失敗しました(${res.status}) ${body.slice(0, 160)}`);
  }
  return res;
}

async function ensureFolder() {
  if (folderIdCache) return folderIdCache;
  const q = encodeURIComponent(`name='${DRIVE_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const list = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`);
  const data = await list.json();
  if (data.files && data.files.length > 0) return (folderIdCache = data.files[0].id);
  const created = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  return (folderIdCache = (await created.json()).id);
}

async function findDataFile(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and name='${DATA_FILE_NAME}' and trashed=false`);
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`);
  const data = await res.json();
  return data.files && data.files.length > 0 ? data.files[0].id : null;
}

async function downloadData(fileId) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return res.json();
}

async function uploadData(folderId, fileId, obj) {
  const boundary = 'channelviewer-' + Date.now();
  const metadata = fileId ? { name: DATA_FILE_NAME } : { name: DATA_FILE_NAME, parents: [folderId] };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(obj)}`,
    `\r\n--${boundary}--`,
  ]);
  const base = 'https://www.googleapis.com/upload/drive/v3/files';
  const url = fileId ? `${base}/${fileId}?uploadType=multipart&fields=id` : `${base}?uploadType=multipart&fields=id`;
  const res = await driveFetch(url, {
    method: fileId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return (await res.json()).id;
}

async function fetchUserInfo() {
  const res = await driveFetch('https://www.googleapis.com/oauth2/v2/userinfo');
  const data = await res.json();
  return { email: data.email ?? null, name: data.name ?? null, avatarUrl: data.picture ?? null };
}

/** ログイン済みなら、現在のAPIキー・クライアントID・チャンネルリストをドライブに書き込む */
async function syncToDrive() {
  if (!accessToken) return;
  try {
    const folderId = await ensureFolder();
    if (driveFileId === null) driveFileId = await findDataFile(folderId);
    const payload = { apiKey: getApiKey(), clientId: getClientId(), channels };
    driveFileId = await uploadData(folderId, driveFileId, payload);
  } catch (err) {
    console.error('[drive-sync]', err);
  }
}

function updateAuthUI() {
  const avatarHtml = account?.avatarUrl ? `<img src="${account.avatarUrl}" alt="">` : GOOGLE_LOGO_SVG;
  document.querySelector('#authButton').innerHTML = avatarHtml;
  document.querySelector('#authButton').title = account ? (account.email || account.name || 'ログイン中') : 'クリックしてログイン';
  document.querySelector('#sidebarAvatar').innerHTML = avatarHtml;
  document.querySelector('#sidebarName').textContent = account ? (account.name || account.email || 'ログイン中') : 'ログインしていません';
  document.querySelector('#sidebarSub').textContent = account ? 'Googleドライブに保存中' : 'クリックしてログイン';
}

async function login(promptOverride) {
  try {
    await getAccessToken(promptOverride);
    const folderId = await ensureFolder();
    driveFileId = await findDataFile(folderId);
    account = await fetchUserInfo();
    saveCachedAccount(account);

    if (driveFileId) {
      const remote = await downloadData(driveFileId);
      if (typeof remote.apiKey === 'string') setApiKey(remote.apiKey);
      if (typeof remote.clientId === 'string') setClientId(remote.clientId);
      if (Array.isArray(remote.channels)) {
        channels = remote.channels.filter(c => c && c.id);
        localStorage.setItem(CHANNELS_KEY, JSON.stringify(channels));
      }
    } else {
      await syncToDrive();
    }

    updateAuthUI();
    document.querySelector('#apiKeyInput').value = getApiKey();
    document.querySelector('#clientIdInput').value = getClientId();
    visibleCount = Math.max(channels.length, 7);
    updateMetrics();
    render();
    toast('ログインしました');
    void refreshAllChannels();
  } catch (err) {
    toast('ログインに失敗しました: ' + err.message);
  }
}

function signOut() {
  if (accessToken && typeof google !== 'undefined' && google.accounts?.oauth2) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  account = null;
  driveFileId = null;
  folderIdCache = null;
  saveCachedAccount(null);
  updateAuthUI();
  toast('ログアウトしました');
}

function openAccountOrLogin() {
  if (account) {
    document.querySelector('#accountInfo').textContent = `${account.email || account.name || ''} のデータは Googleドライブの「${DRIVE_FOLDER_NAME}」フォルダに保存されています。`;
    document.querySelector('#accountModal').classList.add('open');
  } else {
    void login();
  }
}

/* ===== イベント結線 ===== */

document.querySelector('#openAdd').onclick = openModal;
document.querySelector('#openAddFromSidebar').onclick = openModal;
document.querySelector('#closeModal').onclick = closeModal;
document.querySelector('#cancelModal').onclick = closeModal;
document.querySelector('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal() });

search.addEventListener('input', render);
sort.addEventListener('change', render);
document.querySelector('#loadMore').onclick = () => { visibleCount = channels.length; render() };
document.querySelector('#refreshButton').onclick = () => void refreshAllChannels();

document.querySelectorAll('.nav-item').forEach(item => item.onclick = () => {
  document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
  item.classList.add('active');
  toast(`${item.textContent.trim()}ビューは準備中です`);
});

document.querySelector('#addForm').onsubmit = async (e) => {
  e.preventDefault();
  const apiKey = getApiKey();
  if (!apiKey) { toast('先に設定でAPIキーを登録してください'); return; }
  const raw = document.querySelector('#channelInput').value.trim();
  const ref = parseChannelInput(raw);
  if (!ref) return;
  try {
    const record = await fetchChannelByRef(ref, apiKey);
    record.history = appendHistory([], record.subs);
    if (channels.some(c => c.id === record.id)) {
      toast('すでに追加されています');
    } else {
      channels.push(record);
      visibleCount = channels.length;
      persistChannels();
      updateMetrics();
      render();
      toast(`${record.name} を追加しました`);
    }
    document.querySelector('#addForm').reset();
    closeModal();
  } catch (err) {
    toast('追加に失敗しました: ' + err.message);
  }
};

document.querySelector('#authButton').onclick = openAccountOrLogin;
document.querySelector('#sidebarProfile').onclick = openAccountOrLogin;
document.querySelector('#closeAccountModal').onclick = () => document.querySelector('#accountModal').classList.remove('open');
document.querySelector('#cancelAccountModal').onclick = () => document.querySelector('#accountModal').classList.remove('open');
document.querySelector('#accountModal').addEventListener('click', e => { if (e.target.id === 'accountModal') e.target.classList.remove('open') });
document.querySelector('#signOutBtn').onclick = () => { signOut(); document.querySelector('#accountModal').classList.remove('open') };

document.querySelector('#settingsButton').onclick = () => {
  document.querySelector('#apiKeyInput').value = getApiKey();
  document.querySelector('#clientIdInput').value = getClientId();
  document.querySelector('#settingsModal').classList.add('open');
};
document.querySelector('#closeSettingsModal').onclick = () => document.querySelector('#settingsModal').classList.remove('open');
document.querySelector('#cancelSettingsModal').onclick = () => document.querySelector('#settingsModal').classList.remove('open');
document.querySelector('#settingsModal').addEventListener('click', e => { if (e.target.id === 'settingsModal') e.target.classList.remove('open') });
document.querySelector('#settingsForm').onsubmit = (e) => {
  e.preventDefault();
  setApiKey(document.querySelector('#apiKeyInput').value.trim());
  setClientId(document.querySelector('#clientIdInput').value.trim());
  document.querySelector('#settingsModal').classList.remove('open');
  toast('設定を保存しました');
  void syncToDrive();
};

/* ===== 初期化 ===== */
updateAuthUI();
updateMetrics();
render();
if (channels.length > 0 && getApiKey()) void refreshAllChannels();
