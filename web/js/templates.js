// Шаблоны: деталь из понятных полей («ширина платы», «кнопки закрыты») вместо координат.
// build() отдаёт тела в системе редактора: центр детали в (0,0), низ на столе. Размеры
// и приёмы — те же, что в examples/build.py, где они проверены check_scene.
import { roundedRect } from './gear.js';

const BASE = {rot: 0, rx: 0, rz: 0, sides: 6, dia: 10, pitch: 1.5, shell: 0, openTop: false,
              vis: true, hole: false, color: '#c3c8cf'};
const box = (name, x, y, z, w, d, h, extra) => ({...BASE, name, type: 'box', x, y, z, w, d, h, ...extra});
const cyl = (name, x, y, z, dia, h, extra) => ({...BASE, name, type: 'cyl', x, y, z, w: dia, d: dia, h, ...extra});
const hole = o => ({...o, hole: true, color: '#d0455f'});
function rounded(name, x, y, z, w, d, h, r){
  const g = roundedRect(w, d, r);
  return {...BASE, name, type: 'sketch', x, y, z, w: g.size, d: g.size, h, pts: g.pts};
}

// Размеры телефонов — только по официальным чертежам производителя, не на глаз:
// на глаз в чехле промахиваешься с камерой, вспышкой и бортиком.
// Координаты в мм: от верха телефона; стороны — как смотришь на экран.
export const PHONES = {
  'iphone-16e': {
    name: 'iPhone 16e', source: 'Apple Dimensional Drawings, 2025-03-17',
    L: 146.71, W: 71.52, H: 7.80, R: 11,        // угол — плавная кривая до 15.7 мм, дуга R11 её огибает
    bump: 1.68, glass: 1.05, btn: 0.45,         // выступ камеры, край стекла от корпуса, выступ кнопок
    // окно камеры сзади: линза Ø14.97 в 13.32/13.32, микрофон 24.30, вспышка 29.68 (от правого бока)
    camera: {top: 13.32, side: 19.2, len: 20, wid: 31, r: 10},
    buttons: [{name: 'Action', side: 'left', at: 31.28, len: 7},
              {name: 'громкость +', side: 'left', at: 45.43, len: 10},
              {name: 'громкость −', side: 'left', at: 59.63, len: 10},
              {name: 'боковая кнопка', side: 'right', at: 52.53, len: 17}],
    // низ, от левого бока: разъём — зона под штекер 12.45 × 6.80 R3.25 по центру 35.76;
    // 8 портов Ø1.53 — 3 слева (микрофон), 5 справа (динамик, микрофон 2); 30.87 и 40.55 — винты
    usb: {from: 35.76, len: 12.45, h: 6.8},
    ports: [18.79, 24.83, 28.84, 42.89, 46.89, 50.34, 53.79, 57.24],   // справа: микрофон 42.89, динамик 46.89–57.24
  },
  'iphone-16': {
    name: 'iPhone 16', source: 'Apple Dimensional Drawings, 2024-09-19',
    L: 147.64, W: 71.63, H: 7.81, R: 12.5,      // угол заканчивается в 17.4 мм от края
    bump: 3.48, glass: 1.0, btn: 0.45,          // остров камеры выступает на 3.48 — больше предела спинки 2.1
    // остров: 1.09–26.16 от правого бока, 1.25–43.72 от верха; вспышка Ø6.28 в 30.01 / 22.48
    camera: {top: 22.5, side: 17.3, len: 45.5, wid: 34.5, r: 12},
    buttons: [{name: 'Action', side: 'left', at: 34.08, len: 7},
              {name: 'громкость +', side: 'left', at: 48.23, len: 10},
              {name: 'громкость −', side: 'left', at: 62.43, len: 10},
              {name: 'боковая кнопка', side: 'right', at: 55.33, len: 18}],
    // Camera Control — сенсор, накладкой его не закрыть: окно по зоне Apple 25 × 4.2 у поверхности,
    // с запасом на скос стенки (у тонкого чехла Apple даёт 29.7 × 6.32)
    open: [{name: 'Camera Control', side: 'right', at: 96.23, len: 29.7, h: 6.3}],
    usb: {from: 35.81, len: 12.45, h: 6.6},
    ports: [19.75, 24.26, 28.89, 42.74, 47.37, 50.38, 53.38, 56.39],   // 31.31 и 40.31 — винты
  },
  'iphone-16-pro': {
    name: 'iPhone 16 Pro', source: 'Apple Dimensional Drawings, 2024-09-19',
    L: 149.61, W: 71.45, H: 8.25, R: 13.8,      // угол заканчивается в 19.23 мм от края
    bump: 4.28, glass: 1.0, btn: 0.45,          // три камеры выступают на 4.28
    // квадратный остров 1.04–46.54 от верха и от правого бока; вспышка Ø6.92, микрофон внутри
    camera: {top: 23.8, side: 23.8, len: 47.6, wid: 47.6, r: 13},
    buttons: [{name: 'Action', side: 'left', at: 34.08, len: 7},
              {name: 'громкость +', side: 'left', at: 48.23, len: 10},
              {name: 'громкость −', side: 'left', at: 62.43, len: 10},
              {name: 'боковая кнопка', side: 'right', at: 55.33, len: 18}],
    open: [{name: 'Camera Control', side: 'right', at: 98.19, len: 29.7, h: 6.3}],
    usb: {from: 35.72, len: 12.45, h: 6.6},
    ports: [19.70, 24.21, 28.79, 42.64, 47.23, 50.24, 53.24, 56.25],   // 30.86 и 40.58 — винты
  },
  'iphone-15': {
    name: 'iPhone 15', source: 'Apple Dimensional Drawings, 2023-10-10',
    L: 147.64, W: 71.63, H: 7.81, R: 12.5,
    bump: 3.48, glass: 1.0, btn: 0.45,
    // квадратный остров 1.22–37.15 от верха и от правого бока; линзы Ø15.07, вспышка Ø6.28
    camera: {top: 19.2, side: 19.2, len: 38.3, wid: 38.3, r: 12},
    buttons: [{name: 'громкость +', side: 'left', at: 46.27, len: 10},
              {name: 'громкость −', side: 'left', at: 60.47, len: 10},
              {name: 'боковая кнопка', side: 'right', at: 53.37, len: 18}],
    // переключатель беззвучного режима двигают ногтем — сквозь чехол не переключить
    open: [{name: 'переключатель звука', side: 'left', at: 32.83, len: 11, h: 5.2}],
    usb: {from: 35.81, len: 12.45, h: 6.6},
    ports: [19.59, 24.10, 28.89, 42.74, 47.53, 50.54, 53.54, 56.55],   // 31.31 и 40.31 — винты
  },
};

