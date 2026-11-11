// Рельеф из картинки: растр без браузера не получить, поэтому кольцо рисуется формулой —
// как его отдал бы canvas из SVG <circle> с обводкой. Кольцо — одна фигура с одной дыркой,
// мелочь меньше 1 мм отбрасывается и считается. Запуск: make check-image
import assert from 'assert';
import { maskToShapes, dropSmall } from './textshape.js';

const N = 128, mask = new Uint8Array(N * N);
for(let y = 0; y < N; y++) for(let x = 0; x < N; x++){
  const r = Math.hypot(x + .5 - 64, y + .5 - 64);
  mask[y*N + x] = (r < 50 && r > 25) || Math.hypot(x - 120, y - 6) < 1.5 ? 1 : 0;   // кольцо и точка-соринка
}
const s = maskToShapes(mask, N, N, .8);
const ring = s.shapes.find(x => x.holes.length);
assert.ok(ring, 'у кольца есть дырка');
assert.strictEqual(s.shapes.reduce((n, x) => n + x.holes.length, 0), 1, 'кольцо — одна дырка');
assert.ok(ring.outer.length < 80, `окружность упрощена: ${ring.outer.length} точек`);

// логотип 20 мм: соринка в 3 пикселя — ~0.4 мм, выкидывается; кольцо остаётся
const k = dropSmall(s.shapes, 20 * s.aspect, 20, 1);
assert.strictEqual(k.dropped, 1, 'соринка < 1 мм отброшена');
assert.strictEqual(k.shapes.length, 1);
assert.strictEqual(k.shapes[0].holes.length, 1, 'дырка кольца крупная — остаётся');
// то же кольцо размером 2 мм: дырка ~0.9 мм заливается, сама фигура остаётся
assert.strictEqual(dropSmall(s.shapes, 2 * s.aspect, 2, 1).shapes[0].holes.length, 0);
console.log('image: ok');
