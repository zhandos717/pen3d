// Библиотека электронных компонентов: модули реальных размеров для корпусов. Новый модуль —
// одна запись. Координаты в мм от центра платы, z = 0 — низ компонента; длинная сторона по X,
// разъёмы — к −X, лицевая сторона корпуса — сверху (+Z).
//   bodies  — сам модуль: справочные тела, видны и едут с деталью, но не печатаются;
//   keepout — зона «не занимать»: полупрозрачная, тоже не печатается;
//   cutouts — вырез в корпусе: отверстия, которые режут печатные тела, а не только свою деталь.
// Размеры — по даташитам и замерам модулей; где модули у продавцов отличаются, взят типичный.

import { roundedRect } from './gear.js';

const BLUE = '#1f4d9e', PURPLE = '#5b3a8c', BLACK_PCB = '#1b1d21', METAL = '#b9bec6',
      BLACK = '#26282c', WHITE = '#eceff2', GOLD = '#c9a64a', HOLE = '#0b0c0e';
const box = (name, x, y, z, w, d, h, color, extra) => ({name, type: 'box', x, y, z, w, d, h, color, ...extra});
const cyl = (name, x, y, z, dia, h, color, extra) => ({name, type: 'cyl', x, y, z, w: dia, d: dia, h, color, ...extra});
// цилиндр, лежащий вдоль X: у повёрнутого тела центр по высоте — z + h/2
const lying = (name, x, y, zc, dia, len, color) => ({name, type: 'cyl', x, y, z: zc - len/2, w: dia, d: dia, h: len, color, rz: 90});
// плата со скруглёнными углами: эскиз, у которого w = d = размах контура
function pcb(name, x, y, z, w, d, h, color, r = 1){
  const g = roundedRect(w, d, r);
  return {name, type: 'sketch', x, y, z, w: g.size, d: g.size, h, color, pts: g.pts};
}
// монтажное или переходное отверстие на справочной плате — тёмный цилиндр чуть толще платы:
// резать CSG ради картинки незачем, плата всё равно не печатается
const via = (name, x, y, z, dia, h = 1.7) => cyl(name, x, y, z - .05, dia, h, HOLE);

const usbC = (name, x, y, z) => box(name, x, y, z, 7.35, 8.9, 3.2, METAL);
const microUsb = (name, x, y, z) => box(name, x, y, z, 5.8, 7.5, 2.9, METAL);
// окно в стенке корпуса перед разъёмом на −X: вынесено наружу, чтобы прорезать любую стенку
const windowX = (name, x, y, zc, w, h) => box(name, x - 6, y, zc - h/2, 12, w, h);
const holeUp = (name, x, y, z, dia, h = 12) => cyl(name, x, y, z, dia, h);

// гребёнка штырей снизу платы: пластиковый брусок и штыри через один — узнаваемо, без сотни тел
function header(name, x, y, n, zBottom = 0){
  const len = n * 2.54, out = [box(`${name}: брусок`, x, y, zBottom - 2.5, len, 2.54, 2.5, BLACK)];
  for(let i = 0; i < n; i += 2) out.push(box(`${name}: штырь ${i + 1}`, x - len/2 + 1.27 + i * 2.54, y, zBottom - 8.5, .64, .64, 6, GOLD));
  return out;
}
// модуль ESP32: своя плата, металлический экран и полоса антенны на свободном конце
function wroom(x, z, len = 25.5, wid = 18, antenna = 6.5){
  return [box('модуль: плата', x, 0, z, wid, len, .8, BLACK_PCB),
          box('модуль: экран', x - antenna/2 + .3, 0, z + .8, wid - antenna - .6, len - 2, 2.3, METAL),
          box('модуль: антенна', x + wid/2 - antenna/2, 0, z + .8, antenna - 1, len - 3, .05, GOLD)];
}
const smdButton = (name, x, y, z) => [box(name, x, y, z, 4, 3, 1.5, METAL), box(name + ': толкатель', x, y, z + 1.5, 1.6, 1.2, .5, BLACK)];

