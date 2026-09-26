// 対戦結果を自己完結URL (?r=...) に埋め込むためのコーデック。
// サーバーに結果を保存しないため、URL本体がデータ。deflate-raw + base64url で圧縮する。
// ブラウザは CompressionStream、サーバー(OGP注入)は zlib.inflateRawSync で読む。

export interface SharedResult {
  v: 1;
  /** スタートページ */
  s: string;
  /** 勝者 (1 | 2) */
  w: 1 | 2;
  /** [P1の目標, P2の目標] */
  g: [string, string];
  /** 移動履歴 [タイトル, 手番プレイヤー]（先頭はスタート） */
  h: [string, 1 | 2][];
}

const MAX_TITLE_LEN = 200;
const MAX_HISTORY = 500;

export function base64UrlEncode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(s: string): Uint8Array | null {
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** JSON文字列→SharedResult。壊れた/過大な入力を弾く（サーバー・クライアント共通の検証） */
export function parseSharedResult(json: string): SharedResult | null {
  try {
    const o = JSON.parse(json);
    if (typeof o !== 'object' || o === null || o.v !== 1) return null;
    if (typeof o.s !== 'string' || !o.s || o.s.length > MAX_TITLE_LEN) return null;
    if (o.w !== 1 && o.w !== 2) return null;
    if (!Array.isArray(o.g) || o.g.length !== 2 ||
        o.g.some((t: unknown) => typeof t !== 'string' || !t || (t as string).length > MAX_TITLE_LEN)) {
      return null;
    }
    if (!Array.isArray(o.h) || o.h.length === 0 || o.h.length > MAX_HISTORY) return null;
    for (const e of o.h) {
      if (!Array.isArray(e) || e.length !== 2) return null;
      if (typeof e[0] !== 'string' || !e[0] || e[0].length > MAX_TITLE_LEN) return null;
      if (e[1] !== 1 && e[1] !== 2) return null;
    }
    return o as SharedResult;
  } catch {
    return null;
  }
}

async function pipeThrough(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** SharedResult → URLパラメータ文字列 ("d1.<b64>" / 圧縮非対応環境は "j1.<b64>") */
export async function encodeResult(r: SharedResult): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(r));
  if (typeof CompressionStream !== 'undefined') {
    const deflated = await pipeThrough(json, new CompressionStream('deflate-raw'));
    return `d1.${base64UrlEncode(deflated)}`;
  }
  return `j1.${base64UrlEncode(json)}`;
}

/** 長い ?r= URLをサーバー経由で短縮。失敗・拒否時は元URLをそのまま返す */
export async function shortenShareUrl(longUrl: string): Promise<string> {
  try {
    const res = await fetch(`/api/shorten?url=${encodeURIComponent(longUrl)}`);
    if (!res.ok) return longUrl;
    const data = await res.json();
    return typeof data.url === 'string' && data.url ? data.url : longUrl;
  } catch {
    return longUrl;
  }
}

/** URLパラメータ文字列 → SharedResult（解釈不能なら null） */
export async function decodeResult(param: string): Promise<SharedResult | null> {
  const dot = param.indexOf('.');
  if (dot < 0) return null;
  const ver = param.slice(0, dot);
  const bytes = base64UrlDecode(param.slice(dot + 1));
  if (!bytes) return null;
  try {
    if (ver === 'd1') {
      if (typeof DecompressionStream === 'undefined') return null;
      const inflated = await pipeThrough(bytes, new DecompressionStream('deflate-raw'));
      return parseSharedResult(new TextDecoder().decode(inflated));
    }
    if (ver === 'j1') {
      return parseSharedResult(new TextDecoder().decode(bytes));
    }
    return null;
  } catch {
    return null;
  }
}
