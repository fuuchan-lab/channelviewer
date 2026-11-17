import * as drive from './drive.js';
import { fetchChannel, fetchChannels } from './youtube.js';

/* ===================== 保存 ===================== */

const KEYS = {
  apiKey: 'subscope-api-key',
  channels: 'subscope-channels',
  account: 'subscope-drive-account',
  pending: 'channelviewer-pending',
  refreshedAt: 'channelviewer-refreshed-at',
};
const store = {
  get(key, fallback = null) {
    try { const raw = localStorage.getItem(key); return raw === null ? fallback : JSON.parse(raw); } catch { return fallback; }
  },
  set(key, value) {
    try { value == null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch { /* 容量不足などは無視 */ }
  },
};
// APIキーは以前のバージョンで JSON ではなく生の文字列で保存していたので、そのまま読む
const getApiKey = () => { try { return localStorage.getItem(KEYS.apiKey) || ''; } catch { return ''; } };
const setApiKey = (v) => { try { localStorage.setItem(KEYS.apiKey, v); } catch { /* 無視 */ } };

const MAX_HISTORY = 30;
const AUTO_REFRESH_MS = 10 * 60_000;

/* ===================== 状態 ===================== */

const state = {
  channels: (store.get(KEYS.channels, []) || []).filter((c) => c && c.id),
  account: store.get(KEYS.account),
  connecting: false,
  /** 電波がなくて、前回のログイン状態のまま開いている（ネットが戻ったら再接続する） */
  offlineRestored: false,
  pending: store.get(KEYS.pending, 0) || 0,
  sync: { status: 'idle', error: '', lastAt: 0 },
  refreshedAt: store.get(KEYS.refreshedAt, 0) || 0,
  refreshing: false,
  online: navigator.onLine,
};

/* ===================== 小物 ===================== */

const $ = (sel) => document.querySelector(sel);
const fmt = new Intl.NumberFormat('ja-JP');
const fmtCompact = new Intl.NumberFormat('ja-JP', { notation: 'compact', maximumFractionDigits: 1 });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
const signed = (n) => (n > 0 ? `+${fmt.format(n)}` : fmt.format(n));

function timeAgo(t) {
  if (!t) return '—';
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}時間前`;
  return new Date(t).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' });
}

const GOOGLE_LOGO = `<svg class="google-logo" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
</svg>`;

let toastTimer;
function toast(message, action) {
  const el = $('#toast');
  const btn = el.querySelector('button');
  el.querySelector('span').textContent = message;
  btn.hidden = !action;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => { el.classList.remove('show'); action.run(); };
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 6000 : 2800);
}

/** ログインの成否などの、読み終えるまで残すお知らせ（LeadLog と同じ。タップで閉じる） */
function notice(kind, message, detail) {
  const el = $('#notice');
  el.className = `banner ${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `${esc(message)}${detail ? `<br><small>詳細: ${esc(detail)}</small>` : ''}${kind === 'error' ? '<br><small class="muted">タップすると閉じます</small>' : ''}`;
  el.hidden = false;
  if (kind === 'ok') setTimeout(() => { if (el.textContent.startsWith(message)) el.hidden = true; }, 8000);
}
$('#notice').addEventListener('click', (e) => { e.currentTarget.hidden = true; });

/* ===================== 計算 ===================== */

function growthOf(c) {
  const h = c.history;
  if (!h || h.length < 2) return null;
  const first = h[0].subs;
  const diff = h[h.length - 1].subs - first;
  return { diff, pct: first > 0 ? (diff / first) * 100 : 0, since: h[0].t };
}

/** 前回と違う値の時だけ履歴に積む（実際の変化だけをグラフにする） */
function appendHistory(history, subs) {
  const next = Array.isArray(history) ? history.slice(-MAX_HISTORY) : [];
  if (typeof subs !== 'number') return next;
  if (next.at(-1)?.subs !== subs) next.push({ t: Date.now(), subs });
  return next.slice(-MAX_HISTORY);
}

function sparkline(history, up) {
  if (!history || history.length < 2) return '';
  const values = history.map((p) => p.subs);
  const min = Math.min(...values);
  const range = Math.max(...values) - min || 1;
  const w = 72, h = 24;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / range) * (h - 4)).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