function grille(cx, cy, z, r, hole = 1.5, step = 3){
  const out = [];
  for(let i = -10; i <= 10; i++) for(let j = -10; j <= 10; j++){
    const x = i * step + (j % 2 ? step / 2 : 0), y = j * step * .866;
    if(Math.hypot(x, y) <= r - hole / 2) out.push(holeUp(`решётка ${out.length + 1}`, cx + x, cy + y, z, hole, 8));
  }
  return out;
}

function ring(name, n, rOut, rIn, h, color){
  const out = [], rm = (rOut + rIn) / 2;
  for(let i = 0; i < n; i++){
    const a = i / n * 2 * Math.PI;
    out.push(box(`${name} ${i + 1}`, rm * Math.cos(a), rm * Math.sin(a), 0, rOut - rIn, 2 * Math.PI * rm / n + .3, h, color,
                 {rot: +(-a * 180 / Math.PI).toFixed(2)}));
  }
  return out;
}

// аккумулятор 18650 лёжа: термоусадка, металлические торцы, плюсовой выступ
function cell18650(name, x, y, zc, color = '#7a3fb5'){
  return [lying(`${name}: корпус`, x, y, zc, 18.4, 64.2, color),
          lying(`${name}: минус`, x - 32.3, y, zc, 17.6, .4, METAL),
          lying(`${name}: плюс`, x + 32.3, y, zc, 17.6, .4, METAL),
          lying(`${name}: выступ +`, x + 32.9, y, zc, 7, .8, METAL)];
}