// На виде сверху +Y в usta смотрит вниз экрана: левый бок телефона (экраном вверх,
// верх по +X) лежит на −Y, правый — на +Y.
function phoneCase(v){
  const P = PHONES[v.phone], GAP = v.gap, T = v.wall;
  // спинка 0 — «по камере»: чуть толще выступа, чтобы телефон не качался; тоньше — камера
  // выглядывает из окна, зато чехол тоньше. 2.1 — предел Apple (дальше не работает MagSafe)
  const BACK = v.back > 0 ? Math.min(2.1, v.back) : Math.min(2.1, Math.max(P.bump + .2, 1.2));
  const LIP = Math.min(v.lip, P.glass - .15);                // стекло трогать нельзя
  const TOP = BACK + P.H + v.rim, MID = BACK + P.H/2;
  const fromTop = t => P.L/2 - t, fromLeft = s => -(P.W/2 - s);
  const out = [
    {...rounded('корпус', 0, 0, 0, P.L + 2*(GAP + T), P.W + 2*(GAP + T), TOP, P.R + GAP + T),
     edge: Math.min(v.edge, BACK - .3)},                   // скругление не должно съесть спинку
    hole(rounded('гнездо телефона', 0, 0, BACK, P.L + 2*GAP, P.W + 2*GAP, P.H + .05, P.R + GAP)),
    hole(rounded('окно экрана', 0, 0, BACK + P.H, P.L - 2*LIP, P.W - 2*LIP, 3, P.R - LIP)),
    hole(rounded('камера', fromTop(P.camera.top), P.W/2 - P.camera.side, -1, P.camera.len, P.camera.wid,
                 BACK + 2, P.camera.r)),
  ];
  // нижний торец: тела повёрнуты rz=90, чтобы выдавливаться сквозь стенку по X; у повёрнутого
  // тела центр по высоте — z + h/2. Порт — своё круглое окно на 0.5 шире, а не общая прорезь:
  // общая сливалась с окном разъёма в одну дыру во весь низ
  // Порт, стоящий к зоне разъёма ближе 0.6 мм, забираем в окно USB-C: перемычку тоньше линии
  // сопла не напечатать, и круглое окно врезалось бы в овал зазубриной
  const depth = T + 4, endX = -(P.L/2 + GAP + T/2), PORT = 2.0, WEB = 0.6;
  let lo = P.usb.from - P.usb.len/2, hi = P.usb.from + P.usb.len/2;
  const ports = [];
  for(const at of P.ports){
    if(at + PORT/2 > lo - WEB && at - PORT/2 < hi + WEB){ lo = Math.min(lo, at - PORT/2); hi = Math.max(hi, at + PORT/2); }
    else ports.push(at);
  }
  out.push(hole({...rounded('USB-C', endX, fromLeft((lo + hi)/2), MID - depth/2, P.usb.h, hi - lo, depth, P.usb.h/2),
                 rz: 90}));
  ports.forEach((at, i) => out.push(hole(cyl(`порт ${i + 1}`, endX, fromLeft(at), MID - depth/2, PORT, depth, {rz: 90}))));
  const wallIn = P.W/2 + GAP, pocket = P.btn + .1 - GAP;
  for(const b of P.buttons){
    const sgn = b.side === 'left' ? -1 : 1;
    if(v.covered){
      // накладка нажимается сквозь TPU; карман — под выступ кнопки, иначе чехол давит на неё всегда
      out.push(box(`${b.name}: накладка`, fromTop(b.at), sgn*(wallIn + (T + .8)/2), MID - 1.75, b.len, T + .8, 3.5));
      if(pocket > 0) out.push(hole(box(`${b.name}: карман`, fromTop(b.at), sgn*(wallIn + pocket/2 - .5), MID - 2.25,
                                       b.len + 1, pocket + 1, 4.5)));
    }else{
      out.push(hole(box(b.name, fromTop(b.at), sgn*(wallIn + T/2), MID - 2.75, b.len + 3, T + 4, 5.5)));
    }
  }
  // сенсорные кнопки остаются открытыми: скруглённое окно поперёк боковой стенки (rx=90 —
  // выдавливание по Y, высота окна — размер d; центр по высоте — z + h/2)
  for(const b of P.open || []){
    const sgn = b.side === 'left' ? -1 : 1, depth = T + 4;
    out.push(hole({...rounded(b.name, fromTop(b.at), sgn*(wallIn + T/2), MID - depth/2, b.len, b.h, depth, b.h/2), rx: 90}));
  }
  // материал детали уходит в печать: сервер не станет резать чехол под PLA
  if(v.material) out.forEach(o => { if(!o.hole) o.material = v.material; });
  return out;
}