<polyline points="0,${h} ${pts.join(' ')} ${w},${h}" class="spark-fill ${up ? 'up' : 'down'}"/>
<polyline points="${pts.join(' ')}" class="spark-line ${up ? 'up' : 'down'}"/></svg>`;
}

function avatar(c, cls = 'avatar') {
  const initial = esc((c.name || '?').slice(0, 1));
  const img = c.thumbnail ? `<img src="${esc(c.thumbnail)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '';
  return `<span class="${cls}" aria-hidden="true"><span>${initial}</span>${img}</span>`;
}

/* ===================== 描画 ===================== */

const rows = $('#rows');
const searchInput = $('#search');
const sortSelect = $('#sort');

const canReorder = () => sortSelect.value === 'manual' && !searchInput.value.trim();

function visibleChannels() {
  const q = searchInput.value.trim().toLowerCase();
  const list = q ? state.channels.filter((c) => `${c.name} ${c.handle}`.toLowerCase().includes(q)) : state.channels.slice();
  const mode = sortSelect.value;
  if (mode === 'name') list.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  else if (mode === 'subscribers') list.sort((a, b) => (b.subs ?? -1) - (a.subs ?? -1));
  else if (mode === 'growth') list.sort((a, b) => (growthOf(b)?.pct ?? -Infinity) - (growthOf(a)?.pct ?? -Infinity));
  return list;
}

function renderRows() {
  const list = visibleChannels();
  const total = state.channels.reduce((s, c) => s + (c.subs ?? 0), 0);
  rows.innerHTML = list.map((c) => {
    const g = growthOf(c);
    const up = !g || g.diff >= 0;
    const trend = g
      ? `${sparkline(c.history, up)}<span class="trend-text"><b>${g.pct > 0 ? '+' : ''}${g.pct.toFixed(2)}%</b><small>${signed(g.diff)}</small></span>`
      : '<span class="collecting">収集中</span>';
    const share = total && c.subs ? Math.max(2, (c.subs / total) * 100) : 0;
    return `<div class="row" data-id="${esc(c.id)}">
  <span class="drag-handle" title="ドラッグして並び替え" aria-hidden="true">⋮⋮</span>
  <a class="channel" href="https://www.youtube.com/channel/${encodeURIComponent(c.id)}" target="_blank" rel="noopener">
    ${avatar(c)}<span class="channel-text"><span class="channel-name">${esc(c.name)}</span><span class="channel-handle">${esc(c.handle)}</span></span>
  </a>
  <span class="subs"><span class="num">${c.subs == null ? '非公開' : fmt.format(c.subs)}</span><span class="share" aria-hidden="true"><i style="width:${share.toFixed(1)}%"></i></span></span>
  <span class="trend ${g ? (g.diff > 0 ? 'up' : g.diff < 0 ? 'down' : '') : ''}">${trend}</span>
  <button class="row-remove" data-remove="${esc(c.id)}" aria-label="${esc(c.name)}を削除" title="削除">
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 7h14M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </button>
</div>`;
  }).join('');

  const empty = state.channels.length === 0;
  $('#empty').hidden = !empty;
  $('#table').classList.toggle('is-empty', empty);
  $('#table').classList.toggle('reorder-off', !canReorder());
  $('#resultCount').textContent = list.length === state.channels.length ? `${list.length} channels` : `${list.length} / ${state.channels.length} channels`;
  $('#reorderHint').hidden = !canReorder() || list.length < 2;
}