export const COMPONENTS = [
  {id: 'esp32-s3-devkitc', name: 'ESP32-S3-DevKitC-1', label: 'ESP32-S3', icon: 'board', note: 'N16R8, два USB-C',
   bodies: [pcb('плата', 0, 0, 0, 69, 25.5, 1.6, BLACK_PCB),
            ...wroom(69/2 - 9, 1.6),
            usbC('USB-C (UART)', -69/2 + 2.7, 7, 1.6), usbC('USB-C (USB)', -69/2 + 2.7, -7, 1.6),
            ...smdButton('кнопка BOOT', -22, 9.5, 1.6), ...smdButton('кнопка RST', -22, -9.5, 1.6),
            box('LDO', -12, 0, 1.6, 6.5, 3.5, 1.6, BLACK), box('RGB-светодиод', -15, 6, 1.6, 2, 2, .8, WHITE),
            via('отверстие 1', 69/2 - 1.5, 11.4, 0, 1), via('отверстие 2', -69/2 + 1.5, 11.4, 0, 1),
            ...header('гребёнка J1', 0, 11.43, 22), ...header('гребёнка J3', 0, -11.43, 22)],
   keepout: [box('не занимать', -1, 0, -8.5, 71, 27.5, 13.5)],
   cutouts: [windowX('окно USB-C 1', -69/2, 7, 3.2, 9.5, 3.8), windowX('окно USB-C 2', -69/2, -7, 3.2, 9.5, 3.8)]},
  {id: 'esp32-devkit-v1', name: 'ESP32-WROOM-32 DevKit', label: 'ESP32', icon: 'board', note: 'CH340, 38 pin, micro-USB',
   bodies: [pcb('плата', 0, 0, 0, 51.5, 28, 1.6, BLACK_PCB),
            ...wroom(51.5/2 - 9, 1.6),
            microUsb('micro-USB', -51.5/2 + 2, 0, 1.6),
            ...smdButton('кнопка BOOT', -19, 9, 1.6), ...smdButton('кнопка EN', -19, -9, 1.6),
            box('CH340C', -8, 0, 1.6, 6, 5, 1.5, BLACK), box('AMS1117', -14, 5.5, 1.6, 6.5, 3.5, 1.6, BLACK),
            ...header('гребёнка 1', 0, 12.7, 19), ...header('гребёнка 2', 0, -12.7, 19)],
   keepout: [box('не занимать', -1, 0, -8.5, 53.5, 30, 13.5)],
   cutouts: [windowX('окно micro-USB', -51.5/2, 0, 3.05, 8.5, 3.8)]},
  {id: 'cell-18650', name: 'Аккумулятор 18650', label: '18650', icon: 'cell', note: 'Ø18.6 × 65, лёжа',
   bodies: cell18650('аккумулятор', -.4, 0, 9.3),
   keepout: [box('не занимать', 0, 0, 0, 67, 20.6, 19.6)], cutouts: []},
  {id: 'holder-2x18650', name: 'Держатель 2×18650', label: 'Батарея 2×18650', icon: 'cell', note: '77 × 41 × 21, M3 по оси',
   bodies: [box('дно', 0, 0, 0, 77, 41, 1.2, BLACK),
            box('стенка 1', 0, 20.5 - .6, 0, 77, 1.2, 15, BLACK), box('стенка 2', 0, -20.5 + .6, 0, 77, 1.2, 15, BLACK),
            box('перегородка', 0, 0, 0, 60, 1.2, 9, BLACK),
            box('торец 1', 38.5 - .6, 0, 0, 1.2, 41, 21, BLACK), box('торец 2', -38.5 + .6, 0, 0, 1.2, 41, 21, BLACK),
            box('пружина 1', 36.6, 9.7, 5, .6, 9, 9, METAL), box('пружина 2', 36.6, -9.7, 5, .6, 9, 9, METAL),
            box('контакт 1', -36.6, 9.7, 5, .6, 9, 9, METAL), box('контакт 2', -36.6, -9.7, 5, .6, 9, 9, METAL),
            via('M3 1', 25, 0, 0, 3.2, 1.3), via('M3 2', -25, 0, 0, 3.2, 1.3),
            ...cell18650('аккумулятор 1', 0, 9.7, 10.5), ...cell18650('аккумулятор 2', 0, -9.7, 10.5)],
   keepout: [box('не занимать', 0, 0, 0, 79, 43, 22)],
   cutouts: [holeUp('M3 1', 25, 0, -5, 3.4, 6), holeUp('M3 2', -25, 0, -5, 3.4, 6)]},
  {id: 'tp4056-c', name: 'TP4056 с защитой', label: 'Зарядка TP4056', icon: 'board', note: 'Type-C, 28 × 17',
   bodies: [pcb('плата', 0, 0, 0, 28, 17, 1.6, BLUE), usbC('USB-C', -14 + 2.7, 0, 1.6),
            box('TP4056', 2, 0, 1.6, 5, 4, 1.5, BLACK), box('DW01', 8, 4, 1.6, 3, 3, 1, BLACK), box('FS8205', 8, -3, 1.6, 3, 3, 1, BLACK),
            box('светодиод зарядки', -4, 6, 1.6, 1.6, .8, .6, '#e33'), box('светодиод готов', -4, -6, 1.6, 1.6, .8, .6, '#36f'),
            ...[['B+', 12.3, 5], ['B−', 12.3, -5], ['OUT+', 12.3, 1.8], ['OUT−', 12.3, -1.8]].map(([n, x, y]) => box('площадка ' + n, x, y, 1.6, 2.4, 2, .05, GOLD))],
   keepout: [box('не занимать', -1, 0, -.5, 30, 19, 6)],
   cutouts: [windowX('окно USB-C', -14, 0, 3.2, 9.5, 3.8)]},
  {id: 'mt3608', name: 'MT3608 повышающий', label: 'MT3608', icon: 'board', note: '36 × 17, подстроечник',
   bodies: [pcb('плата', 0, 0, 0, 36, 17, 1.6, BLUE),
            via('крепёж 1', -15, 0, 0, 3), via('крепёж 2', 15, 0, 0, 3),
            box('подстроечник', 7, 4.5, 1.6, 9.5, 4.5, 10, '#2a5ad1'), cyl('винт подстроечника', 7 - 4.75 - .6, 4.5, 6, 2.4, 2.5, GOLD, {rz: 90}),
            cyl('дроссель', -6, -1, 1.6, 5.8, 4.5, '#3a3d42'), box('MT3608', 1, -4, 1.6, 3, 1.6, 1.1, BLACK),
            box('диод', 6, -4.5, 1.6, 3.5, 2.6, 2, BLACK)],
   keepout: [box('не занимать', 0, 0, -.5, 38, 19, 13)], cutouts: []},
  {id: 'max98357a', name: 'MAX98357A усилитель', label: 'Усилитель MAX98357A', icon: 'board', note: '17.8 × 19, клеммник',
   bodies: [pcb('плата', 0, 0, 0, 17.8, 19, 1.6, PURPLE),
            box('клеммник', 0, 9.5 - 3.75, 1.6, 7.5, 7.5, 9, '#2f8f4a'),
            cyl('винт клеммы 1', -1.9, 9.5 - 3.75, 10.6, 2.6, .4, METAL), cyl('винт клеммы 2', 1.9, 9.5 - 3.75, 10.6, 2.6, .4, METAL),
            box('MAX98357A', 0, -2, 1.6, 3, 3, .8, '#555'),
            ...header('гребёнка', 0, -7.6, 7)],
   keepout: [box('не занимать', 0, 0, -8.5, 19.8, 21, 20)], cutouts: []},
  {id: 'inmp441', name: 'Микрофон INMP441', label: 'Микрофон INMP441', icon: 'mic', note: 'Ø14, порт снизу',
   bodies: [cyl('плата', 0, 0, 0, 14, 1.6, PURPLE), box('INMP441', 0, 0, -1, 4, 3, 1, METAL),
            via('порт', 0, 0, 0, 1),
            // плата ставится портом вниз — штыри смотрят вверх: гребёнка отражена относительно платы
            ...header('гребёнка', 0, 4.5, 3).map(o => ({...o, z: 1.6 - (o.z + o.h)}))],
   keepout: [box('не занимать', 0, 0, -1.5, 16, 16, 14)],
   // порт снизу: отверстие в дне корпуса и неглубокое кольцо под прокладку
   cutouts: [holeUp('порт микрофона', 0, 0, -6, 1.6, 6), holeUp('кольцо под прокладку', 0, 0, -1.6, 6, .6)]},
  ...[[40, 20, 18], [50, 25, 20]].map(([D, mag, depth]) => ({
    id: `speaker-${D}`, name: `Динамик Ø${D} 3 Вт`, label: `Динамик Ø${D}`, icon: 'speaker', note: `глубина ${depth}, фланец 3`,
    bodies: [cyl('магнит', 0, 0, 0, mag, 7, '#4a4d52'), cyl('керн', 0, 0, 7, mag * .55, 1.5, METAL),
             {name: 'корзина', type: 'cone', x: 0, y: 0, z: 8, w: D - 2, d: D - 2, h: depth - 11, color: BLACK, rx: 180},
             {name: 'диффузор', type: 'cone', x: 0, y: 0, z: depth - 8, w: D - 8, d: D - 8, h: 5, color: '#3b3e44', rx: 180},
             {name: 'колпачок', type: 'sphere', x: 0, y: 0, z: depth - 5, w: D * .32, d: D * .32, h: 3, color: '#2e3136'},
             cyl('подвес', 0, 0, depth - 3.4, D - 5, .5, '#55595f'),
             ...ring('фланец', 20, D/2, D/2 - 3, 3, BLACK).map(o => ({...o, z: depth - 3})),
             ...[45, 135, 225, 315].map((a, i) => via(`отверстие фланца ${i + 1}`, (D/2 - 1.6) * Math.cos(a * Math.PI/180), (D/2 - 1.6) * Math.sin(a * Math.PI/180), depth - 3, 2, 3.1))],
    keepout: [cyl('не занимать', 0, 0, 0, D + 2, depth + .5)],
    cutouts: grille(0, 0, depth - 1, D / 2 - 4)})),
  ...[[12, 12, 7.3, 3.5, 4.5], [6, 6, 5, 3.5, 4]].map(([a, b, H, stem, hole]) => ({
    id: `tact-${a}`, name: `Тактовая кнопка ${a}×${b}`, label: `Кнопка ${a}×${b}`, icon: 'button', note: `высота ${H}, шток Ø${stem}`,
    bodies: [box('корпус кнопки', 0, 0, 0, a, b, 3.3, BLACK), box('крышка', 0, 0, 3.3, a, b, .3, METAL),
             cyl('шток', 0, 0, 3.6, stem, H - 3.6, a > 6 ? '#3a3d42' : BLACK),
             ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy], i) => box(`ножка ${i + 1}`, sx * (a/2 - .4), sy * (b/2 - 1), -3, .7, .3, 3, METAL))],
    keepout: [box('не занимать', 0, 0, -3, a + 1, b + 1, H + 3.5)],
    cutouts: [holeUp('отверстие под шток', 0, 0, H - 2, hole, 12)]})),
  ...[[24, 23, 27, 18], [30, 28, 33, 24]].map(([D, body, bezel, cap]) => ({
    id: `arcade-${D}`, name: `Аркадная кнопка ${D} мм`, label: `Кнопка ${D} мм`, icon: 'button', note: `вырез Ø${D}, глубина ~30`,
    bodies: [cyl('стакан', 0, 0, 4, body, 24, BLACK), box('микропереключатель', 0, 0, 0, 12, 6, 6, BLACK),
             {name: 'гайка', type: 'poly', sides: 6, x: 0, y: 0, z: 22, w: body + 7, d: body + 7, h: 3, color: BLACK},
             cyl('шайба', 0, 0, 28, body + 4, 1, '#5a5d63'),
             cyl('ободок', 0, 0, 30, bezel, 3, '#d33'), cyl('колпачок', 0, 0, 33, cap, 4, '#e44')],
    keepout: [cyl('не занимать', 0, 0, 0, body + 8, 37.5)],
    cutouts: [holeUp('вырез под кнопку', 0, 0, 25, D, 8)]})),
  {id: 'usb-c-socket', name: 'Гнездо USB-C на плате', label: 'USB-C', icon: 'port', note: '9 × 7.4 × 3.2',
   bodies: [pcb('плата', 1.5, 0, 0, 12, 12, 1.6, BLACK_PCB), box('гнездо', -2, 0, 1.6, 7.4, 9, 3.2, METAL),
            box('язычок', -3.5, 0, 2.8, 4.5, 6.6, .7, BLACK)],
   keepout: [box('не занимать', 0, 0, -.5, 15.5, 13, 6)],
   cutouts: [windowX('окно USB-C', -5.7, 0, 3.2, 9.5, 3.8)]},
  {id: 'ss12d00', name: 'Выключатель SS12D00', label: 'Выключатель', icon: 'switch', note: '12 × 6 × 6, ручка 4',
   bodies: [box('корпус', 0, 0, 0, 12, 6, 5.5, BLACK), box('обойма', 0, 0, 5.5, 12, 6, .5, METAL), box('ручка', 1, 0, 6, 4, 2, 4, '#555'),
            ...[-2.5, 0, 2.5].map((x, i) => box(`вывод ${i + 1}`, x, 0, -4, .5, .3, 4, METAL))],
   keepout: [box('не занимать', 0, 0, -4, 13, 7, 14.5)],
   cutouts: [box('прорезь', 0, 0, 7, 7, 3, 12)]},
  ...[[5, 8.6, 5.8], [3, 5.3, 3.8]].map(([D, H, fl]) => ({
    id: `led-${D}`, name: `Светодиод ${D} мм`, label: `Светодиод ${D} мм`, icon: 'led', note: `Ø${D}, высота ${H}`,
    bodies: [cyl('юбка', 0, 0, 0, fl, 1, '#f3d0d0'), cyl('корпус', 0, 0, 1, D, H - 1 - D/2, '#f6c3c3'),
             {name: 'купол', type: 'sphere', x: 0, y: 0, z: H - D, w: D, d: D, h: D, color: '#f6c3c3'},
             box('ножка +', 1.27, 0, -10, .5, .5, 10, METAL), box('ножка −', -1.27, 0, -9, .5, .5, 9, METAL)],
    keepout: [cyl('не занимать', 0, 0, -10, fl + .5, H + 10.5)],
    cutouts: [holeUp('отверстие', 0, 0, H - 3, D + .2, 10)]})),
  {id: 'ws2812b', name: 'Светодиод WS2812B', label: 'WS2812B', icon: 'led', note: '5 × 5 × 1.6',
   bodies: [box('корпус', 0, 0, 0, 5, 5, 1.6, WHITE), cyl('окно', 0, 0, 1.6, 3.6, .05, '#f7f2d6')],
   keepout: [box('не занимать', 0, 0, 0, 5.6, 5.6, 2)], cutouts: []},
  {id: 'ws2812-ring-12', name: 'Кольцо WS2812 × 12', label: 'Кольцо WS2812', icon: 'led', note: 'Ø37 / Ø23 × 1.6',
   bodies: [...ring('плата', 24, 18.5, 11.5, 1.6, BLACK_PCB),
            ...Array.from({length: 12}, (_, i) => { const a = i / 12 * 2 * Math.PI;
              return box(`светодиод ${i + 1}`, 15 * Math.cos(a), 15 * Math.sin(a), 1.6, 5, 5, 1.6, WHITE, {rot: +(-a * 180 / Math.PI).toFixed(2)}); })],
   keepout: [cyl('не занимать', 0, 0, 0, 38, 3.7)], cutouts: []},
  {id: 'oled-096', name: 'OLED 0.96″', label: 'Экран OLED', icon: 'display', note: '27 × 27, окно 22 × 11',
   bodies: [pcb('плата', 0, 0, 0, 27, 27, 1.6, BLUE),
            box('стекло', 0, -.8, 1.6, 26.7, 19.3, 1.2, '#15171a'), box('экран', 0, -.2, 2.8, 22, 11, .05, '#0a2a4a'),
            ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sy], i) => via(`отверстие ${i + 1}`, sx * 11.5, sy * 11.5, 0, 2)),
            ...header('гребёнка', 0, 12, 4)],
   keepout: [box('не занимать', 0, 0, -8.5, 28, 28, 12)],
   cutouts: [box('окно экрана', 0, -.2, 3, 22, 11, 12)]},
];

// Вставка: деталь из тел модуля (справочные), зоны «не занимать» и вырезов (режут корпус).
// turn — поворот всей детали вокруг вертикали, градусы; at — куда на стол.
export function instantiate(c, {x = 0, y = 0, z = 0, turn = 0} = {}, nextId = 1, grp = 'c' + nextId){
  const a = turn * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const place = (o, extra) => ({rot: 0, rx: 0, rz: 0, sides: 6, dia: 10, pitch: 1.5, shell: 0, openTop: false, vis: true,
    hole: false, ...o, ...extra, id: nextId++, grp,
    x: +(x + o.x * ca - o.y * sa).toFixed(3), y: +(y + o.x * sa + o.y * ca).toFixed(3), z: +(z + o.z).toFixed(3),
    rot: (((o.rot || 0) - turn) % 360 + 360) % 360});
  const objects = [...c.bodies.map(o => place(o, {ref: true})),
                   ...c.keepout.map(o => place(o, {ref: true, keepout: true, color: '#f0b429'})),
                   ...c.cutouts.map(o => place(o, {hole: true, cutsAll: true, color: '#d0455f'}))];
  return {objects, part: {name: c.name, label: c.label}, grp, nextId};
}
