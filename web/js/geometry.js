import * as THREE from 'three';
import { textShapes, dropSmall } from './textshape.js';
import { imageShapes } from './imageshape.js';

// Винтовая поверхность: радиус зависит от z и угла, торцы закрыты — сетка водонепроницаемая.
export function threadGeo(o){
  const R = o.dia/2, p = o.pitch, H = o.h, depth = Math.min(p*0.55, R*0.8);
  const NA = 64, NZ = Math.min(2000, Math.max(8, Math.round(H/p*16)));
  const pos = [], idx = [];
  const rAt = (z, a) => {
    const u = ((z - a/(Math.PI*2)*p) % p + p) % p / p;   // положение внутри витка
    return R - depth + depth*(1 - Math.abs(2*u - 1))*2 > R ? R : R - depth + depth*(1 - Math.abs(2*u - 1))*2;
  };
  for(let j=0;j<=NZ;j++){
    const z = j/NZ*H;
    for(let i=0;i<=NA;i++){
      const a = i/NA*Math.PI*2, r = rAt(z, a);
      pos.push(r*Math.cos(a), z - H/2, r*Math.sin(a));
    }
  }
  const at = (j,i) => j*(NA+1) + i;
  for(let j=0;j<NZ;j++) for(let i=0;i<NA;i++)
    idx.push(at(j,i), at(j+1,i), at(j+1,i+1), at(j,i), at(j+1,i+1), at(j,i+1));
  // торцы
  for(const [j, y, flip] of [[0, -H/2, true], [NZ, H/2, false]]){
    const c = pos.length/3; pos.push(0, y, 0);
    for(let i=0;i<NA;i++) idx.push(...(flip ? [c, at(j,i+1), at(j,i)] : [c, at(j,i), at(j,i+1)]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g.toNonIndexed();
}

// Призма по контуру: ExtrudeGeometry с bevelEnabled:false в three r175 крышек не делает,
// поэтому собираем сами — крышки из триангуляции, стенки по рёбрам.
export function prismGeo(pts){
  const v = [];
  for(const p of pts){
    const l = v[v.length-1];
    if(!l || Math.hypot(p[0]-l.x, p[1]-l.y) > 1e-4) v.push(new THREE.Vector2(p[0], p[1]));
  }
  while(v.length > 3 && v[0].distanceTo(v[v.length-1]) < 1e-4) v.pop();
  if(v.length < 3) throw new Error('в контуре меньше трёх точек');
  if(THREE.ShapeUtils.isClockWise(v)) v.reverse();
  const faces = THREE.ShapeUtils.triangulateShape(v, []);
  const pos = [];
  const P = (i, up) => pos.push(v[i].x, up ? .5 : -.5, -v[i].y);
  for(const [a,b,c] of faces){ P(a,true); P(b,true); P(c,true); }        // верх
  for(const [a,b,c] of faces){ P(c,false); P(b,false); P(a,false); }     // низ
  for(let i=0;i<v.length;i++){
    const j = (i+1) % v.length;
    P(i,false); P(j,false); P(j,true);
    P(i,false); P(j,true);  P(i,true);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Призма со скруглёнными верхним и нижним рёбрами: четверть окружности из seg ступеней.
// Геометрия единичная, как у всех тел, поэтому радиус задан отдельно по плану (rp, в долях
// размаха контура) и по высоте (rh, в долях высоты) — после масштаба меша это один радиус в мм.
// Контур сжимается внутрь по нормалям вершин: для выпуклых и скруглённых контуров точно,
// у глубоко вогнутых сжатие больше радиуса вогнутости вывернет контур — это ограничение.
// Контур в Vector2 против часовой без повторов и внутренние нормали вершин — биссектрисы
// нормалей соседних рёбер, растянутые так, чтобы сдвиг k сохранял расстояние до рёбер
function contourWithInward(pts){
  const v = [];
  for(const p of pts){
    const l = v[v.length-1];
    if(!l || Math.hypot(p[0]-l.x, p[1]-l.y) > 1e-4) v.push(new THREE.Vector2(p[0], p[1]));
  }
  while(v.length > 3 && v[0].distanceTo(v[v.length-1]) < 1e-4) v.pop();
  if(v.length < 3) throw new Error('в контуре меньше трёх точек');
  if(THREE.ShapeUtils.isClockWise(v)) v.reverse();
  const n = v.length;
  const inward = v.map((p, i) => {
    const a = v[(i + n - 1) % n], b = v[(i + 1) % n];
    const e1 = p.clone().sub(a).normalize(), e2 = b.clone().sub(p).normalize();
    const n1 = new THREE.Vector2(-e1.y, e1.x), n2 = new THREE.Vector2(-e2.y, e2.x);
    const m = n1.clone().add(n2); const len = m.length();
    if(len < 1e-6) return n1;
    m.divideScalar(len);
    return m.multiplyScalar(1 / Math.max(.3, m.dot(n1)));
  });
  return {v, inward};
}

// контур, сдвинутый внутрь на k (в тех же единицах) — внутренняя стенка полого эскиза
export function insetPts(pts, k){
  const {v, inward} = contourWithInward(pts);
  return v.map((p, i) => { const q = p.clone().addScaledVector(inward[i], k); return [+q.x.toFixed(5), +q.y.toFixed(5)]; });
}

// side: 'both' | 'top' | 'bottom' — какое ребро скруглять; у крышки верх, у корпуса низ, и стык
// двух деталей с одним контуром остаётся гладкой стенкой без желобка
export function filletPrismGeo(pts, rp, rh, seg = 6, side = 'both'){
  const {v, inward} = contourWithInward(pts), n = v.length;
  const ring = k => v.map((p, i) => p.clone().addScaledVector(inward[i], k));
  // кольца снизу вверх: нижняя четверть, прямой бок, верхняя четверть
  const rings = [];
  if(side !== 'top') for(let s = seg; s >= 0; s--){ const f = s/seg*Math.PI/2; rings.push({r: ring(rp*(1 - Math.cos(f))), y: -.5 + rh*(1 - Math.sin(f))}); }
  else rings.push({r: ring(0), y: -.5});
  if(side !== 'bottom') for(let s = 0; s <= seg; s++){ const f = s/seg*Math.PI/2; rings.push({r: ring(rp*(1 - Math.cos(f))), y: .5 - rh*(1 - Math.sin(f))}); }
  else rings.push({r: ring(0), y: .5});
  const pos = [], P = (q, y) => pos.push(q.x, y, -q.y);
  const top = rings[rings.length - 1], bot = rings[0];
  const faces = THREE.ShapeUtils.triangulateShape(top.r, []);
  for(const [a,b,c] of faces){ P(top.r[a], top.y); P(top.r[b], top.y); P(top.r[c], top.y); }
  for(const [a,b,c] of faces){ P(bot.r[c], bot.y); P(bot.r[b], bot.y); P(bot.r[a], bot.y); }
  for(let k = 0; k + 1 < rings.length; k++){
    const A = rings[k], B = rings[k + 1];
    if(Math.abs(A.y - B.y) < 1e-9 && A.r[0].equals(B.r[0])) continue;
    for(let i = 0; i < n; i++){
      const j = (i + 1) % n;
      P(A.r[i], A.y); P(A.r[j], A.y); P(B.r[j], B.y);
      P(A.r[i], A.y); P(B.r[j], B.y); P(B.r[i], B.y);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Надпись: фигуры {outer, holes} в единичных координатах (как у эскиза), выдавленные на
// высоту 1. Крышки — триангуляция с дырками, ориентация треугольников выставляется по знаку
// площади: earcut её не гарантирует. Стенки идут по всем контурам; материал у контуров слева,
// поэтому одна формула даёт наружные стенки и у внешнего контура, и у дырок.
export function textGeo(shapes){
  const pos = [], P = (q, y) => pos.push(q[0], y, -q[1]);
  const v2 = l => l.map(p => new THREE.Vector2(p[0], p[1]));
  for(const s of shapes){
    const outer = v2(s.outer), holes = s.holes.map(v2);
    const all = outer.concat(...holes);
    const faces = THREE.ShapeUtils.triangulateShape(outer, holes);
    for(let [a, b, c] of faces){
      const A = all[a], B = all[b], C = all[c];
      if((B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x) < 0) [b, c] = [c, b];
      P([all[a].x, all[a].y], .5); P([all[b].x, all[b].y], .5); P([all[c].x, all[c].y], .5);
      P([all[c].x, all[c].y], -.5); P([all[b].x, all[b].y], -.5); P([all[a].x, all[a].y], -.5);
    }
    for(const l of [s.outer, ...s.holes]){
      for(let i = 0; i < l.length; i++){
        const p = l[i], q = l[(i + 1) % l.length];
        P(p, -.5); P(q, -.5); P(q, .5);
        P(p, -.5); P(q, .5); P(p, .5);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function wedgeGeo(){
  // клин: прямоугольное основание, скат от задней стенки к передней кромке
  const p = [[-.5,-.5,-.5],[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,.5],[-.5,.5,-.5],[.5,.5,-.5]];
  const f = [[0,2,1],[0,3,2],[4,5,1],[4,1,0],[3,4,0],[3,5,4].reverse(),[2,3,5],[2,5,1]];
  const pos = [];
  for(const t of f) for(const i of t) pos.push(...p[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Импортированный STL: точки уже нормализованы к [-0.5,0.5] на импорте (см. stl-import.js),
// дальше он просто BufferGeometry без пересчёта — тяжёлая модель не парсится на каждый sync()
export function stlUnitGeo(pts3){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts3, 3));
  g.computeVertexNormals();
  return g;
}

// Петля: ось вращения идёт по выбранному ребру тела, а не через его центр.
// Точка петли в локальных осях, от центра; габариты берём текущие, чтобы петля
// не уезжала после изменения размеров
export const HINGE = {
  left:  o => [-o.w/2, 0, 0], right: o => [o.w/2, 0, 0],
  back:  o => [0, 0, -o.d/2], front: o => [0, 0, o.d/2],
  bottom:o => [0, -o.h/2, 0], top:   o => [0, o.h/2, 0],
};
const eulerOf = (rx, rot, rz) => new THREE.Euler(THREE.MathUtils.degToRad(rx || 0),
  THREE.MathUtils.degToRad(rot || 0), THREE.MathUtils.degToRad(rz || 0), 'YXZ');
// Поворот вокруг центра + этот сдвиг = поворот вокруг петли: точка петли остаётся
// на месте. next — углы после поворота. Без петли сдвига нет.
export function hingeShift(o, next){
  const off = HINGE[o.hinge]?.(o);
  if(!off) return null;
  const p = new THREE.Vector3(...off);
  return p.clone().applyEuler(eulerOf(o.rx, o.rot, o.rz))
    .sub(p.clone().applyEuler(eulerOf(next.rx, next.rot, next.rz)));
}

export function unitGeo(o){
  if(o.type === 'stl') return stlUnitGeo(o.pts3);
  if(o.type === 'image'){
    const t = o.img && imageShapes(o.img, o.thr ?? 180, o.eps ?? .8);
    if(!t) return new THREE.BoxGeometry(1, 1, 1);           // растр ещё грузится — перестроим по готовности
    const k = dropSmall(t.shapes, o.w, o.d, 1);
    return k.shapes.length ? textGeo(k.shapes) : new THREE.BoxGeometry(1, 1, 1);
  }
  if(o.type === 'text'){
    const t = textShapes(o.text || 'Текст', o.font || 'Arial', o.bold !== false);
    return t ? textGeo(t.shapes) : new THREE.BoxGeometry(1, 1, 1);
  }
  if(o.type === 'thread') return threadGeo(o);
  if(o.type === 'box') return new THREE.BoxGeometry(1,1,1);
  if(o.type === 'sphere') return new THREE.SphereGeometry(.5, 40, 24);
  if(o.type === 'cone') return new THREE.CylinderGeometry(0, .5, 1, 40);
  if(o.type === 'torus') return new THREE.TorusGeometry(.35, .15, 20, 44).rotateX(Math.PI/2);
  if(o.type === 'wedge') return wedgeGeo();
  if(o.type === 'cyl' || o.type === 'poly')
    return new THREE.CylinderGeometry(.5,.5,1, o.type === 'cyl' ? 48 : o.sides, 1, false,
                                      o.type === 'poly' ? Math.PI/o.sides : 0);
  if(o.edge > 0) return filletPrismGeo(o.pts, o.edge / o.w, o.edge / o.h, 6, o.edgeSide || 'both');
  return prismGeo(o.pts);   // sketch: контур нормализован в [-0.5,0.5]
}
