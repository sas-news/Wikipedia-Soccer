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
  /** 履歴が途中まで省略されている（hは先頭1件+末尾側のみ） */
  t?: true;
  /** 省略されている場合の実際の総移動数 */
  m?: number;
  /** 省略されている場合の [P1の手数, P2の手数] */
  c?: [number, number];
}

const MAX_TITLE_LEN = 256;   // MediaWikiのタイトル上限255バイトに合わせた余裕値
export const MAX_SHARE_HISTORY = 2000; // これを超える履歴は省略して共有する

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

/** オブジェクトがSharedResultの形か検証（サーバー埋め込み/URLデコード共通） */
export function isSharedResult(o: unknown): o is SharedResult {
  if (typeof o !== 'object' || o === null || (o as { v?: unknown }).v !== 1) return false;
  const r = o as { s?: unknown; w?: unknown; g?: unknown; h?: unknown; t?: unknown; m?: unknown; c?: unknown };
  if (r.t !== undefined && r.t !== true) return false;
  if (r.m !== undefined && (typeof r.m !== 'number' || !Number.isInteger(r.m) || r.m < 0)) return false;
  if (r.c !== undefined &&
      (!Array.isArray(r.c) || r.c.length !== 2 ||
       r.c.some((n: unknown) => typeof n !== 'number' || !Number.isInteger(n) || n < 0))) {
    return false;
  }
  if (typeof r.s !== 'string' || !r.s || r.s.length > MAX_TITLE_LEN) return false;
  if (r.w !== 1 && r.w !== 2) return false;
  if (!Array.isArray(r.g) || r.g.length !== 2 ||
      r.g.some((t: unknown) => typeof t !== 'string' || !t || (t as string).length > MAX_TITLE_LEN)) {
    return false;
  }
  if (!Array.isArray(r.h) || r.h.length === 0 || r.h.length > MAX_SHARE_HISTORY) return false;
  for (const e of r.h) {
    if (!Array.isArray(e) || e.length !== 2) return false;
    if (typeof e[0] !== 'string' || !e[0] || e[0].length > MAX_TITLE_LEN) return false;
    if (e[1] !== 1 && e[1] !== 2) return false;
  }
  return true;
}

/** JSON文字列→SharedResult。壊れた/過大な入力を弾く（サーバー・クライアント共通の検証） */
export function parseSharedResult(json: string): SharedResult | null {
  try {
    const o: unknown = JSON.parse(json);
    return isSharedResult(o) ? o : null;
  } catch {
    return null;
  }
}

async function pipeThrough(bytes: Uint8Array, stream: TransformStream<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

// サーバー側の受理上限（/api/share のコード長・inflateRawSync の出力上限）と一致させる
const MAX_CODE_LEN = 20000;
const MAX_JSON_BYTES = 512 * 1024;

function countMovesPerPlayer(h: [string, 1 | 2][]): [number, number] {
  // h[0] はスタート地点（player=1 で記録されるが移動ではない）
  const p1 = h.reduce((n, e) => n + (e[1] === 1 ? 1 : 0), 0) - 1;
  return [p1, h.length - p1 - 1];
}

/** 履歴の中間を半分に間引き、省略フラグと元の手数情報を保持する */
function shrinkResult(r: SharedResult): SharedResult {
  const keep = Math.max(2, Math.floor(r.h.length / 2));
  return {
    ...r,
    h: [r.h[0], ...r.h.slice(-(keep - 1))],
    t: true,
    m: r.m ?? r.h.length - 1,
    c: r.c ?? countMovesPerPlayer(r.h),
  };
}

/** SharedResult → URLパラメータ文字列 ("d1.<b64>")。
 *  サーバーが受理できるサイズ（コード長・展開後JSON）に収まるまで履歴を間引き、
 *  収まらない/無効な結果なら null を返す */
export async function encodeResult(r: SharedResult): Promise<string | null> {
  let cur = r;
  for (let i = 0; i < 20; i++) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(cur));
    if (cur.h.length > MAX_SHARE_HISTORY || jsonBytes.byteLength > MAX_JSON_BYTES) {
      if (cur.h.length <= 2) return null;
      cur = shrinkResult(cur);
      continue;
    }
    if (!isSharedResult(cur)) return null;
    const code = typeof CompressionStream !== 'undefined'
      ? `d1.${base64UrlEncode(await pipeThrough(jsonBytes, new CompressionStream('deflate-raw')))}`
      : `j1.${base64UrlEncode(jsonBytes)}`;
    if (code.length <= MAX_CODE_LEN) return code;
    if (cur.h.length <= 2) return null;
    cur = shrinkResult(cur);
  }
  return null;
}

/** 結果コードをサーバー経由で外部ホストに預け、自ドメインの短い /r/<id> URLを得る。
 *  失敗時はロング ?r= URLにフォールバック（機能は維持） */
export async function shareCodeToUrl(code: string): Promise<string> {
  try {
    const res = await fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      const data = await res.json() as { id?: string | null };
      if (typeof data.id === 'string' && data.id) {
        return `${window.location.origin}/r/${data.id}`;
      }
    }
  } catch {
    // fallthrough
  }
  // フォールバックは /?r= に固定（/r/ 配下だと ?r= が読まれず結果が欠落する）
  return `${window.location.origin}/?r=${code}`;
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
