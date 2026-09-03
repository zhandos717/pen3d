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

// Скруглённый прямоугольник: контур с дугами в углах.
// Настоящего fillet по всем рёбрам в CSG нет, но скругление в плане закрывает
// большинство случаев — корпуса, накладки, площадки, — и стоит один эскиз.
export function roundedRect(w, d, r, seg = 14){   // 14 сегментов на угол — погрешность 0.2%, меньше слоя
  const R = Math.max(0.1, Math.min(r, Math.min(w, d) / 2 - 0.01));
  const x = w / 2 - R, y = d / 2 - R;
  const pts = [];
  // против часовой: правый-верх → левый-верх → левый-низ → правый-низ,
  // каждая дуга продолжает предыдущую, иначе контур сам себя пересечёт
  const corners = [[x, y, 0], [-x, y, Math.PI / 2], [-x, -y, Math.PI], [x, -y, 3 * Math.PI / 2]];
  for(const [cx, cy, a0] of corners){
    for(let i = 0; i <= seg; i++){
      const a = a0 + (Math.PI / 2) * (i / seg);
      pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
    }
  }
  const span = Math.max(w, d);
  return {pts: pts.map(([px, py]) => [+(px / span).toFixed(5), +(py / span).toFixed(5)]),
          size: span, w, d, r: R};
}