// Корпус собран из дна и стенок, а не «коробка минус полость»: CSG вычитает отверстия
// после объединения тел, и полость срезала бы бобышки внутри.
function enclosure(v){
  const {w: W, d: D, h: H, wall: T} = v, out = [
    box('дно', 0, 0, 0, W, D, T),
    box('стенка задняя', 0, D/2 - T/2, 0, W, T, H),
    box('стенка передняя', 0, -(D/2 - T/2), 0, W, T, H),
    box('стенка левая', -(W/2 - T/2), 0, 0, T, D - 2*T, H),
    box('стенка правая', W/2 - T/2, 0, 0, T, D - 2*T, H),
  ];
  if(v.bosses){
    const ix = W/2 - T - 5, iy = D/2 - T - 5;
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy], i) => {
      out.push(box(`бобышка ${i + 1}`, sx*ix, sy*iy, T, 8, 8, 6));
      out.push(hole(cyl(`под винт ${i + 1}`, sx*ix, sy*iy, T + 1.5, v.screw, 8)));
    });
  }
  if(v.port > 0) out.push(hole(box('окно под разъём', W/2 - T/2, 0, T + 3, T + 4, v.port, 9)));
  return out;
}

// Косынка держит угол: без неё полка отламывается по слою — самое слабое место FDM.
function bracket(v){
  const {w: W, d: D, h: H, t: T, hole: Hd} = v, out = [
    box('основание', 0, 0, 0, W, D, T),
    box('полка', -(W/2 - T/2), 0, T, T, D, H - T),
    box('ребро', -(W/2 - T) + Math.min(W, H)/4, 0, T, Math.min(W, H)/2, 4, Math.min(W, H)/2),
  ];
  const n = Math.max(1, Math.round(v.holes));
  for(let i = 0; i < n; i++){
    const y = n === 1 ? 0 : -D/2 + 8 + i*(D - 16)/(n - 1);
    out.push(hole(cyl(`в основании ${i + 1}`, W/4, y, -1, Hd, T + 2)));
    // повёрнутое тело стоит центром на z + h/2 — ось сквозь полку по X, центр на середине полки
    out.push(hole(cyl(`в полке ${i + 1}`, -(W/2 - T/2), y, T + (H - T)/2 - (T + 2)/2, Hd, T + 2, {rz: 90})));
  }
  return out;
}

