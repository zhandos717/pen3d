// Разбор: слои стопкой с зазором, одна высота — один слой, явный порядок и направление
// переопределяют авто. Запуск: make check-explode
import assert from 'assert';
import { explodePlan } from './explode.js';

const u = (key, min, max, extra) => ({key, min, max, ...extra});
let p = explodePlan([u('корпус', 0, 27), u('панель', 27, 35), u('кнопка', 30, 39)], 8);
assert.strictEqual(p['корпус'].off, 0, 'нижний слой стоит');
assert.strictEqual(p['панель'].off, 8, 'панель — над корпусом с зазором 8');
assert.strictEqual(p['кнопка'].off, 35 + 8 + 8 - 30, 'кнопка вдавлена в панель — встаёт над её новым верхом');

p = explodePlan([u('а', 0, 10), u('решётка 1', 10, 11), u('решётка 2', 10.2, 11.2)], 5);
assert.strictEqual(p['решётка 1'].layer, p['решётка 2'].layer, 'одна высота центра — один слой');

p = explodePlan([u('низ', 0, 10, {order: 2}), u('верх', 20, 30, {order: 1})], 5);
assert.ok(p['низ'].off > 0 && p['верх'].off === 0, 'явный порядок важнее высоты');

p = explodePlan([u('а', 0, 10), u('б', 10, 20, {dir: 'down'}), u('в', 20, 30, {dir: 'side', dist: 40})], 5);
assert.ok(p['б'].off < 0, 'вниз — отрицательное смещение');
assert.deepStrictEqual([p['в'].dir, p['в'].off], ['side', 40], 'своё расстояние и направление');
assert.deepStrictEqual(explodePlan([]), {});
console.log('explode: ok');
