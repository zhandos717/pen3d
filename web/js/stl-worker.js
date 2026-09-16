// Сборка двоичного STL в фоновом потоке: на детали в тысячи треугольников
// запись буфера занимает около секунды и держит интерфейс.
//
// Сюда приходят только координаты вершин, без three.js: в воркере не действует
// importmap, и модули, импортирующие 'three' по имени, здесь бы не загрузились.

self.onmessage = e => {
  const p = e.data;                       // Float32Array: по 9 чисел на треугольник
  const tris = p.length / 9;
  const buf = new ArrayBuffer(84 + tris * 50);
  const view = new DataView(buf);
  new Uint8Array(buf, 0, 80).set(new TextEncoder().encode('usta'));
  view.setUint32(80, tris, true);

  let at = 84;
  const put = (x, y, z) => {
    view.setFloat32(at, x, true);
    view.setFloat32(at + 4, y, true);
    view.setFloat32(at + 8, z, true);
    at += 12;
  };
  for(let i = 0; i < p.length; i += 9){
    // three держит Y вверх, принтер ждёт Z
    const ax = p[i],   ay = -p[i+2], az = p[i+1];
    const bx = p[i+3], by = -p[i+5], bz = p[i+4];
    const cx = p[i+6], cy = -p[i+8], cz = p[i+7];
    const ux = bx-ax, uy = by-ay, uz = bz-az;
    const vx = cx-ax, vy = cy-ay, vz = cz-az;
    let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    put(nx/len, ny/len, nz/len);
    put(ax, ay, az); put(bx, by, bz); put(cx, cy, cz);
    view.setUint16(at, 0, true); at += 2;
  }
  self.postMessage(buf, [buf]);
};
