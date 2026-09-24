/**
 * 連想ペア前計算スクリプト。
 *
 *   npx tsx src/server/assoc.ts
 *
 * 出題資格(eligible)の各記事Aについて、プール内リンク集合の演算だけで
 * 全B候補の連想メトリクスを計算し、assoc_pairs に帯分類付きで保存する。
 * 計算量は Aあたり 3ホップ経路数≈数百万。オフラインの一回きりバッチ。
 *
 * 帯定義（実測分布由来の初期窓。較正対象）:
 *   near : direct または duel>=4
 *   ideal: duel<=3 かつ domRel∈{same,adjacent,unknown} かつ
 *          (bendAb>=1 かつ bendBa>=1) または bend合計>=3
 *   hard : duel<=1 かつ bend合計<=1 かつ 3ホップ経路(往復)>=10 かつ domRel∈{same,adjacent}
 *   weak : 上記以外の関連ペア
 *   far  : シグナルがほぼ無い（保存しない）
 */
import { initPoolSchema, loadLinkMaps, getEligibleTitles, clearAssocPairs, insertAssocPairsBulk, getPoolStats } from './pool';
import { getDb } from './db';
import type { AssocPair, PairBand } from './pool';
import { domainRel } from './domains';
import type { DomainRel } from './domains';

const HARD_PATHS3_MIN = 10;
const NEAR_DUEL_MIN = 4;
const IDEAL_DUEL_MAX = 3;

function classify(opts: {
  direct: boolean;
  bendAb: number;
  bendBa: number;
  duel: number;
  paths3: number;
  domRel: DomainRel;
}): PairBand | null {
  const { direct, bendAb, bendBa, duel, paths3, domRel } = opts;
  const bendTotal = bendAb + bendBa;
  if (direct || duel >= NEAR_DUEL_MIN) return 'near';
  if (domRel !== 'diff' && duel <= IDEAL_DUEL_MAX && ((bendAb >= 1 && bendBa >= 1) || bendTotal >= 3))
    return 'ideal';
  if (
    (domRel === 'same' || domRel === 'adjacent') &&
    duel <= 1 &&
    bendTotal <= 1 &&
    paths3 >= HARD_PATHS3_MIN
  )
    return 'hard';
  if (bendTotal + duel + paths3 === 0) return null; // far: 保存しない
  return 'weak';
}

