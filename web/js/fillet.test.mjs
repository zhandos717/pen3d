// Скругление рёбер: сетка обязана быть замкнутой и вывернутой наружу (иначе CSG и слайсер
// сломаются), а объём — меньше призмы ровно на срезанные четверти. Запуск: make check-fillet
import { readFileSync, writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const here = fileURLToPath(new URL('.', import.meta.url));
const three = here + '../vendor/three@0.175.0/build/three.module.js';
const src = readFileSync(here + 'geometry.js', 'utf8').replace("from 'three'", `from '${three}'`);
const tmp = join(mkdtempSync(join(tmpdir(), 'fillet-')), 'geometry.mjs');
writeFileSync(tmp, src);
const { filletPrismGeo, prismGeo } = await import(tmp);
const { roundedRect } = await import(here + 'gear.js');

// объём со знаком по треугольникам (теорема Гаусса): > 0 — нормали наружу
function volume(g){
  const p = g.attributes.position.array; let v = 0;
  for(let i = 0; i < p.length; i += 9)
    v += (p[i]*(p[i+4]*p[i+8] - p[i+5]*p[i+7]) - p[i+1]*(p[i+3]*p[i+8] - p[i+5]*p[i+6]) + p[i+2]*(p[i+3]*p[i+7] - p[i+4]*p[i+6]))/6;
  return v;
}
// замкнутость: каждое ребро встречается ровно дважды, в противоположных направлениях
function closed(g){
  const p = g.attributes.position.array, key = i => [p[i], p[i+1], p[i+2]].map(x => x.toFixed(5)).join(',');
  const edges = new Map();
  for(let i = 0; i < p.length; i += 9){
    const t = [key(i), key(i+3), key(i+6)];
    for(let k = 0; k < 3; k++){ const e = t[k] + '>' + t[(k+1)%3]; edges.set(e, (edges.get(e) || 0) + 1); }
  }
  for(const [e, c] of edges){ const [a, b] = e.split('>'); if(c !== 1 || edges.get(b + '>' + a) !== 1) return false; }
  return true;
}

// короб 60×40×10 со скруглением углов R8 и рёбер R2 — в мм через масштаб
const W = 60, D = 40, H = 10, R = 8, E = 2;
const g = roundedRect(W, D, R), S = g.size;
const plain = prismGeo(g.pts), fil = filletPrismGeo(g.pts, E/S, E/H);
assert.ok(closed(plain) && closed(fil), 'сетка со скруглением должна быть замкнутой');
const mm = geo => volume(geo) * S * S * H;
const v0 = mm(plain), v1 = mm(fil);
assert.ok(v0 > 0 && v1 > 0, 'нормали наружу');
// срезано: периметр × (1 − π/4)·E² × 2 ребра (верх и низ), периметр — по средней линии
const perim = 2*(W + D - 4*R) + 2*Math.PI*R;
const cut = 2 * (1 - Math.PI/4) * E*E * perim;
assert.ok(Math.abs((v0 - v1) - cut) / cut < 0.15, `срезано ${(v0 - v1).toFixed(0)}, ожидалось ~${cut.toFixed(0)}`);
assert.ok(Math.abs(mm(filletPrismGeo(g.pts, 0, 0)) - v0) < 1e-6 * v0, 'нулевое скругление = обычная призма');
console.log(`fillet: ok (срезано ${(v0 - v1).toFixed(0)} мм³ из ${v0.toFixed(0)})`);