function renderSidebar() {
  $('#navCount').textContent = state.channels.length;
  $('#miniList').innerHTML = state.channels.map((c) =>
    `<li><a href="https://www.youtube.com/channel/${encodeURIComponent(c.id)}" target="_blank" rel="noopener">${avatar(c, 'avatar small')}<span class="mini-name">${esc(c.name)}</span><span class="mini-subs">${c.subs == null ? '—' : fmtCompact.format(c.subs)}</span></a></li>`,
  ).join('');
}

function renderMetrics() {
  const known = state.channels.filter((c) => typeof c.subs === 'number');
  $('#mTotal').textContent = known.length ? fmt.format(known.reduce((s, c) => s + c.subs, 0)) : '—';
  $('#mTotalFoot').textContent = state.channels.length ? `${state.channels.length} チャンネルの合計` : '登録チャンネルの合計';

  const growths = state.channels.map(growthOf).filter(Boolean);
  const growthEl = $('#mGrowth');
  if (growths.length) {
    const sum = growths.reduce((s, g) => s + g.diff, 0);
    const since = Math.min(...growths.map((g) => g.since));
    growthEl.textContent = signed(sum);
    growthEl.className = `metric-value ${sum > 0 ? 'up' : sum < 0 ? 'down' : ''}`;
    $('#mGrowthFoot').textContent = `${new Date(since).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })} からの変化（${growths.length} チャンネル）`;
  } else {
    growthEl.textContent = '—';
    growthEl.className = 'metric-value';
    $('#mGrowthFoot').textContent = '更新するたびに記録します';
  }
  renderClock();
}

/** 時刻の表示（1分ごとに更新） */
function renderClock() {
  $('#mUpdated').textContent = state.refreshing ? '更新中…' : timeAgo(state.refreshedAt);
  $('#mUpdatedFoot').textContent = state.online ? '開いている間、10分ごとに自動更新' : 'オフライン（保存済みのデータを表示中）';
  $('#statusTitle').textContent = state.online ? 'LIVE DATA' : 'OFFLINE';
  $('#statusSub').textContent = state.refreshedAt ? `最終更新 ${timeAgo(state.refreshedAt)}` : 'まだ更新していません';
  $('#statusCard').classList.toggle('offline', !state.online);
  const pill = $('#livePill');
  pill.classList.toggle('offline', !state.online);
  pill.querySelector('span').textContent = state.online ? 'LIVE' : 'OFFLINE';
  $('#refreshButton').classList.toggle('spinning', state.refreshing);
  $('#refreshButton').disabled = state.refreshing;
}

function renderAuth() {
  const { account, connecting } = state;
  const btn = $('#authButton');
  const live = !!account && !connecting && state.online;
  const mark = btn.querySelector('.google-mark');
  mark.innerHTML = account?.avatarUrl ? `<img src="${esc(account.avatarUrl)}" alt="" referrerpolicy="no-referrer">` : GOOGLE_LOGO;
  const text = btn.querySelector('.google-text');
  text.textContent = connecting ? '接続中…' : account ? 'Google\n接続中' : 'ログイン';
  text.classList.toggle('connected', !!account && !connecting);
  btn.classList.toggle('google-button-live', live);
  btn.disabled = connecting;
  btn.title = account ? (account.email || account.name || 'Googleアカウント') : 'Googleでログイン';
  btn.setAttribute('aria-label', account ? `アカウント: ${account.email || account.name || ''}` : 'Googleでログイン');

  const badge = btn.querySelector('.sync-badge');
  badge.hidden = !(account && state.pending > 0);
  badge.textContent = state.pending > 9 ? '9+' : String(state.pending);
  badge.setAttribute('aria-label', `未同期の変更 ${state.pending} 件`);

  if ($('#accountModal').open) renderAccountModal();
}

