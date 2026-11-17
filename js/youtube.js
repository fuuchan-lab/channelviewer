/** YouTube Data API v3（channels.list）。1回の呼び出しで最大50チャンネル、1ユニット */
const ENDPOINT = 'https://www.googleapis.com/youtube/v3/channels';
const MAX_IDS = 50;

const REASONS = {
  keyInvalid: 'APIキーが正しくありません。設定を確認してください。',
  quotaExceeded: '本日の YouTube API の利用上限に達しました。明日もう一度お試しください。',
  accessNotConfigured: 'このAPIキーのプロジェクトで YouTube Data API v3 が有効になっていません。',
};

async function request(params, apiKey) {
  const url = `${ENDPOINT}?${new URLSearchParams({ part: 'snippet,statistics', ...params, key: apiKey })}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data.error?.errors?.[0]?.reason;
    throw new Error(REASONS[reason] || data.error?.message || `YouTube API エラー (${res.status})`);
  }
  return data.items || [];
}

/** URL・ハンドル・チャンネルIDのどれでも受け付ける */
export function parseChannelInput(raw) {
  const value = raw.trim();
  if (!value) return null;
  const id = value.match(/UC[\w-]{22}/);
  if (id) return { id: id[0] };
  const url = value.match(/youtube\.com\/(channel\/|@|c\/|user\/)([^/?&#]+)/i);
  if (url) {
    const [, prefix, name] = url;
    if (prefix === 'channel/') return { id: name };
    if (prefix === 'user/') return { forUsername: name };
    return { forHandle: `@${decodeURIComponent(name)}` };
  }
  return { forHandle: value.startsWith('@') ? value : `@${value}` };
}

function toRecord(item) {
  const custom = item.snippet.customUrl;
  return {
    id: item.id,
    name: item.snippet.title,
    handle: custom ? (custom.startsWith('@') ? custom : `@${custom}`) : '',
    thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
    subs: item.statistics.hiddenSubscriberCount ? null : Number(item.statistics.subscriberCount),
  };
}

export async function fetchChannel(raw, apiKey) {
  const params = parseChannelInput(raw);
  if (!params) throw new Error('チャンネルのURLまたはハンドルを入力してください。');
  const [item] = await request(params, apiKey);
  if (!item) throw new Error('チャンネルが見つかりませんでした。');
  return toRecord(item);
}

export async function fetchChannels(ids, apiKey) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += MAX_IDS) chunks.push(ids.slice(i, i + MAX_IDS));
  const results = await Promise.all(chunks.map((chunk) => request({ id: chunk.join(','), maxResults: MAX_IDS }, apiKey)));
  return results.flat().map(toRecord);
}
