// Параметры: формула в поле тела обязана пересчитываться при смене параметра,
// а мусор в выражении — не исполняться. Запуск: make check-params
import assert from 'assert';
import { evalExpr, paramValues, applyParams, refsParam, usersOf, JS_RESERVED } from './params.js';

assert.strictEqual(evalExpr('2+3*4', {}), 14);
assert.strictEqual(evalExpr('w/2', {w: 10}), 5);
assert.strictEqual(evalExpr('max(wall, 1.2)*2', {wall: .8}), 2.4);
assert.ok(Number.isNaN(evalExpr('alert(1)', {})), 'неизвестное имя не должно вызываться');
assert.ok(Number.isNaN(evalExpr('"a"+1', {})), 'строки запрещены');
assert.ok(Number.isNaN(evalExpr('x[0]', {x: [1]})), 'скобки доступа запрещены');
assert.ok(Number.isNaN(evalExpr('2+', {})));
assert.ok(Number.isNaN(evalExpr('sqrt.constructor', {})), 'доступ к свойствам запрещён');
assert.ok(Number.isNaN(evalExpr('constructor', {})), 'имена из прототипа не пропускаем');
assert.ok(Number.isNaN(evalExpr('name', {name: 'короб'})), 'строковые поля тела в формулу не попадают');
assert.strictEqual(evalExpr('.5 + 1.25', {}), 1.75);

const params = [{name: 'wall', expr: '2'}, {name: 'box_w', expr: '40 + 2*wall'}, {name: 'bad', expr: 'nope*2'}];
const {vals, errors} = paramValues(params);
assert.deepStrictEqual(vals, {wall: 2, box_w: 44});
assert.ok(errors.bad);
assert.ok(paramValues([{name: 'a', expr: 'b'}, {name: 'b', expr: '1'}]).errors.a,
          'параметр видит только тех, кто выше — ссылка вперёд считается ошибкой');

assert.ok(refsParam('box_w - wall', params));
assert.ok(!refsParam('w/2', params));

const objs = [{name: 'корпус', w: 0, h: 20, f: {w: 'box_w', x: 'box_w/2 + 20'}}, {name: 'крышка', w: 5}];
assert.deepStrictEqual(applyParams(objs, params), []);
assert.strictEqual(objs[0].w, 44);
assert.strictEqual(objs[0].x, 42);
assert.strictEqual(objs[1].w, 5, 'тело без формул не трогаем');

params[0].expr = '3';
applyParams(objs, params);
assert.strictEqual(objs[0].w, 46, 'смена параметра перестраивает зависимое тело');

const clamped = [{name: 'c', f: {w: 'wall - 10'}}];
applyParams(clamped, params, (o, k, v) => { o[k] = Math.max(.2, v); });
assert.strictEqual(clamped[0].w, .2, 'клампы поля применяются и к формуле');

assert.deepStrictEqual(applyParams([{name: 'z', f: {w: 'ghost'}}], params), ['z.w']);
assert.deepStrictEqual(usersOf(objs, 'wall'), []);
assert.deepStrictEqual(usersOf(objs, 'box_w').map(o => o.name), ['корпус']);

const self = [{name: 's', w: 10, f: {w: 'w + wall'}}];
assert.deepStrictEqual(applyParams(self, params), ['s.w'], 'поле тела в формуле не читается — иначе копилось бы');
assert.strictEqual(self[0].w, 10);
const order = [];
applyParams([{name: 'o', f: {shell: 'wall', w: 'box_w'}}], params, (o, k) => order.push(k));
assert.deepStrictEqual(order, ['w', 'shell'], 'стенку считаем после размеров');
assert.ok(JS_RESERVED.has('eval') && JS_RESERVED.has('if'));

console.log('params: ok');