function renderAccountModal() {
  const { account, sync } = state;
  if (!account) return;
  $('#accountAvatar').innerHTML = account.avatarUrl ? `<img src="${esc(account.avatarUrl)}" alt="" referrerpolicy="no-referrer">` : GOOGLE_LOGO;
  $('#accountName').textContent = account.name || 'Googleアカウント';
  $('#accountEmail').textContent = account.email || '';
  const line = $('#syncLine');
  let text;
  if (sync.status === 'syncing') text = '同期中…';
  else if (!state.online) text = `オフラインです。ネットにつながると同期します${state.pending ? `（未同期 ${state.pending} 件）` : ''}。`;
  else if (sync.status === 'error') text = `同期に失敗しました${state.pending ? `（未同期 ${state.pending} 件）` : ''}。詳細: ${sync.error}`;
  else if (state.pending) text = `未同期の変更が ${state.pending} 件あります。`;
  else if (sync.lastAt) text = `同期済み（${new Date(sync.lastAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}）`;
  else text = '同期の準備中…';
  line.textContent = text;
  line.classList.toggle('error', sync.status === 'error');
  $('#syncNowButton').disabled = sync.status === 'syncing' || !state.online;
}

function renderAll() {
  renderRows();
  renderSidebar();
  renderMetrics();
  renderAuth();
}

/* ===================== データの変更とドライブ同期 ===================== */

let syncTimer;
let syncing = false;
/** 操作の直後に取り直したトークンが届くのを、同期の前に待つ */
let tokenReady = Promise.resolve();
let syncAgain = false;

/** 変更を保存し、ログイン中ならドライブへ送る。userAction: ボタン操作の直後か（トークンを取り直せる） */
function commit({ userAction = true } = {}) {
  store.set(KEYS.channels, state.channels);
  if (state.account) {
    state.pending += 1;
    store.set(KEYS.pending, state.pending);
    // 時間をおいてからではポップアップを開けないので、期限切れのトークンはこの場で取り直す
    if (userAction && state.online && !state.offlineRestored) tokenReady = drive.ensureFreshToken().catch(() => {});
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => void syncNow(), 800);
  }
  renderAll();
}

const payload = () => ({ version: 2, apiKey: getApiKey(), clientId: drive.getCustomClientId(), channels: state.channels, savedAt: Date.now() });

async function syncNow() {
  if (!state.account || state.offlineRestored) return;
  if (!state.online) { renderAuth(); return; }
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  const sent = state.pending;
  state.sync.status = 'syncing';
  renderAuth();
  try {
    await tokenReady;
    await drive.saveData(payload());
    state.pending = Math.max(0, state.pending - sent);
    store.set(KEYS.pending, state.pending || null);
    state.sync = { status: 'idle', error: '', lastAt: Date.now() };
  } catch (e) {
    console.error('[drive-sync]', e);
    state.sync = { ...state.sync, status: 'error', error: e instanceof Error ? e.message : String(e) };
  } finally {
    syncing = false;
    renderAuth();
    if (syncAgain) { syncAgain = false; void syncNow(); }
  }
}

/** ログイン直後: ドライブのデータを取り込む。こちらに未同期の変更があれば、こちらを正としてアップロードする */
async function pullFromDrive() {
  const remote = await drive.loadData();
  if (remote && !state.pending) {
    if (typeof remote.apiKey === 'string' && remote.apiKey) setApiKey(remote.apiKey);
    if (typeof remote.clientId === 'string' && remote.clientId && !drive.getCustomClientId()) drive.setCustomClientId(remote.clientId);
    if (Array.isArray(remote.channels)) {
      state.channels = remote.channels.filter((c) => c && c.id);
      store.set(KEYS.channels, state.channels);
    }
    state.sync = { status: 'idle', error: '', lastAt: Date.now() };
  } else {
    state.pending = Math.max(state.pending, 1);
    await syncNow();
  }
}

/* ===================== Googleログイン（LeadLog と同じ流れ） ===================== */

