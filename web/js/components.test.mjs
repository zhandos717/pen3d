// Библиотека компонентов: у каждого есть габариты, модуль не выходит за зону «не занимать»,
// вставка даёт одну деталь, поворот не ломает раскладку. Запуск: make check-components
import assert from 'assert';
import { COMPONENTS, instantiate } from './components.js';

// габарит тела в плане и по высоте; лежащий цилиндр — вдоль X
function aabb(o){
  if(o.type === 'sketch'){                  // у эскиза w = d = размах, сам контур уже
    const xs = o.pts.map(p => p[0] * o.w), ys = o.pts.map(p => p[1] * o.d);
    return [o.x + Math.min(...xs), o.x + Math.max(...xs), o.y + Math.min(...ys), o.y + Math.max(...ys), o.z, o.z + o.h];
  }
  if(o.rz === 90) return [o.x - o.h/2, o.x + o.h/2, o.y - o.d/2, o.y + o.d/2, o.z + o.h/2 - o.w/2, o.z + o.h/2 + o.w/2];
  const t = (o.rot || 0) * Math.PI / 180, c = Math.abs(Math.cos(t)), sn = Math.abs(Math.sin(t));
  const hw = o.type === 'box' ? (o.w * c + o.d * sn) / 2 : o.w / 2, hd = o.type === 'box' ? (o.w * sn + o.d * c) / 2 : o.d / 2;
  return [o.x - hw, o.x + hw, o.y - hd, o.y + hd, o.z, o.z + o.h];
}
const inside = (a, b, tol = .05) => a[0] >= b[0] - tol && a[1] <= b[1] + tol && a[2] >= b[2] - tol && a[3] <= b[3] + tol && a[4] >= b[4] - tol && a[5] <= b[5] + tol;

const ids = new Set();
for(const c of COMPONENTS){
  assert.ok(c.id && !ids.has(c.id), `id компонента уникален: ${c.id}`); ids.add(c.id);
  assert.ok(c.name && c.label && c.bodies.length && c.keepout.length, `${c.id}: имя, подпись, тела и зона есть`);
  assert.ok(c.bodies.length <= 40, `${c.id}: тел ${c.bodies.length} — больше 40 тормозит сцену`);
  for(const o of [...c.bodies, ...c.keepout, ...c.cutouts])
    assert.ok(o.w > 0 && o.d > 0 && o.h > 0 && [o.x, o.y, o.z].every(Number.isFinite), `${c.id}/${o.name}: габариты`);
  for(const o of c.bodies)
    assert.ok(c.keepout.some(k => inside(aabb(o), aabb(k))), `${c.id}/${o.name} выходит за зону «не занимать»`);

  for(const turn of [0, 90]){
    const r = instantiate(c, {x: 10, y: -5, turn}, 100);
    const grps = new Set(r.objects.map(o => o.grp));
    assert.strictEqual(grps.size, 1, `${c.id}: вставка — одна деталь`);
    assert.strictEqual(r.nextId, 100 + r.objects.length);
    assert.ok(r.objects.filter(o => !o.hole).every(o => o.ref), 'модуль и зона не печатаются');
    assert.ok(r.objects.filter(o => o.hole).every(o => o.cutsAll), 'вырезы режут корпус, а не только свою деталь');
    assert.ok(r.objects.some(o => o.keepout), 'зона «не занимать» на месте');
  }
}
// поворот на 90°: разъём ESP32-S3 с −X переезжает на −Y
const s3 = COMPONENTS.find(c => c.id === 'esp32-s3-devkitc');
const w0 = instantiate(s3, {}, 1).objects.find(o => o.name === 'окно USB-C 1');
const w90 = instantiate(s3, {turn: 90}, 1).objects.find(o => o.name === 'окно USB-C 1');
assert.ok(w0.x < -30 && Math.abs(w90.y - w0.x) < 1e-6 && w90.rot === 270, 'поворот переносит и место, и угол');
console.log(`components: ok (${COMPONENTS.length} шт.)`);
