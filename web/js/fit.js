// Посадки: отверстие на печати выходит уже модели — слой расплющивается, пластик
// усаживается. Размер отверстия человек пишет номинальный (вал 8 → отверстие 8),
// а зазор добавляется при построении по типу посадки и калибровке своего принтера.
// Калибровка — диаметральный зазор, при котором штырь входит рукой с лёгким трением;
// её дают тестовая пластинка и выбор отверстия, в которое штырь сел «как надо».

export const DEFAULT_CAL = 0.2;
export const FITS = {
  press: {name: 'натяг',     hint: 'вбивается, держит без клея',        dx: -0.1},
  snug:  {name: 'плотная',   hint: 'входит рукой, не болтается',        dx: 0},
  slide: {name: 'скользящая',hint: 'ходит свободно: ось, поршень',      dx: 0.1},
  loose: {name: 'свободная', hint: 'с люфтом: петля, крышка, винт',     dx: 0.3},
};
export const COUPON_GAPS = [0, 0.1, 0.2, 0.3, 0.4, 0.5];

export function gapFor(o, cal = DEFAULT_CAL){
  const f = o.hole && FITS[o.fit];
  return f ? Math.max(0, +(cal + f.dx).toFixed(3)) : 0;
}

// тестовая пластинка: ряд отверстий 8 мм с растущим зазором и штырь 8 мм.
// Номера на пластике не напечатать, поэтому отсчёт от метки-треугольника: первое
// отверстие рядом с ней — нулевой зазор. Размеры отверстий уже с зазором и без fit,
// иначе калибровка посчиталась бы дважды.
export function couponObjects(at = {x: 0, y: 0}){
  const D = 8, step = 13, n = COUPON_GAPS.length, W = step * n + 6;
  const x0 = at.x - W/2 + 3 + step/2;
  const base = {rot: 0, rx: 0, rz: 0, sides: 3, dia: 10, pitch: 1.5, shell: 0, openTop: false, vis: true};
  const list = [{...base, name: 'Тест посадки', type: 'box', x: at.x, y: at.y, z: 0, w: W, d: 18, h: 5,
                 hole: false, color: '#c3c8cf'}];
  COUPON_GAPS.forEach((g, i) => list.push({...base, name: `зазор ${g.toFixed(1)}`, type: 'cyl',
    x: +(x0 + i*step).toFixed(2), y: at.y, z: -1, w: +(D + g).toFixed(2), d: +(D + g).toFixed(2), h: 7,
    hole: true, color: '#c3c8cf'}));
  list.push({...base, name: 'метка ▲', type: 'poly', sides: 3, x: +(x0 - step/2 + 1.5).toFixed(2), y: at.y + 6,
             z: 3.6, w: 3, d: 3, h: 2, hole: true, color: '#c3c8cf'});
  list.push({...base, name: 'Штырь 8', type: 'cyl', x: at.x, y: at.y + 20, z: 0, w: D, d: D, h: 12,
             hole: false, color: '#e0a73f'});
  return list;
}