export const TEMPLATES = [
  {id: 'phone-case', name: 'Чехол для телефона', hint: 'TPU. Размеры по чертежу производителя телефона.',
   fields: [
     {k: 'phone', label: 'телефон', type: 'select', options: Object.entries(PHONES).map(([k, p]) => [k, p.name]), def: 'iphone-16e'},
     {k: 'material', label: 'материал', type: 'select', options: [['TPU', 'TPU 95A (гибкий)'], ['', 'любой']], def: 'TPU'},
     {k: 'covered', label: 'кнопки закрыты накладками', type: 'check', def: true},
     {k: 'wall', label: 'стенка, мм', def: 1.6, min: 1.2, max: 3},
     {k: 'back', label: 'спинка, мм (0 — по камере)', def: 0, min: 0, max: 2.1},
     {k: 'rim', label: 'бортик выше экрана, мм', def: 0.8, min: 0.3, max: 2},
     {k: 'lip', label: 'бортик над экраном, мм', def: 0.9, min: 0.3, max: 2},
     {k: 'gap', label: 'зазор на сторону, мм', def: 0.2, min: 0, max: 0.6},
     {k: 'edge', label: 'скругление рёбер, мм', def: 1.2, min: 0, max: 2},
   ], build: phoneCase},
  {id: 'enclosure', name: 'Корпус под плату', hint: 'Дно, стенки, бобышки под винты и окно под разъём.',
   fields: [
     {k: 'w', label: 'длина, мм', def: 80, min: 20, max: 250},
     {k: 'd', label: 'ширина, мм', def: 60, min: 20, max: 250},
     {k: 'h', label: 'высота, мм', def: 25, min: 8, max: 200},
     {k: 'wall', label: 'стенка, мм', def: 2.4, min: 2, max: 6},
     {k: 'bosses', label: 'бобышки под винты', type: 'check', def: true},
     {k: 'screw', label: 'отверстие под саморез, мм', def: 2.6, min: 1.5, max: 5},
     {k: 'port', label: 'окно под разъём, мм (0 — без)', def: 16, min: 0, max: 60},
   ], build: enclosure},
  {id: 'bracket', name: 'L-кронштейн', hint: 'Уголок с ребром жёсткости и отверстиями под крепёж.',
   fields: [
     {k: 'w', label: 'основание, мм', def: 60, min: 20, max: 200},
     {k: 'd', label: 'ширина, мм', def: 40, min: 15, max: 200},
     {k: 'h', label: 'высота полки, мм', def: 50, min: 15, max: 200},
     {k: 't', label: 'толщина, мм', def: 5, min: 2, max: 15},
     {k: 'holes', label: 'отверстий в ряд', def: 3, min: 1, max: 6},
     {k: 'hole', label: 'диаметр отверстий, мм', def: 5.5, min: 2, max: 12},
   ], build: bracket},
];

export const defaults = tpl => Object.fromEntries(tpl.fields.map(f => [f.k, f.def]));
export function clampValues(tpl, v){
  const out = {};
  for(const f of tpl.fields){
    let x = v[f.k] ?? f.def;
    if(f.type === 'check') x = !!x;
    else if(f.type === 'select') x = f.options.some(([k]) => k === x) ? x : f.def;
    else { x = +x; if(!Number.isFinite(x)) x = f.def; x = Math.min(f.max, Math.max(f.min, x)); }
    out[f.k] = x;
  }
  return out;
}
