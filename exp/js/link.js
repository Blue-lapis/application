// 厳選チェッカーへのリンク（DOM非依存。tests/check-exp.mjs で確かめる）。
// チェッカーは ?mon= のキーが3タイプの MONS のどれかにあれば、そのポケモンで開く（checker/js/types.js の typeOf）。
// typeOf は計算エンジンまで読み込むので使わず、同じ条件を3つの mons.js で調べる。
import { MONS as BERRY } from '../../checker/js/berry/mons.js';
import { MONS as ING } from '../../checker/js/ingredient/mons.js';
import { MONS as SKILL } from '../../checker/js/skill/mons.js';

// 開けるときは href、開けないときは href を null にして理由を sub に入れる。性格・レベルは渡さない（育成の性格は3択で、チェッカーの25種類に戻せない）。
export function checkerLink(mon) {
  if (!mon) return { href: null, sub: 'ポケモンを選ぶと開けます' };
  if (![BERRY, ING, SKILL].some((m) => Object.hasOwn(m, mon))) return { href: null, sub: 'このポケモンは厳選チェッカーに未対応です' };
  return { href: `../checker/?${new URLSearchParams({ mon })}`, sub: null };
}
