// Посадки: зазор только у отверстий с выбранной посадкой, калибровка сдвигает все
// посадки разом, а тестовая пластинка не должна получать зазор повторно. Запуск: make check-params
import assert from 'assert';
import { gapFor, couponObjects, COUPON_GAPS } from './fit.js';

assert.strictEqual(gapFor({hole: true, fit: 'snug'}), 0.2);
assert.strictEqual(gapFor({hole: true, fit: 'loose'}, 0.3), 0.6);
assert.strictEqual(gapFor({hole: true, fit: 'press'}, 0.05), 0, 'натяг не уходит в минус');
assert.strictEqual(gapFor({hole: false, fit: 'snug'}), 0, 'тело не раздувается');
assert.strictEqual(gapFor({hole: true, fit: ''}), 0);

const c = couponObjects({x: 0, y: 0});
const holes = c.filter(o => o.hole && o.type === 'cyl');
assert.deepStrictEqual(holes.map(o => +(o.w - 8).toFixed(2)), COUPON_GAPS);
assert.ok(c.every(o => !o.fit), 'в пластинке зазор уже в размере — посадка его удвоила бы');
const plate = c[0];
assert.ok(holes.every(o => Math.abs(o.x - plate.x) + o.w/2 < plate.w/2), 'отверстия внутри пластины');
console.log('fit: ok');
