// Петля обязана держать ребро на месте: поворот вокруг центра плюс компенсирующий
// сдвиг должны давать ровно поворот вокруг ребра. Ошибка в знаке или в порядке
// умножения матриц видна только на модели, поэтому проверяем инвариант числами.
// Запуск: make check-hinge
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

// geometry.js просит голый 'three', в браузере его даёт importmap — тут подставляем вендор
const here = fileURLToPath(new URL('.', import.meta.url));
const three = here + '../vendor/three@0.175.0/build/three.module.js';
const src = readFileSync(here + 'geometry.js', 'utf8').replace("from 'three'", `from '${three}'`);
const tmp = join(mkdtempSync(join(tmpdir(), 'hinge-')), 'geometry.mjs');
writeFileSync(tmp, src);
const { hingeShift, HINGE } = await import(tmp);
const THREE = await import(three);

// как app.js кладёт тело в сцену: x -> X, низ + половина высоты -> Y, y -> Z
const centerOf = o => new THREE.Vector3(o.x, o.z + o.h/2, o.y);
const eulerOf = o => new THREE.Euler(THREE.MathUtils.degToRad(o.rx || 0),
  THREE.MathUtils.degToRad(o.rot || 0), THREE.MathUtils.degToRad(o.rz || 0), 'YXZ');
const hingeWorld = o => centerOf(o)
  .add(new THREE.Vector3(...HINGE[o.hinge](o)).applyEuler(eulerOf(o)));

// повторяет turn() из app.js
function turn(o, k, v){
  const d = hingeShift(o, {rx:o.rx, rot:o.rot, rz:o.rz, [k]: v});
  const n = {...o, [k]: v};
  if(d){ n.x = o.x + d.x; n.y = o.y + d.z; n.z = o.z + d.y; }
  return n;
}

const door = {w:40, d:4, h:80, x:10, y:20, z:0, rot:0, rx:0, rz:0};
let checks = 0;

// ребро петли не должно сдвинуться ни на микрон при любом угле
for(const hinge of Object.keys(HINGE)){
  for(const [k, angles] of [['rot', [15, 90, 180, 270]], ['rx', [30, 90]], ['rz', [45, 90]]]){
    for(const a of angles){
      const o = {...door, hinge};
      const was = hingeWorld(o), now = hingeWorld(turn(o, k, a));
      assert.ok(was.distanceTo(now) < 1e-9,
        `петля ${hinge}: ${k}=${a}° увела ребро на ${was.distanceTo(now).toFixed(4)} мм`);
      checks++;
    }
  }
}

// поворот от уже повёрнутого положения — тоже вокруг ребра, а не вокруг исходного
{
  const o = turn({...door, hinge:'left'}, 'rot', 30);
  const was = hingeWorld(o), now = hingeWorld(turn(o, 'rot', 75));
  assert.ok(was.distanceTo(now) < 1e-9, 'довод от 30° до 75° увёл петлю');
  checks++;
}

// дверца шириной 40 на левой петле, открытая на 90°: центр едет по дуге радиусом 20
{
  const o = turn({...door, hinge:'left'}, 'rot', 90);
  assert.ok(Math.abs(o.x - (door.x - 20)) < 1e-9, `x: ждали ${door.x - 20}, вышло ${o.x}`);
  assert.ok(Math.abs(o.y - (door.y - 20)) < 1e-9, `y: ждали ${door.y - 20}, вышло ${o.y}`);
  assert.ok(Math.abs(o.z - door.z) < 1e-9, 'вертикальная петля не должна менять высоту');
  checks++;
}

// без петли тело крутится вокруг центра, как раньше
{
  const o = {...door};
  assert.strictEqual(hingeShift(o, {...o, rot:90}), null, 'без петли сдвига быть не должно');
  const n = turn(o, 'rot', 90);
  assert.ok(n.x === door.x && n.y === door.y && n.z === door.z, 'без петли позиция не меняется');
  checks++;
}

console.log(`петля: ${checks} проверок прошло`);
