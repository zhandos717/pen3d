import * as THREE from 'three';
import { Brush, Evaluator, ADDITION, SUBTRACTION } from 'three-bvh-csg';
import { unitGeo } from './geometry.js';

const csg = new Evaluator(); csg.attributes = ['position', 'normal'];
function brushOf(o, objToMesh, mat){
  const b = new Brush(unitGeo(o), mat);
  objToMesh(o, b); b.visible = true; b.updateMatrixWorld();
  return b;
}
// Совпадающие грани — известный вырожденный случай CSG: дубли выкидываем,
// равные габариты разводим на микрон, иначе evaluate уходит в бесконечность.
function dedupe(list){
  const seen = new Set();
  return list.filter(o => {
    const k = [o.type, o.w, o.d, o.h, o.x, o.y, o.z, o.rot, o.sides, o.dia, o.pitch].join('|');
    if(seen.has(k)) return false;
    seen.add(k); return true;
  });
}
export function buildResult(objects, objToMesh, mat){
  const solids = dedupe(objects.filter(o => o.vis && !o.hole));
  const holes = dedupe(objects.filter(o => o.vis && o.hole)).map(o => ({...o,
    w: o.w + .002, d: o.d + .002, h: o.h + .002, z: Math.max(0, o.z - .001)}));
  if(!solids.length) return null;
  let acc = brushOf(solids[0], objToMesh, mat);
  const step = (o, op) => { const b = brushOf(o, objToMesh, mat), prev = acc; acc = csg.evaluate(acc, b, op);
    b.geometry.dispose(); prev.geometry.dispose(); };
  solids.slice(1).forEach(o => step(o, ADDITION));
  holes.forEach(o => step(o, SUBTRACTION));
  // у одиночного тела трансформ живёт в матрице, а не в вершинах — переносим в геометрию
  acc.updateMatrixWorld();
  return new THREE.Mesh(acc.geometry.clone().applyMatrix4(acc.matrixWorld), mat);
}
