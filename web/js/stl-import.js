// Импорт STL: превращаем треугольники в геометрию, нормализованную к [-0.5,0.5] по каждой оси
// (та же система координат, что у box/cyl), плюс реальный габарит в мм для w/d/h.

function isBinary(buf){
  if(buf.byteLength < 84) return false;
  const n = new DataView(buf).getUint32(80, true);
  return 84 + n * 50 === buf.byteLength;
}

function parseBinary(buf){
  const v = new DataView(buf);
  const n = v.getUint32(80, true);
  const pos = new Float32Array(n * 9);
  let at = 84, o = 0;
  for(let i = 0; i < n; i++){
    at += 12;                                   // нормаль пропускаем — считаем заново
    for(let k = 0; k < 9; k++){ pos[o++] = v.getFloat32(at, true); at += 4; }
    at += 2;
  }
  return pos;
}

function parseAscii(text){
  const nums = [...text.matchAll(/vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g)]
    .flatMap(m => [+m[1], +m[2], +m[3]]);
  if(!nums.length) throw new Error('в STL не нашлось ни одной вершины');
  return new Float32Array(nums);
}

// three держит Y вверх, а STL из большинства слайсеров/CAD — Z вверх
function zUpToYUp(pos){
  for(let i = 0; i < pos.length; i += 3){
    const y = pos[i+1]; pos[i+1] = pos[i+2]; pos[i+2] = -y;
  }
}

export function parseStl(buf){
  const pos = isBinary(buf) ? parseBinary(buf) : parseAscii(new TextDecoder().decode(buf));
  zUpToYUp(pos);
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let i = 0; i < pos.length; i += 3){
    const x=pos[i], y=pos[i+1], z=pos[i+2];
    if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y; if(z<minZ)minZ=z; if(z>maxZ)maxZ=z;
  }
  const w = Math.max(.2, maxX-minX), h = Math.max(.2, maxY-minY), d = Math.max(.2, maxZ-minZ);
  const cx = (minX+maxX)/2, cy = (minY+maxY)/2, cz = (minZ+maxZ)/2;
  for(let i = 0; i < pos.length; i += 3){
    pos[i]   = (pos[i]   - cx) / w;
    pos[i+1] = (pos[i+1] - cy) / h;
    pos[i+2] = (pos[i+2] - cz) / d;
  }
  return {pts3: Array.from(pos), w: +w.toFixed(2), d: +d.toFixed(2), h: +h.toFixed(2)};
}
