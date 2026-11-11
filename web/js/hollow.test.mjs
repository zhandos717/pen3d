// Полые детали: вырез внутри детали не трогает соседнюю, тела без детали режутся как раньше;
// стенка у эскиза даёт замкнутую сетку с объёмом меньше исходного. Запуск: make check-hollow
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const here = fileURLToPath(new URL('.', import.meta.url)), dir = mkdtempSync(join(tmpdir(), 'hollow-'));
const three = here + '../vendor/three@0.175.0/build/three.module.js';
const fix = src => src.replace("from 'three'", `from '${three}'`)
  .replace("from './textshape.js'", `from '${here}textshape.js'`).replace("from './imageshape.js'", `from '${here}imageshape.js'`)
  .replace("from './geometry.js'", `from '${join(dir, 'geometry.mjs')}'`)
  .replace("from 'three-bvh-csg'", `from '${here}../vendor/three-bvh-csg@0.0.17/src/index.js'`);
writeFileSync(join(dir, 'geometry.mjs'), fix(readFileSync(here + 'geometry.js', 'utf8')));
// csg.js без three-bvh-csg: план вырезов от него не зависит, а вендорный пакет тянет 'three' по имени
writeFileSync(join(dir, 'csg.mjs'), fix(readFileSync(here + 'csg.js', 'utf8'))
  .replace(/^import \{ Brush.*$/m, 'class Brush{}; class Evaluator{}; const ADDITION=0, SUBTRACTION=1, INTERSECTION=2;'));
const { prismGeo, insetPts } = await import(join(dir, 'geometry.mjs'));
const { cutPlan, innerOf } = await import(join(dir, 'csg.mjs'));
const { roundedRect } = await import(here + 'gear.js');

// корпус с полостью и батарейка в нём — разные детали; ещё старое отверстие без детали
const objs = [
  {id: 1, name: 'корпус', grp: 'A', type: 'box', vis: true, x: 0, y: 0, z: 0, w: 60, d: 40, h: 20, shell: 2, openTop: true},
  {id: 2, name: 'окно', grp: 'A', type: 'box', vis: true, hole: true, x: 30, y: 0, z: 5, w: 4, d: 10, h: 5},
  {id: 3, name: 'батарейка', grp: 'B', type: 'cyl', vis: true, x: 0, y: 0, z: 2, w: 18, d: 18, h: 30},
  {id: 4, name: 'старый вырез', type: 'cyl', vis: true, hole: true, x: 0, y: 0, z: -1, w: 3, d: 3, h: 50},
  {id: 5, name: 'подставка', type: 'box', vis: true, x: 100, y: 0, z: 0, w: 10, d: 10, h: 2},
];
const p = cutPlan(objs), A = p.groups.find(g => g.grp === 'A'), B = p.groups.find(g => g.grp === 'B');
assert.deepStrictEqual(A.holes.map(o => o.name), ['окно'], 'отверстие детали — только в своей детали');
assert.strictEqual(A.cavities.length, 1, 'полость корпуса режет корпус');
assert.deepStrictEqual([B.holes.length, B.cavities.length], [0, 0], 'батарейку не режет ни окно, ни полость корпуса');
assert.deepStrictEqual(p.loose.holes.map(o => o.name), ['старый вырез'], 'отверстие без детали — общее, как раньше');
assert.deepStrictEqual(p.loose.solids.map(o => o.name), ['подставка']);

// стенки и открытые стороны
const c = innerOf(objs[0]);
assert.deepStrictEqual([c.w, c.d, c.z, c.h], [56, 36, 2, 19], 'открыт сверху: полость выходит за верх');
const lid = innerOf({...objs[0], openTop: false, openBottom: true});
assert.deepStrictEqual([lid.z, lid.h], [-1, 19], 'крышка открыта снизу: полость выходит за низ');
assert.strictEqual(innerOf({...objs[0], type: 'text', shell: 2}), null, 'у надписи стенки нет');

// эскиз со скруглёнными углами 60×40 R8: внутренний контур замкнут, площадь меньше
const g = roundedRect(60, 40, 8), sk = {type: 'sketch', pts: g.pts, w: g.size, d: g.size, h: 20, z: 0, shell: 2, openTop: true, name: 'к'};
const inner = innerOf(sk);
assert.ok(inner && inner.pts.length === g.pts.length, 'полость эскиза — тот же контур, сдвинутый внутрь');
function closed(geo){
  const q = geo.attributes.position.array, k = i => [q[i], q[i+1], q[i+2]].map(x => x.toFixed(5)).join(','), e = new Map();
  for(let i = 0; i < q.length; i += 9){ const t = [k(i), k(i+3), k(i+6)];
    for(let j = 0; j < 3; j++){ const s = t[j] + '>' + t[(j+1)%3]; e.set(s, (e.get(s) || 0) + 1); } }
  for(const [s, n] of e){ const [a, b] = s.split('>'); if(n !== 1 || e.get(b + '>' + a) !== 1) return false; }
  return true;
}
const vol = geo => { const q = geo.attributes.position.array; let v = 0;
  for(let i = 0; i < q.length; i += 9) v += (q[i]*(q[i+4]*q[i+8] - q[i+5]*q[i+7]) - q[i+1]*(q[i+3]*q[i+8] - q[i+5]*q[i+6]) + q[i+2]*(q[i+3]*q[i+7] - q[i+4]*q[i+6]))/6; return v; };
const outerG = prismGeo(g.pts), innerG = prismGeo(inner.pts);
assert.ok(closed(innerG), 'сетка полости замкнута');
const S = g.size, area = geo => vol(geo) * S * S;
const expect = (60 - 4) * (40 - 4) - (4 - Math.PI) * (8 - 2) ** 2;     // скруглённый прямоугольник со стенкой 2
assert.ok(area(innerG) < area(outerG), 'объём полости меньше исходного');
assert.ok(Math.abs(area(innerG) - expect) / expect < .01, `площадь полости ${area(innerG).toFixed(0)} ≈ ${expect.toFixed(0)}`);
console.log('hollow: ok');
