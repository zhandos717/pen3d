// Вырез детали в фоне: решётка из сотни отверстий режется секунды, и на странице это
// замораживало всё. Пути прямые — importmap на воркер не действует; версии те же,
// что в importmap index.html, иначе на странице и тут будут разные копии three.
import * as THREE from '/vendor/three@0.175.0/build/three.module.js';
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from '/vendor/three-bvh-csg@0.0.17/src/index.js';
import { runSteps } from './csg-run.js';
import { featureEdges } from './edges.js';

const L = {Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION, BufferGeometry: THREE.BufferGeometry, BufferAttribute: THREE.BufferAttribute};

self.onmessage = ({data: {id, steps}}) => {
  const t0 = performance.now();
  try{
    const r = runSteps(steps, L);
    const edges = featureEdges(r.pos, r.idx);
    const list = [r.pos.buffer, r.norm.buffer, edges.buffer];
    if(r.idx) list.push(r.idx.buffer);
    self.postMessage({id, ...r, edges, ms: Math.round(performance.now() - t0)}, list);
  }catch(err){ self.postMessage({id, error: err.message}); }
};
