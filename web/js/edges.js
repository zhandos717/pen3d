// Рёбра детали после CSG. EdgesGeometry считает ребро с одним соседом границей и рисует
// его, а на плоской грани после вырезов полно Т-стыков — получалась вся триангуляция.
// Здесь такие рёбра пропускаются. Без three: модуль нужен и в воркере.
export function featureEdges(pos, index = null, angle = 25){
  const cos = Math.cos(angle * Math.PI / 180), n = index ? index.length : pos.length / 3;
  const at = i => index ? index[i] : i;
  const q = v => Math.round(v * 1e4);
  const key = i => `${q(pos[3*i])},${q(pos[3*i + 1])},${q(pos[3*i + 2])}`;
  const edges = new Map(), out = [];
  for(let f = 0; f + 2 < n; f += 3){
    const v = [at(f), at(f + 1), at(f + 2)];
    const [a, b, c] = v.map(i => [pos[3*i], pos[3*i + 1], pos[3*i + 2]]);
    const u = [c[0] - b[0], c[1] - b[1], c[2] - b[2]], w = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    let nx = u[1]*w[2] - u[2]*w[1], ny = u[2]*w[0] - u[0]*w[2], nz = u[0]*w[1] - u[1]*w[0];
    const len = Math.hypot(nx, ny, nz);
    if(len < 1e-10) continue;
    nx /= len; ny /= len; nz /= len;
    const k = v.map(key);
    for(let j = 0; j < 3; j++){
      const k0 = k[j], k1 = k[(j + 1) % 3];
      if(k0 === k1) continue;
      const h = k0 < k1 ? k0 + '|' + k1 : k1 + '|' + k0;
      const e = edges.get(h);
      if(!e){ edges.set(h, {i: v[j], j: v[(j + 1) % 3], n: [nx, ny, nz]}); continue; }
      if(e.n && e.n[0]*nx + e.n[1]*ny + e.n[2]*nz <= cos)
        out.push(pos[3*e.i], pos[3*e.i + 1], pos[3*e.i + 2], pos[3*e.j], pos[3*e.j + 1], pos[3*e.j + 2]);
      e.n = null;
    }
  }
  return new Float32Array(out);
}
