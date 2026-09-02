// three держит Y вверх, принтер ждёт Z — оси меняются здесь и только здесь.
export function meshToStl(mesh){
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const p = g.attributes.position.array;
  // three: Y вверх → STL для принтера: Z вверх
  const V = i => [p[i], -p[i+2], p[i+1]];
  let out = 'solid pen3d\n';
  for(let i=0;i<p.length;i+=9){
    const [a,b,c] = [V(i), V(i+3), V(i+6)];
    const u = [b[0]-a[0], b[1]-a[1], b[2]-a[2]], v = [c[0]-a[0], c[1]-a[1], c[2]-a[2]];
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const L = Math.hypot(...n) || 1;
    out += `facet normal ${n[0]/L} ${n[1]/L} ${n[2]/L}\nouter loop\n`;
    for(const q of [a,b,c]) out += `vertex ${q[0]} ${q[1]} ${q[2]}\n`;
    out += 'endloop\nendfacet\n';
  }
  return out + 'endsolid pen3d\n';
}
