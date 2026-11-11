// Превью: уровни светов, приоритет кнопки над сценарием, роли и сценарии переживают
// сохранение в файл и чистку мусора. Запуск: make check-preview
import assert from 'assert';
import { lightLevel, resolveLights, normRole, normScenarios } from './preview.js';

for(const m of ['steady', 'pulse', 'blink', 'breathe', 'off'])
  for(let t = 0; t < 4; t += .07){ const v = lightLevel(m, t); assert.ok(v >= 0 && v <= 1, `${m}(${t}) = ${v}`); }
assert.strictEqual(lightLevel('off', 1), 0);
assert.strictEqual(lightLevel('blink', .2), 1); assert.strictEqual(lightLevel('blink', .7), 0);
assert.ok(Math.abs(lightLevel('breathe', 0) - lightLevel('breathe', 3.2)) < 1e-9, 'дыхание периодично');

const lights = {'g:ring': {mode: 'off', color: '#46d9ff'}, 'b:7': {mode: 'steady', color: '#ffc414'}};
const buttons = {'g:talk': {links: ['g:ring'], linkMode: 'pulse'}};
const msg = {name: 'Новое сообщение', lights: {'b:7': {mode: 'blink'}}};
let r = resolveLights(lights, msg, buttons, new Set());
assert.deepStrictEqual([r['g:ring'].mode, r['b:7'].mode], ['off', 'blink'], 'сценарий меняет режим');
r = resolveLights(lights, msg, buttons, new Set(['g:talk']));
assert.strictEqual(r['g:ring'].mode, 'pulse', 'держишь «Говорить» — кольцо пульсирует');
assert.strictEqual(resolveLights(lights, {lights: {'g:нет': {mode: 'steady'}}}, {}, null)['g:нет'], undefined, 'сценарий не создаёт светов');

// роли: всё нужное переживает JSON, мусор отбрасывается
const btn = normRole(JSON.parse(JSON.stringify({role: 'button', travel: '2', links: ['g:ring', 5], linkMode: 'zzz'})));
assert.deepStrictEqual(btn, {role: 'button', travel: 2, links: ['g:ring'], linkMode: 'pulse'});
const light = normRole({role: 'light', lColor: '#FF0000', lMode: 'breathe', lPower: 99, halo: false});
assert.deepStrictEqual(light, {role: 'light', lColor: '#FF0000', lMode: 'breathe', lPower: 4, halo: false});
assert.deepStrictEqual(normRole({role: 'ракета'}), {}, 'неизвестная роль — без роли');

const sc = normScenarios(JSON.parse(JSON.stringify([msg, {name: '  ', lights: {}}, {name: 'Зарядка', lights: {'b:7': {mode: 'xx'}, 'g:ring': {mode: 'breathe', color: '#00ff00'}}}])));
assert.deepStrictEqual(sc, [msg, {name: 'Зарядка', lights: {'g:ring': {mode: 'breathe', color: '#00ff00'}}}]);
console.log('preview: ok');