const LOGIN_ERRORS = {
  incomplete: 'ログインが完了しませんでした。もう一度お試しください。他のアプリの中で開いている場合は、Safari（iPhone）や Chrome（Android）でこのページを直接開いてください。',
  failed: 'Googleへのログインに失敗しました。もう一度お試しください。他のアプリの中で開いている場合は、Safari（iPhone）や Chrome（Android）でこのページを直接開いてください。',
  driveNotGranted: 'Google ドライブへのアクセスが許可されていません。もう一度ログインし、確認画面で「Google ドライブのファイル…」の項目にチェックを入れて「続行」を押してください。',
  driveApiOff: 'Google ドライブに接続できません（Google Cloud のプロジェクトで Google Drive API が有効になっていません）。',
  offline: 'オフラインのためログインできません。ネットにつながってからもう一度お試しください。',
};

function setConnecting(v) { state.connecting = v; renderAuth(); }

/** ログインしてドライブのデータを読み込む。成功したら true */
async function connect(prompt = null, restoring = false) {
  setConnecting(true);
  try {
    if (restoring) {
      // 前回のトークンが有効ならそれを使う（サードパーティCookieを止めるブラウザでは無言の再取得が失敗するため）
      if (!drive.restoreStoredToken()) await drive.getAccessToken(false);
    } else {
      // ボタン操作の直後なので、await を挟まずにここでポップアップを開く
      await drive.getAccessToken(true, prompt);
    }
    const info = await drive.fetchUserInfo();
    drive.setSession(true);
    state.account = info;
    state.offlineRestored = false;
    store.set(KEYS.account, info);
    await pullFromDrive();
    renderAll();
    return true;
  } catch (e) {
    const cached = store.get(KEYS.account);
    if (restoring && cached && (drive.isNetworkError(e) || !navigator.onLine)) {
      state.offlineRestored = true;
      state.account = cached;
      return true;
    }
    state.account = null;
    store.set(KEYS.account, null);
    drive.setSession(false);
    drive.clearToken();
    if (!restoring) {
      console.error('[login]', e);
      const message = e instanceof Error ? e.message : '';
      const key = message === 'drive_scope_not_granted' || /insufficient(Permissions|Scopes)|ACCESS_TOKEN_SCOPE_INSUFFICIENT/.test(message) ? 'driveNotGranted'
        : /accessNotConfigured|SERVICE_DISABLED/.test(message) ? 'driveApiOff'
        : drive.isNetworkError(e) && !navigator.onLine ? 'offline'
        : ['popup_closed', 'login_timeout', 'popup_failed_to_open'].includes(message) ? 'incomplete'
        : 'failed';
      notice('error', LOGIN_ERRORS[key], drive.describeError(e));
    }
    return false;
  } finally {
    setConnecting(false);
  }
}

async function login() {
  if (await connect()) {
    notice('ok', 'Googleアカウントでログインしました。チャンネルリストと設定は Google ドライブの「ChannelViewer」フォルダーに保存され、同じアカウントの端末と共有されます。');
    void refreshAll({ quiet: true });
  }
}

function signOut() {
  drive.signOutDrive();
  state.account = null;
  state.offlineRestored = false;
  state.pending = 0;
  state.sync = { status: 'idle', error: '', lastAt: 0 };
  store.set(KEYS.account, null);
  store.set(KEYS.pending, null);
  renderAuth();
}

async function switchAccount() {
  signOut();
  if (await connect('select_account')) {
    notice('ok', 'アカウントを切り替えました。');
    void refreshAll({ quiet: true });
  }
}

/* ===================== YouTube ===================== */

async function refreshAll({ quiet = false } = {}) {
  const apiKey = getApiKey();
  if (!state.channels.length || state.refreshing) return;
  if (!apiKey) { if (!quiet) openSettings('先に YouTube Data API キーを登録してください'); return; }
  if (!state.online) { if (!quiet) toast('オフラインのため更新できません'); return; }
  state.refreshing = true;
  renderClock();
  try {
    const fresh = new Map((await fetchChannels(state.channels.map((c) => c.id), apiKey)).map((c) => [c.id, c]));
    state.channels = state.channels.map((c) => {
      const f = fresh.get(c.id);
      return f ? { ...c, ...f, history: appendHistory(c.history, f.subs) } : c;
    });
    state.refreshedAt = Date.now();
    store.set(KEYS.refreshedAt, state.refreshedAt);
    state.refreshing = false;
    commit({ userAction: !quiet });
    if (!quiet) toast('登録者数を更新しました');
  } catch (e) {
    state.refreshing = false;
    renderClock();
    if (!quiet) toast(`更新に失敗しました: ${e.message}`);
    else console.warn('[refresh]', e);
  }
}

