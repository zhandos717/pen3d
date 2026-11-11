// Раскладка на стол: корпус, панель и кнопки Ayu влезают на A1 и не пересекаются;
// то, что больше стола, — null. Запуск: make check-layout
import assert from 'assert';
import { packShelves } from './layout.js';

const items = [{w: 108, d: 108}, {w: 108, d: 108}, {w: 36, d: 36}, {w: 34, d: 34}];
const pos = packShelves(items, 256);
assert.ok(pos, 'корпус, панель и две кнопки помещаются на 256 × 256');
const box = (it, p) => [p.x - it.w/2, p.x + it.w/2, p.y - it.d/2, p.y + it.d/2];
const boxes = items.map((it, i) => box(it, pos[i]));
for(const b of boxes) assert.ok(b[0] >= -128 + 5 - 1e-9 && b[1] <= 128 - 5 + 1e-9 && b[2] >= -128 + 5 - 1e-9 && b[3] <= 128 - 5 + 1e-9, 'не выходит за поле');
for(let i = 0; i < boxes.length; i++) for(let j = i + 1; j < boxes.length; j++){
  const a = boxes[i], b = boxes[j];
  assert.ok(a[1] + 6 - 1e-9 <= b[0] || b[1] + 6 - 1e-9 <= a[0] || a[3] + 6 - 1e-9 <= b[2] || b[3] + 6 - 1e-9 <= a[2], `детали ${i} и ${j} не ближе зазора`);
}
assert.strictEqual(packShelves([{w: 250, d: 30}], 256), null, 'шире поля — null');
assert.strictEqual(packShelves([{w: 120, d: 120}, {w: 120, d: 120}, {w: 120, d: 120}, {w: 120, d: 120}, {w: 120, d: 120}], 256), null, 'пять квадратов 120 не влезают');
console.log('layout: ok');
