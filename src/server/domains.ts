/**
 * ドメイン（大分類）定義。
 * プール発掘に使うカテゴリと、記事→ドメインタグの対応表。
 * 出題フローではドメイン関係（same/adjacent/diff）だけを参照する。
 */

/** プール発掘に使う層別カテゴリ（日本語Wikipediaのカテゴリ名） */
export const POOL_CATEGORIES = [
  '科学', '物理学', '化学', '生物学', '数学', '天文学', '地球科学', '生態学', '遺伝学',
  '哺乳類', '鳥類', '魚類', '昆虫', '植物', '菌類', '鉱物', '化学元素', '星座',
  '日本の歴史', '世界史', '江戸時代', '明治時代', '第二次世界大戦', '冷戦', '日本の戦国時代',
  '日本の都市', '国', '山脈', '海洋', '河川', '日本の地理',
  '球技', '格闘技', 'オリンピック競技', 'テニス', '将棋', '囲碁', '武道',
  '音楽', '映画', '文学', '美術', '漫画', 'アニメ', '伝統芸能', '料理', '菓子', '酒',
  'コンピュータ', '人工知能', 'インターネット', '自動車', '航空', '電気機器', '鉄道',
  '経済学', '政治学', '法学', '教育学', '医学', '宗教', '哲学', '倫理学',
  '神社', '仏教', '神道', '妖怪', '伝説',
];

const CATEGORY_DOMAIN: Record<string, string> = {};
function register(name: string, cats: string[]) {
  for (const c of cats) CATEGORY_DOMAIN[c] = name;
}
register('科学', ['科学', '物理学', '化学', '生物学', '数学', '天文学', '地球科学', '生態学', '遺伝学',
  '哺乳類', '鳥類', '魚類', '昆虫', '植物', '菌類', '鉱物', '化学元素', '星座']);
register('歴史', ['日本の歴史', '世界史', '江戸時代', '明治時代', '第二次世界大戦', '冷戦', '日本の戦国時代']);
register('地理', ['日本の都市', '国', '山脈', '海洋', '河川', '日本の地理']);
register('スポーツ', ['球技', '格闘技', 'オリンピック競技', 'テニス', '将棋', '囲碁', '武道']);
register('文化', ['音楽', '映画', '文学', '美術', '漫画', 'アニメ', '伝統芸能', '料理', '菓子', '酒']);
register('技術', ['コンピュータ', '人工知能', 'インターネット', '自動車', '航空', '電気機器', '鉄道']);
register('社会', ['経済学', '政治学', '法学', '教育学', '医学', '宗教', '哲学', '倫理学']);
register('宗教', ['神社', '仏教', '神道', '妖怪', '伝説']);

/** 隣接ドメイン関係（adjacent = 連想が飛びやすい組み合わせ） */
const ADJACENT: Record<string, string[]> = {
  '科学': ['技術', '地理'],
  '技術': ['科学', '社会'],
  '社会': ['技術', '歴史', '宗教'],
  '歴史': ['社会', '地理', '文化', '宗教'],
  '地理': ['歴史', '科学'],
  'スポーツ': ['文化'],
  '文化': ['歴史', 'スポーツ', '宗教'],
  '宗教': ['歴史', '文化', '社会'],
};

export type DomainRel = 'same' | 'adjacent' | 'diff' | 'unknown';

export function domainRel(a: Set<string>, b: Set<string>): DomainRel {
  if (a.size === 0 || b.size === 0) return 'unknown';
  for (const x of a) if (b.has(x)) return 'same';
  for (const x of a) {
    for (const y of ADJACENT[x] ?? []) {
      if (b.has(y)) return 'adjacent';
    }
  }
  return 'diff';
}

/** 記事のカテゴリ集合からドメインタグを推論 */
export function domainsFromCats(cats: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const c of cats) {
    const d = CATEGORY_DOMAIN[c];
    if (d) out.add(d);
  }
  return out;
}