async function main() {
  initPoolSchema();
  const db = getDb();
  const { out, inMap } = loadLinkMaps();
  console.log(`[assoc] loaded ${out.size} src nodes, ${inMap.size} dst nodes`);

  const elig = new Set(getEligibleTitles());
  const poolSet = new Set(out.keys());
  console.log(`[assoc] eligible goals: ${elig.size}, pool: ${poolSet.size}`);

  const domains = new Map<string, Set<string>>();
  const rows = db.prepare('SELECT title, domains FROM pool_articles').all() as Array<{
    title: string;
    domains: string;
  }>;
  for (const r of rows) domains.set(r.title, new Set(JSON.parse(r.domains)));

  clearAssocPairs();
  const t0 = Date.now();
  let aDone = 0;
  let rowsWritten = 0;
  const bandCount: Record<string, number> = {};

  for (const a of elig) {
    const outA = out.get(a) ?? new Set<string>();
    const inA = inMap.get(a) ?? new Set<string>();

    // bendTo[b] = |OUT(a) ∩ IN(b)|  (a→b の2手曲げ道の本数)
    const bendTo = new Map<string, number>();
    for (const h of outA) {
      const outs = out.get(h);
      if (!outs) continue;
      for (const b of outs) {
        if (b !== a) bendTo.set(b, (bendTo.get(b) ?? 0) + 1);
      }
    }
    // bendFrom[b] = |OUT(b) ∩ IN(a)|  (b→a の2手曲げ道の本数)
    const bendFrom = new Map<string, number>();
    for (const h of inA) {
      const ins = inMap.get(h);
      if (!ins) continue;
      for (const b of ins) {
        if (b !== a) bendFrom.set(b, (bendFrom.get(b) ?? 0) + 1);
      }
    }
    // duel[b] = |IN(a) ∩ IN(b)|  (両ゴールにリンクする決闘ページ数)
    const duel = new Map<string, number>();
    for (const q of inA) {
      const outs = out.get(q);
      if (!outs) continue;
      for (const b of outs) {
        if (b !== a && poolSet.has(b)) duel.set(b, (duel.get(b) ?? 0) + 1);
      }
    }
    // paths3fwd[b] = a→x→j→b の3ホップ経路数（プール内）
    const p3f = new Map<string, number>();
    for (const x of outA) {
      const outX = out.get(x);
      if (!outX) continue;
      for (const j of outX) {
        const outJ = out.get(j);
        if (!outJ) continue;
        for (const b of outJ) {
          if (b !== a && elig.has(b)) p3f.set(b, (p3f.get(b) ?? 0) + 1);
        }
      }
    }
    // paths3rev[b] = b→x→j→a の3ホップ経路数（プール内）
    const p3r = new Map<string, number>();
    for (const x of inA) {
      const inX = inMap.get(x);
      if (!inX) continue;
      for (const j of inX) {
        const inJ = inMap.get(j);
        if (!inJ) continue;
        for (const b of inJ) {
          if (b !== a && elig.has(b)) p3r.set(b, (p3r.get(b) ?? 0) + 1);
        }
      }
    }

    const candidates = new Set<string>();
    for (const k of bendTo.keys()) if (elig.has(k)) candidates.add(k);
    for (const k of bendFrom.keys()) if (elig.has(k)) candidates.add(k);
    for (const k of duel.keys()) if (elig.has(k)) candidates.add(k);
    for (const [k, v] of p3f) if (v >= 5) candidates.add(k);
    for (const [k, v] of p3r) if (v >= 5) candidates.add(k);

    const batch: AssocPair[] = [];
    const outBcache = new Map<string, Set<string> | undefined>();
    const getOut = (t: string) => {
      if (!outBcache.has(t)) outBcache.set(t, out.get(t));
      return outBcache.get(t);
    };
    for (const b of candidates) {
      const outB = getOut(b);
      const direct = outA.has(b) || !!outB?.has(a);
      const band = classify({
        direct,
        bendAb: bendTo.get(b) ?? 0,
        bendBa: bendFrom.get(b) ?? 0,
        duel: duel.get(b) ?? 0,
        paths3: (p3f.get(b) ?? 0) + (p3r.get(b) ?? 0),
        domRel: domainRel(domains.get(a) ?? new Set(), domains.get(b) ?? new Set()),
      });
      if (!band) continue;
      bandCount[band] = (bandCount[band] ?? 0) + 1;
      batch.push({
        a,
        b,
        bendAb: bendTo.get(b) ?? 0,
        bendBa: bendFrom.get(b) ?? 0,
        duel: duel.get(b) ?? 0,
        paths3Ab: p3f.get(b) ?? 0,
        paths3Ba: p3r.get(b) ?? 0,
        domRel: domainRel(domains.get(a) ?? new Set(), domains.get(b) ?? new Set()),
        direct,
        band,
      });
    }
    insertAssocPairsBulk(batch);
    rowsWritten += batch.length;
    if (++aDone % 50 === 0) {
      console.log(
        `[assoc] ${aDone}/${elig.size} (${((Date.now() - t0) / 1000).toFixed(0)}s, rows=${rowsWritten})`
      );
    }
  }

  const stats = getPoolStats();
  console.log(`[assoc] done in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${stats.pairs} pairs`);
  console.log('[assoc] bands:', bandCount);
}

main().catch((e) => {
  console.error('[assoc] fatal:', e);
  process.exit(1);
});
