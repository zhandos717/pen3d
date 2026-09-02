import * as THREE from 'three';

// Винтовая поверхность: радиус зависит от z и угла, торцы закрыты — сетка водонепроницаемая.
export function threadGeo(o){
  const R = o.dia/2, p = o.pitch, H = o.h, depth = p*0.55;
  const NA = 64, NZ = Math.max(8, Math.round(H/p*16));
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

export function unitGeo(o){
  if(o.type === 'thread') return threadGeo(o);
  if(o.type === 'box') return new THREE.BoxGeometry(1,1,1);
  if(o.type === 'sphere') return new THREE.SphereGeometry(.5, 40, 24);
  if(o.type === 'cone') return new THREE.CylinderGeometry(0, .5, 1, 40);
  if(o.type === 'torus') return new THREE.TorusGeometry(.35, .15, 20, 44).rotateX(Math.PI/2);
  if(o.type === 'wedge') return wedgeGeo();
  if(o.type === 'cyl' || o.type === 'poly')
    return new THREE.CylinderGeometry(.5,.5,1, o.type === 'cyl' ? 48 : o.sides, 1, false,
                                      o.type === 'poly' ? Math.PI/o.sides : 0);
  return prismGeo(o.pts);   // sketch: контур нормализован в [-0.5,0.5]
}
