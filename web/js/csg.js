import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';
import { unitGeo, unitGeoChunks, insetPts } from './geometry.js';
import { runSteps } from './csg-run.js';

const csg = new Evaluator(); csg.attributes = ['position', 'normal'];
function brushOf(o, objToMesh, mat, geo = unitGeo(o)){
  const b = new Brush(geo, mat);
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

// Полое тело: внутренняя копия, уменьшенная на толщину стенки, вычитается из своей же формы.
// У эскиза внутренний контур — исходный, сдвинутый внутрь; масштаб тела тот же, сдвиг в долях
// размаха (w = d = размах у эскиза). Открытая сторона — полость проходит её насквозь.
export function innerOf(o){
  const s = +o.shell || 0;
  if(!s || !['box', 'cyl', 'poly', 'sketch'].includes(o.type)) return null;
  const z0 = o.openBottom ? o.z - 1 : o.z + s, z1 = o.openTop ? o.z + o.h + 1 : o.z + o.h - s;
  if(z1 - z0 < .4) return null;
  const base = {...o, hole: true, shell: 0, edge: 0, name: o.name + ' (полость)', z: z0, h: z1 - z0};
  if(o.type === 'sketch'){
    if(!o.pts || o.w < 2*s + .4) return null;
    try{ return {...base, pts: insetPts(o.pts, s / o.w)}; }catch(e){ return null; }
  }
  const w = o.w - 2*s, d = o.d - 2*s;
  if(w < .4 || d < .4) return null;                         // стенка съела деталь
  return {...base, w, d};
}

// Что чем режется. Отверстие и полость тела из детали (grp) режут только свою деталь:
// полость корпуса не должна вырезать батарейки, лежащие в нём. Отверстия без детали режут
// всё, как раньше, — старые проекты собираются так же.
// Справочные тела (модули из библиотеки компонентов, зоны «не занимать») не печатаются.
// Вырез компонента (cutsAll) режет корпус, а не свою деталь — он общий, как отверстие без детали.
export function cutPlan(objects){
  const vis = objects.filter(o => o.vis && !o.ref);
  const groups = new Map(), loose = {solids: [], keeps: [], holes: []};
  for(const o of vis){
    const g = o.grp && !o.cutsAll ? (groups.get(o.grp) || groups.set(o.grp, {grp: o.grp, solids: [], keeps: [], holes: []}).get(o.grp)) : loose;
    (o.hole ? g.holes : o.mode === 'keep' ? g.keeps : g.solids).push(o);
  }
  const fin = g => ({...g, cavities: g.solids.map(innerOf).filter(Boolean)});
  return {groups: [...groups.values()].map(fin), loose: fin(loose)};
}

// Тело бывает трёх видов: обычное (складывается), отверстие (вычитается)
// и «оставить общее» (keep) — от детали остаётся только то, что попало внутрь него.
// Порядок обязателен: сложить, обрезать по keep, потом резать полости и отверстия,
// иначе keep срежет уже прорезанные отверстия и они «зарастут».
const grow = o => ({...o, w: o.w + .002, d: o.d + .002, h: o.h + .002, z: o.z - .001});
const L = {Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION, BufferGeometry: THREE.BufferGeometry, BufferAttribute: THREE.BufferAttribute};

// тело → шаг цепочки: сетка сразу в мировых координатах, чтобы её можно было отдать воркеру
function stepOf(o, op, objToMesh, geo = unitGeo(o)){
  const m = new THREE.Mesh(geo);
  objToMesh(o, m);
  m.scale.multiplyScalar(1 + 1e-5);     // см. brushOf: копланарные грани
  m.updateMatrixWorld();
  geo.applyMatrix4(m.matrixWorld);
  if(!geo.attributes.normal) geo.computeVertexNormals();
  return {op, pos: geo.attributes.position.array, norm: geo.attributes.normal.array, idx: geo.index ? geo.index.array : null};
}

// картинку-отверстие режем пачками фигур: см. unitGeoChunks
// Полость режет только своё тело: стойки, бобышки и выступы внутри корпуса из той же
// детали — обычное дело, а общая полость их съедала. Поэтому полое тело считается
// отдельной цепочкой и складывается с остальными уже готовым.
function pieceOf(o, objToMesh){
  const c = innerOf(o), s = stepOf(o, 'add', objToMesh);
  return c ? {op: 'add', sub: [s, stepOf(c, 'cut', objToMesh)]} : s;
}
export function partSteps(g, objToMesh){
  const solids = dedupe(g.solids);
  if(!solids.length) return null;
  const steps = solids.map(o => pieceOf(o, objToMesh));
  dedupe(g.keeps).forEach(o => steps.push(stepOf(o, 'keep', objToMesh)));
  dedupe(g.holes).map(grow).forEach(o => unitGeoChunks(o).forEach(geo => steps.push(stepOf(o, 'cut', objToMesh, geo))));
  return steps;
}
export const runPart = steps => runSteps(steps, L);

export function meshOfResult(r, mat){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(r.norm, 3));
  if(r.idx) g.setIndex(new THREE.BufferAttribute(r.idx, 1));
  return new THREE.Mesh(g, mat);
}

// одна деталь — со своими полостями и отверстиями; для показа «вырезанной» в обычном виде
export function buildPart(g, objToMesh, mat){
  const steps = partSteps(g, objToMesh);
  return steps && meshOfResult(runPart(steps), mat);
}

// Тела без детали — как раньше: всё объединяется, потом обрезается по keep, режется их
// полостями и отверстиями. Детали приходят уже вырезанными своими полостями и отверстиями.
export function buildResult(objects, objToMesh, mat){
  const plan = cutPlan(objects), L0 = plan.loose, steps = [];
  for(const g of plan.groups){
    const s = partSteps(g, objToMesh);
    if(s) steps.push({...runPart(s), op: 'add'});
  }
  const loose = partSteps({solids: L0.solids, keeps: [], holes: [], cavities: []}, objToMesh);
  if(loose) steps.push({...runPart(loose), op: 'add'});
  if(!steps.length) return null;
  dedupe(L0.keeps).forEach(o => steps.push(stepOf(o, 'keep', objToMesh)));
  dedupe(L0.holes).map(grow).forEach(o => unitGeoChunks(o).forEach(geo => steps.push(stepOf(o, 'cut', objToMesh, geo))));
  return meshOfResult(steps.length === 1 ? steps[0] : runPart(steps), mat);
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
