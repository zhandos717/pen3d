import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { unitGeo } from './geometry.js';

const csg = new Evaluator(); csg.attributes = ['position', 'normal'];
function brushOf(o, objToMesh, mat){
  const b = new Brush(unitGeo(o), mat);
  objToMesh(o, b);
  // у двух тел с совпадающей гранью (напр. цилиндры одного диаметра встык) грань
  // выходит идеально копланарной, и evaluate зависает в бесконечном цикле. Сдвиг
  // тела в сторону иногда вместо стыка даёт микрощель — на срезе появляются рваные
  // грани; одинаковое раздутие для обеих тоже не спасает — при равных габаритах
  // радиусы остаются равны друг другу. Раздутие разное по величине (зависит от id),
  // но всегда только наружу — гарантирует нахлёст без щели и различие между
  // одинаковыми по размеру телами
  b.scale.multiplyScalar(1 + 1e-5);
  b.visible = true; b.updateMatrixWorld();
  return b;
}
// Совпадающие грани — известный вырожденный случай CSG: дубли выкидываем,
// равные габариты разводим на микрон, иначе evaluate уходит в бесконечность.
function dedupe(list){
  const seen = new Set();
  return list.filter(o => {
    // округляем: тела, различающиеся на тысячные, для CSG одинаковы,
    // но дают совпадающие грани и вырожденный случай
    const r = v => Math.round((+v || 0) * 100) / 100;
    const k = [o.type, r(o.w), r(o.d), r(o.h), r(o.x), r(o.y), r(o.z), r(o.rot),
               o.sides, r(o.dia), r(o.pitch), o.mode || ''].join('|');
    if(seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// Полое тело: внутренняя копия, уменьшенная на толщину стенки, вычитается из своей же формы
export function innerOf(o){
  const s = +o.shell || 0;
  if(!s || !['box','cyl','poly'].includes(o.type)) return null;
  const w = o.w - 2*s, d = o.d - 2*s;
  if(w < .4 || d < .4 || o.h - s < .4) return null;        // стенка съела деталь
  return {...o, hole: true, shell: 0, name: o.name + ' (полость)',
    w, d,
    h: o.openTop ? o.h - s + 1 : o.h - 2*s,                 // открыта сверху — режем насквозь
    z: o.z + s};
}

// Тело бывает трёх видов: обычное (складывается), отверстие (вычитается)
// и «оставить общее» (keep) — от детали остаётся только то, что попало внутрь него.
// Порядок обязателен: сложить, обрезать по keep, потом резать полости и отверстия,
// иначе keep срежет уже прорезанные отверстия и они «зарастут».
export function buildResult(objects, objToMesh, mat){
  const solids = dedupe(objects.filter(o => o.vis && !o.hole && o.mode !== 'keep'));
  const keeps = dedupe(objects.filter(o => o.vis && !o.hole && o.mode === 'keep'));
  const cavities = solids.map(innerOf).filter(Boolean);
  const holes = dedupe(objects.filter(o => o.vis && o.hole)).map(o => ({...o,
    w: o.w + .002, d: o.d + .002, h: o.h + .002, z: o.z - .001}));
  if(!solids.length) return null;
  let acc = brushOf(solids[0], objToMesh, mat);
  const step = (o, op) => { const b = brushOf(o, objToMesh, mat), prev = acc; acc = csg.evaluate(acc, b, op);
    b.geometry.dispose(); prev.geometry.dispose(); };
  solids.slice(1).forEach(o => step(o, ADDITION));
  keeps.forEach(o => step(o, INTERSECTION));              // оставляем только общую часть
  cavities.forEach(o => step(o, SUBTRACTION));            // полости режем до отверстий
  holes.forEach(o => step(o, SUBTRACTION));
  // у одиночного тела трансформ живёт в матрице, а не в вершинах — переносим в геометрию
  acc.updateMatrixWorld();
  return new THREE.Mesh(acc.geometry.clone().applyMatrix4(acc.matrixWorld), mat);
}

// Насколько отверстие погружено в тело: пересечение показываем как «призрак»
export function holeGhost(hole, solids, objToMesh, mat){
  solids = dedupe(solids);
  if(!solids.length) return null;
  let body = brushOf(solids[0], objToMesh, mat);
  for(const s of solids.slice(1)) body = csg.evaluate(body, brushOf(s, objToMesh, mat), ADDITION);
  const cut = brushOf(hole, objToMesh, mat);
  const inside = csg.evaluate(body, cut, INTERSECTION);
  const g = inside.geometry.clone();
  g.computeBoundingBox();
  const b = g.boundingBox;
  if(!b || b.isEmpty()) return null;
  return {geometry: g, box: b.clone()};
}
