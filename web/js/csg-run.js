// Цепочка булевых операций над сетками, уже поставленными в мировые координаты.
// three и three-bvh-csg передаются снаружи: модуль работает и на странице, и в воркере,
// где importmap нет и пути к библиотекам другие.
export function runSteps(steps, L){
  const ev = new L.Evaluator(); ev.attributes = ['position', 'normal'];
  const OPS = {add: L.ADDITION, cut: L.SUBTRACTION, keep: L.INTERSECTION};
  const brush = s => {
    if(s.sub) s = runSteps(s.sub, L);
    const g = new L.BufferGeometry();
    g.setAttribute('position', new L.BufferAttribute(s.pos, 3));
    g.setAttribute('normal', new L.BufferAttribute(s.norm, 3));
    if(s.idx) g.setIndex(new L.BufferAttribute(s.idx, 1));
    const b = new L.Brush(g); b.updateMatrixWorld();
    return b;
  };
  let acc = brush(steps[0]);
  for(const s of steps.slice(1)){
    const b = brush(s), prev = acc;
    acc = ev.evaluate(acc, b, OPS[s.op]);
    if(prev !== acc) prev.geometry.dispose();
    b.geometry.dispose();
  }
  const g = acc.geometry;
  return {pos: g.attributes.position.array, norm: g.attributes.normal.array, idx: g.index ? g.index.array : null};
}
