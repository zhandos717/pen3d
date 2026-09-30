// Проверка перед печатью: ловит то, что испортит печать, и молчит на нормальной детали.
// Запуск: make check-preflight
import assert from 'assert';
import { preflight } from './preflight.js';

const b = (name, x0, y0, z0, x1, y1, z1, extra) => ({name, min: {x: x0, y: y0, z: z0}, max: {x: x1, y: y1, z: z1}, ...extra});
const levels = r => r.items.map(i => i.level);
const has = (r, re) => r.items.some(i => re.test(i.text));

let r = preflight({bodies: [b('короб', 0, 0, 0, 20, 10, 20)]});
assert.deepStrictEqual(levels(r), ['ok'], 'нормальный короб — без замечаний');

r = preflight({bodies: [b('короб', 0, 0, 0, 20, 10, 20), b('летун', 50, 5, 0, 60, 10, 10)]});
assert.ok(has(r, /летун — висит в воздухе/));
assert.ok(has(r, /2 отдельные детали/));

r = preflight({bodies: [b('короб', 0, 0, 0, 300, 10, 20)]});
assert.ok(r.items.some(i => i.level === 'err' && /не влезает/.test(i.text)));

r = preflight({bodies: [b('лист', 0, 0, 0, 20, 0.6, 20)]});
assert.ok(r.items.some(i => i.level === 'err' && /тоньше двух линий/.test(i.text)));
r = preflight({bodies: [b('лист', 0, 0, 0, 20, 1, 20)]});
assert.ok(r.items.some(i => i.level === 'warn' && /хрупко/.test(i.text)));

r = preflight({bodies: [b('короб', 0, 0, 0, 20, 10, 20), b('дырка', 5, 0, 5, 8, 12, 8, {hole: true})]});
assert.ok(has(r, /вровень с дном/));
r = preflight({bodies: [b('короб', 0, 0, 0, 20, 10, 20), b('мимо', 40, 0, 40, 45, 5, 45, {hole: true})]});
assert.ok(has(r, /не задевает деталь/));

r = preflight({bodies: [b('шпиль', 0, 0, 0, 8, 60, 8)]});
assert.ok(has(r, /может раскачаться/));

// нависание: треугольник на высоте 10, смотрит вниз под ~60° от вертикали — площадь 50
const bodies = [b('т', 0, 0, 0, 10, 20, 10)];
const tri = (pts) => new Float32Array(pts.flat());
const down = tri([[0, 10, 0], [10, 10, 0], [0, 15, 10]]);       // нормаль вниз-вбок
const floor = tri([[0, 0, 0], [10, 0, 0], [0, 0, 10]]);         // дно на столе — не нависание
r = preflight({bodies, pos: down});
assert.ok(r.items.some(i => i.level === 'warn' && /нависания/.test(i.text)), JSON.stringify(r.items));
assert.deepStrictEqual(r.overhangTris, [0]);
r = preflight({bodies, pos: down, supports: true});
assert.ok(r.items.some(i => i.level === 'ok' && /нависания/.test(i.text)), 'с поддержками — не предупреждение');
r = preflight({bodies, pos: floor});
assert.deepStrictEqual(r.overhangTris, [], 'дно на столе не считается');
const ceiling = tri([[0, 10, 0], [10, 10, 0], [0, 10, 10]]);
r = preflight({bodies, pos: ceiling});
assert.ok(has(r, /мосты/));

console.log('preflight: ok');
