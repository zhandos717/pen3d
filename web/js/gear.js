// Эвольвентная шестерня по ГОСТ 13755: угол зацепления 20°, головка m, ножка 1.25m.
// Возвращает плоский контур — редактор выдавливает его в колесо, как обычный эскиз.
// Зацепляются только шестерни с одинаковым модулем, поэтому масштабировать их нельзя:
// растянув колесо, получишь нецелый модуль и пару, которая не работает.

const TAU = Math.PI * 2;
const inv = a => Math.tan(a) - a;

export function gearPoints(z, m, alphaDeg = 20, steps = 6){
  const alpha = alphaDeg * Math.PI / 180;
  const rp = m * z / 2;                  // делительная
  const rb = rp * Math.cos(alpha);       // основная
  const ra = rp + m;                     // вершин
  const rf = rp - 1.25 * m;              // впадин
  // угловая полутолщина зуба на радиусе r
  const half = r => Math.PI / (2 * z) + inv(alpha) - inv(Math.acos(Math.min(1, rb / r)));

  const r0 = Math.max(rb, rf) + 1e-6;
  const flank = [];
  for(let i = 0; i <= steps; i++){
    const r = r0 + (ra - r0) * i / steps;
    flank.push([r, half(r)]);
  }

  const pts = [];
  for(let k = 0; k < z; k++){
    const base = k * TAU / z;
    if(rf < rb) pts.push([rf * Math.cos(base - half(r0)), rf * Math.sin(base - half(r0))]);
    for(const [r, h] of flank) pts.push([r * Math.cos(base - h), r * Math.sin(base - h)]);
    for(let i = flank.length - 1; i >= 0; i--){
      const [r, h] = flank[i];
      pts.push([r * Math.cos(base + h), r * Math.sin(base + h)]);
    }
    if(rf < rb) pts.push([rf * Math.cos(base + half(r0)), rf * Math.sin(base + half(r0))]);
    const a1 = base + half(r0), a2 = base + TAU / z - half(r0);
    for(let i = 1; i < 4; i++){
      const a = a1 + (a2 - a1) * i / 4;
      pts.push([rf * Math.cos(a), rf * Math.sin(a)]);
    }
  }
  return {pts, tip: 2 * ra, pitch: 2 * rp, root: 2 * rf};
}

// Контур эскиза нормализован в [-0.5, 0.5]. Делим на диаметр вершин, а не на габаритную
// коробку: при нечётном числе зубьев она несимметрична, и центр эскиза уехал бы с оси —
// колесо било бы при вращении.
export function gearSketch(z, m){
  const g = gearPoints(z, m);
  return {
    pts: g.pts.map(([x, y]) => [+(x / g.tip).toFixed(5), +(y / g.tip).toFixed(5)]),
    size: +g.tip.toFixed(2), pitch: +g.pitch.toFixed(2), root: +g.root.toFixed(2),
  };
}
