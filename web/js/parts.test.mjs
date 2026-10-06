// Детали и коннекторы: список собирается по деталям, имена не повторяются, коннектор
// удалённого тела пропадает. Запуск: make check-parts
import assert from 'assert';
import { listRows, partName, nextName, liveConnectors } from './parts.js';

const objs = [{id: 1, name: 'стол'}, {id: 2, name: 'дно', grp: 'g1'}, {id: 3, name: 'крышка'}, {id: 4, name: 'стенка', grp: 'g1'}];
const rows = listRows(objs, {g1: {name: 'Корпус'}});
assert.deepStrictEqual(rows.map(r => r.kind === 'part' ? `[${r.name} ${r.count}]` : (r.inPart ? '  ' : '') + r.o.name),
  ['[Корпус 2]', '  стенка', '  дно', 'крышка', 'стол'], 'деталь встаёт по самому новому телу, её тела — под ней');
assert.strictEqual(listRows([{id: 1, grp: 'gx'}], {})[0].name, 'Деталь', 'безымянная группа — «Деталь»');

assert.strictEqual(partName(objs[1], {g1: {name: 'Корпус'}}), 'Корпус');
assert.strictEqual(partName(objs[0], {}), 'стол', 'тело вне детали — своё имя');

assert.strictEqual(nextName('К', []), 'К 1');
assert.strictEqual(nextName('К', ['К 1', 'К 3']), 'К 4', 'номер после максимального, дырки не заполняем');
assert.strictEqual(nextName('Деталь', ['Корпус', 'Деталь 2']), 'Деталь 3');

assert.deepStrictEqual(liveConnectors([{id: 'a', body: 1}, {id: 'b', body: 9}], objs).map(c => c.id), ['a']);
console.log('parts: ok');