/* ===================== 並び替え（マウス・タッチ共通） ===================== */

rows.addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.drag-handle');
  if (!handle || !canReorder()) return;
  const row = handle.closest('.row');
  e.preventDefault();
  handle.setPointerCapture(e.pointerId);
  row.classList.add('dragging');
  const before = [...rows.children].map((r) => r.dataset.id).join();

  const move = (ev) => {
    const target = [...rows.children].find((r) => r !== row && ev.clientY < r.getBoundingClientRect().top + r.offsetHeight / 2);
    if (target !== row.nextElementSibling) rows.insertBefore(row, target ?? null);
  };
  const end = () => {
    handle.removeEventListener('pointermove', move);
    row.classList.remove('dragging');
    const order = [...rows.children].map((r) => r.dataset.id);
    if (order.join() === before) return;
    const byId = new Map(state.channels.map((c) => [c.id, c]));
    state.channels = order.map((id) => byId.get(id)).filter(Boolean);
    commit();
    toast('表示順を保存しました');
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end, { once: true });
  handle.addEventListener('pointercancel', end, { once: true });
});

rows.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  const index = state.channels.findIndex((c) => c.id === btn.dataset.remove);
  if (index < 0) return;
  const [removed] = state.channels.splice(index, 1);
  commit();
  toast(`「${removed.name}」を削除しました`, {
    label: '元に戻す',
    run: () => {
      if (state.channels.some((c) => c.id === removed.id)) return;
      state.channels.splice(Math.min(index, state.channels.length), 0, removed);
      commit();
    },
  });
});

// 読み込めなかったサムネイルは消して、頭文字を見せる
document.addEventListener('error', (e) => {
  if (e.target instanceof HTMLImageElement && e.target.closest('.avatar, .google-mark')) e.target.remove();
}, true);

/* ===================== ダイアログ ===================== */

function openDialog(id) {
  const dlg = $(id);
  if (!dlg.open) dlg.showModal();
  return dlg;
}
document.querySelectorAll('dialog').forEach((dlg) => {
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return dlg.close();
    if (e.target !== dlg || !e.clientX) return;
    // 枠の外（背景）を押した時だけ閉じる
    const r = dlg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
  });
});

function openAdd() {
  openDialog('#addModal');
  $('#channelInput').focus();
}
document.querySelectorAll('[data-action="add"]').forEach((b) => b.addEventListener('click', openAdd));

$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const apiKey = getApiKey();
  if (!apiKey) { $('#addModal').close(); openSettings('先に YouTube Data API キーを登録してください'); return; }
  if (!state.online) { toast('オフラインのため追加できません'); return; }
  const submit = $('#addSubmit');
  submit.disabled = true;
  submit.textContent = '検索中…';
  try {
    const record = await fetchChannel($('#channelInput').value, apiKey);
    if (state.channels.some((c) => c.id === record.id)) {
      toast('すでに追加されています');
    } else {
      record.history = appendHistory([], record.subs);
      state.channels.push(record);
      commit();
      toast(`${record.name} を追加しました`);
    }
    e.target.reset();
    $('#addModal').close();
  } catch (err) {
    toast(`追加に失敗しました: ${err.message}`);
  } finally {
    submit.disabled = false;
    submit.textContent = '追加する →';
  }
});

