// Надпись: обводка маски даёт замкнутые контуры с правильными дырками, сетка из них —
// замкнутая и с объёмом, равным площади букв. Без canvas: маски рисуются руками.
// Запуск: make check-text
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';
import { traceMask, groupLoops, maskToShapes, area } from './textshape.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const three = here + '../vendor/three@0.175.0/build/three.module.js';
const src = readFileSync(here + 'geometry.js', 'utf8').replace("from 'three'", `from '${three}'`)
  .replace("from './textshape.js'", `from '${here}textshape.js'`)
  .replace("from './imageshape.js'", `from '${here}imageshape.js'`);
const tmp = join(mkdtempSync(join(tmpdir(), 'text-')), 'geometry.mjs');
writeFileSync(tmp, src);
const { textGeo } = await import(tmp);

const mask = rows => ({w: rows[0].length, h: rows.length, m: Uint8Array.from(rows.join('').split('').map(c => c === '#' ? 1 : 0))});
function closed(g){
  const p = g.attributes.position.array, k = i => [p[i], p[i+1], p[i+2]].map(x => x.toFixed(5)).join(',');
  const e = new Map();
  for(let i = 0; i < p.length; i += 9){ const t = [k(i), k(i+3), k(i+6)];
    for(let j = 0; j < 3; j++){ const s = t[j] + '>' + t[(j+1)%3]; e.set(s, (e.get(s) || 0) + 1); } }
  for(const [s, c] of e){ const [a, b] = s.split('>'); if(c !== 1 || e.get(b + '>' + a) !== 1) return false; }
  return true;
}
function volume(g){
  const p = g.attributes.position.array; let v = 0;
  for(let i = 0; i < p.length; i += 9)
    v += (p[i]*(p[i+4]*p[i+8] - p[i+5]*p[i+7]) - p[i+1]*(p[i+3]*p[i+8] - p[i+5]*p[i+6]) + p[i+2]*(p[i+3]*p[i+7] - p[i+4]*p[i+6]))/6;
  return v;
}

// «О»: квадратное кольцо — один внешний контур и одна дырка
const O = mask(['######', '#....#', '#....#', '#....#', '######']);
const loops = traceMask(O.m, O.w, O.h);
assert.strictEqual(loops.length, 2);
assert.strictEqual(loops.filter(l => area(l) > 0).length, 1, 'внешний — против часовой');
const g1 = groupLoops(loops);
assert.strictEqual(g1.length, 1); assert.strictEqual(g1[0].holes.length, 1, 'у «О» одна дырка');

const s = maskToShapes(O.m, O.w, O.h);
assert.ok(Math.abs(s.aspect - 6/5) < 1e-9, 'пропорция надписи — по габариту букв');
const geo = textGeo(s.shapes);
assert.ok(closed(geo), 'сетка надписи замкнута');
const filledShare = 18 / 30;                    // 18 заполненных пикселей из 6×5
assert.ok(Math.abs(volume(geo) - filledShare) < 1e-4, `объём ${volume(geo)} — площадь букв в единичной коробке`);

// два пикселя касаются углом — два отдельных контура, а не «восьмёрка»
const D = mask(['#.', '.#']);
assert.strictEqual(groupLoops(traceMask(D.m, D.w, D.h)).length, 2);

// «Ә»-подобное: буква и отдельная точка над ней, у буквы дырка
const E = mask(['..##..', '......', '######', '#....#', '#....#', '######']);
const se = maskToShapes(E.m, E.w, E.h);
assert.strictEqual(se.shapes.length, 2, 'точка над буквой — своя фигура');
assert.strictEqual(se.shapes.reduce((n, x) => n + x.holes.length, 0), 1);
const ge = textGeo(se.shapes);
assert.ok(closed(ge) && volume(ge) > 0);

// ступенька на диагонали упрощается, а сетка остаётся замкнутой
const big = [];
for(let y = 0; y < 40; y++) big.push(Array.from({length: 40}, (_, x) => x + y < 50 && x > 2 && y > 2 ? '#' : '.').join(''));
const B = mask(big), sb = maskToShapes(B.m, B.w, B.h);
assert.ok(sb.shapes[0].outer.length < 20, `упрощение: ${sb.shapes[0].outer.length} точек`);
assert.ok(closed(textGeo(sb.shapes)) && volume(textGeo(sb.shapes)) > 0);
console.log('text: ok');
