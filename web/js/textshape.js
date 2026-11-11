// Надпись в контуры без файлов шрифтов: текст рисуется системным шрифтом на canvas,
// пиксели по альфе обводятся в замкнутые контуры и упрощаются. Так работает любой шрифт
// и любой алфавит, который есть в системе (кириллица, Ә Ө Ұ Ү Қ Ғ Ң Һ І).
// Координаты y вверх; материал всегда слева от направления обхода: внешний контур идёт
// против часовой, дырка — по часовой.

// mask[y*w + x] — заполнен ли пиксель; строка 0 — верх картинки
export function traceMask(mask, w, h){
  const filled = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[(h - 1 - y)*w + x];
  const out = new Map(), key = (x, y) => x * 100003 + y;
  const edge = (x0, y0, x1, y1) => {
    const k = key(x0, y0);
    if(!out.has(k)) out.set(k, []);
    out.get(k).push([x0, y0, x1, y1]);
  };
  for(let y = 0; y < h; y++) for(let x = 0; x < w; x++){
    if(!filled(x, y)) continue;
    if(!filled(x, y - 1)) edge(x, y, x + 1, y);
    if(!filled(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
    if(!filled(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
    if(!filled(x - 1, y)) edge(x, y + 1, x, y);
  }
  // в седле (два пикселя касаются углом) из вершины выходит два ребра: поворачиваем влево,
  // к своему пикселю — тогда диагональные пиксели остаются разными контурами
  const turn = (dx, dy, e) => {
    const ex = e[2] - e[0], ey = e[3] - e[1];
    const cross = dx * ey - dy * ex, dot = dx * ex + dy * ey;
    return cross > 0 ? 0 : dot > 0 ? 1 : 2;
  };
  const loops = [];
  for(const list of out.values()){
    while(list.length){
      const first = list.pop(), loop = [[first[0], first[1]]];
      let cur = first;
      for(;;){
        const nx = cur[2], ny = cur[3];
        if(nx === first[0] && ny === first[1]) break;
        loop.push([nx, ny]);
        const cand = out.get(key(nx, ny));
        const dx = cur[2] - cur[0], dy = cur[3] - cur[1];
        let best = 0;
        for(let i = 1; i < cand.length; i++) if(turn(dx, dy, cand[i]) < turn(dx, dy, cand[best])) best = i;
        cur = cand.splice(best, 1)[0];
      }
      loops.push(loop);
    }
  }
  return loops;
}

export const area = loop => {
  let a = 0;
  for(let i = 0; i < loop.length; i++){ const p = loop[i], q = loop[(i + 1) % loop.length]; a += p[0]*q[1] - q[0]*p[1]; }
  return a / 2;
};

function inside(pt, loop){
  let c = false;
  for(let i = 0, j = loop.length - 1; i < loop.length; j = i++){
    const [xi, yi] = loop[i], [xj, yj] = loop[j];
    if((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// Рамер–Дуглас–Пекер для замкнутого контура: делим по самой дальней от начала точке
function rdp(pts, eps){
  if(pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]], dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  let far = 0, idx = 0;
  for(let i = 1; i < pts.length - 1; i++){
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0]*a[1] - b[1]*a[0]) / len;
    if(d > far){ far = d; idx = i; }
  }
  if(far <= eps) return [a, b];
  return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
}
export function simplify(loop, eps = 0.7){
  if(loop.length < 8) return loop;
  let far = 0, idx = 0;
  for(let i = 1; i < loop.length; i++){
    const d = Math.hypot(loop[i][0] - loop[0][0], loop[i][1] - loop[0][1]);
    if(d > far){ far = d; idx = i; }
  }
  const a = rdp(loop.slice(0, idx + 1), eps), b = rdp(loop.slice(idx).concat([loop[0]]), eps);
  const r = a.slice(0, -1).concat(b.slice(0, -1));
  return r.length >= 3 && Math.abs(area(r)) > 0 ? r : loop;
}

// Дырка принадлежит самому маленькому внешнему контуру, который её содержит. Точку для
// проверки берём чуть в материал от середины первого ребра дырки — вершина дырки может
// лежать прямо на внешнем контуре, и тогда «внутри или нет» не определено.
export function groupLoops(loops){
  const outers = [], holes = [];
  for(const l of loops) (area(l) > 0 ? outers : holes).push(l);
  const shapes = outers.map(o => ({outer: o, holes: [], a: area(o)}));
  for(const hl of holes){
    const [p, q] = [hl[0], hl[1]], mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy) || 1;
    const t = [mx - dy / len * .25, my + dx / len * .25];
    const host = shapes.filter(s => inside(t, s.outer)).sort((a, b) => a.a - b.a)[0];
    if(host) host.holes.push(hl);
  }
  return shapes.map(({outer, holes}) => ({outer, holes}));
}

// маска → фигуры в единичных координатах: x и y каждый в [-0.5, 0.5] по своему габариту;
// aspect = ширина / высота надписи, чтобы тело получило w = d × aspect
export function maskToShapes(mask, w, h, eps = 0.7){
  const raw = traceMask(mask, w, h);
  if(!raw.length) return null;
  const grouped = groupLoops(raw).map(s => ({outer: simplify(s.outer, eps), holes: s.holes.map(l => simplify(l, eps))}));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for(const s of grouped) for(const [x, y] of s.outer){ x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const W = x1 - x0, H = y1 - y0;
  const n = l => l.map(([x, y]) => [+((x - x0) / W - .5).toFixed(5), +((y - y0) / H - .5).toFixed(5)]);
  return {shapes: grouped.map(s => ({outer: n(s.outer), holes: s.holes.map(n)})), aspect: W / H};
}

const cache = new Map();
// текст → фигуры; в браузере, через canvas. Размер шрифта 160 px — буква ~110 px в высоту:
// глаз не видит ступенек, а точек после упрощения остаётся немного
export function textShapes(text, family = 'Arial', bold = true){
  const k = `${text}|${family}|${bold}`;
  if(cache.has(k)) return cache.get(k);
  const px = 160, font = `${bold ? 'bold ' : ''}${px}px "${family}", Arial, sans-serif`;
  const c = document.createElement('canvas'), g = c.getContext('2d', {willReadFrequently: true});
  g.font = font;
  const tw = Math.ceil(g.measureText(text || ' ').width) + 20, th = Math.ceil(px * 1.5);
  c.width = tw; c.height = th;
  g.font = font; g.textBaseline = 'middle'; g.fillStyle = '#000';
  g.fillText(text, 10, th / 2);
  const data = g.getImageData(0, 0, tw, th).data, mask = new Uint8Array(tw * th);
  for(let i = 0; i < mask.length; i++) mask[i] = data[i*4 + 3] > 127 ? 1 : 0;
  const r = maskToShapes(mask, tw, th);
  cache.set(k, r);
  return r;
}