function openSettings(message) {
  $('#apiKeyInput').value = getApiKey();
  $('#clientIdInput').value = drive.getCustomClientId();
  $('.advanced').open = !!drive.getCustomClientId();
  // まだキーがない時は、取り方を最初から開いておく
  $('#apiKeyGuide').open = !getApiKey();
  openDialog('#settingsModal');
  if (message) { toast(message); $('#apiKeyInput').focus(); }
}
$('#settingsButton').addEventListener('click', () => openSettings());

$('#settingsForm').addEventListener('submit', () => {
  const hadKey = !!getApiKey();
  setApiKey($('#apiKeyInput').value.trim());
  const newClient = $('#clientIdInput').value.trim();
  const clientChanged = newClient !== drive.getCustomClientId();
  drive.setCustomClientId(newClient);
  toast('設定を保存しました');
  if (clientChanged && state.account) {
    // 別のクライアントでは、今のトークンでドライブのファイルが見えないので、ログインし直してもらう
    signOut();
    notice('ok', 'OAuth クライアントIDを変更したため、ログアウトしました。もう一度ログインしてください。');
  } else {
    commit();
  }
  if (!hadKey && getApiKey()) void refreshAll();
});

$('#authButton').addEventListener('click', () => {
  if (state.account) { renderAccountModal(); openDialog('#accountModal'); }
  else void login();
});
$('#syncNowButton').addEventListener('click', () => {
  tokenReady = drive.ensureFreshToken().catch(() => {});
  state.pending = Math.max(state.pending, 1);
  void syncNow();
});
$('#switchButton').addEventListener('click', () => { $('#accountModal').close(); void switchAccount(); });
$('#signOutButton').addEventListener('click', () => { $('#accountModal').close(); signOut(); toast('ログアウトしました'); });

$('#refreshButton').addEventListener('click', () => void refreshAll());
searchInput.addEventListener('input', renderRows);
sortSelect.addEventListener('change', renderRows);

/* ===================== オフライン・アプリ化 ===================== */

function setOnline(online) {
  state.online = online;
  renderClock();
  renderAuth();
  if (!online) return;
  if (state.offlineRestored && drive.hasSession()) void connect(null, true);
  else if (state.pending) void syncNow();
  if (Date.now() - state.refreshedAt > AUTO_REFRESH_MS) void refreshAll({ quiet: true });
}
window.addEventListener('online', () => setOnline(true));
window.addEventListener('offline', () => setOnline(false));

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[sw]', e));
}

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  $('#installBox').hidden = false;
  $('#installButton').hidden = false;
});
window.addEventListener('appinstalled', () => { installPrompt = null; $('#installBox').hidden = true; toast('アプリとしてインストールしました'); });
$('#installButton').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('#installBox').hidden = true;
});
// iPhone・iPad の Safari にはインストールの案内が出ないので、手順を表示する
if (!isStandalone() && /iP(hone|ad|od)/.test(navigator.userAgent)) {
  $('#installBox').hidden = false;
  $('#installButton').hidden = true;
  $('#installText').textContent = '共有ボタン（□↑）から「ホーム画面に追加」を選ぶと、アプリとして使えます。オフラインでも開けます。';
}

/* ===================== 起動 ===================== */

renderAll();
if (drive.hasSession() && state.account) void connect(null, true).then(() => renderAuth());
else if (state.account) { state.account = null; store.set(KEYS.account, null); renderAuth(); }

// ホーム画面のアイコンを長押しした「チャンネルを追加」から開いた時
if (new URLSearchParams(location.search).has('add')) {
  history.replaceState(null, '', location.pathname);
  openAdd();
}

if (Date.now() - state.refreshedAt > 60_000) void refreshAll({ quiet: true });
setInterval(() => {
  renderClock();
  if (document.visibilityState === 'visible' && Date.now() - state.refreshedAt > AUTO_REFRESH_MS) void refreshAll({ quiet: true });
}, 60_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - state.refreshedAt > AUTO_REFRESH_MS) void refreshAll({ quiet: true });
});
