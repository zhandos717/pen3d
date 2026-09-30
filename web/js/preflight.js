// Проверка перед печатью: по реальным габаритам тел (с поворотом и зазором посадки) и по
// треугольникам собранной детали. check_scene на сервере считает габарит без поворота —
// для вырезов по клику он врёт, поэтому здесь своя проверка по тому, что уйдёт в слайсер.
// Высота — ось y (как в сцене), план — x/z.

const OVERHANG = -Math.cos(Math.PI/4);    // грань смотрит вниз круче 45° от вертикали
const CEILING = -0.97;                    // почти горизонтальный потолок — это мост, а не свес
const LINE = 0.4;                         // ширина линии сопла 0.4

const overlap = (a, b, tol = 0) =>
  ['x', 'y', 'z'].every(k => a.min[k] < b.max[k] + tol && b.min[k] < a.max[k] + tol);

// bodies: [{name, hole, keep, min:{x,y,z}, max:{x,y,z}}]; pos/index — геометрия собранной детали
export function preflight({bodies, pos, index, bed = 256, supports = false}){
  const items = [], add = (level, text, fix) => items.push({level, text, fix});
  const solids = bodies.filter(b => !b.hole && !b.keep), holes = bodies.filter(b => b.hole);
  if(!solids.length){ add('err', 'на столе нет ни одного тела'); return {items, overhangTris: []}; }

  const all = {min: {}, max: {}};
  for(const k of ['x', 'y', 'z']){
    all.min[k] = Math.min(...solids.map(b => b.min[k])); all.max[k] = Math.max(...solids.map(b => b.max[k]));
  }
  const size = k => all.max[k] - all.min[k];
  if(size('x') > bed || size('z') > bed || size('y') > bed)
    add('err', `деталь ${size('x').toFixed(0)}×${size('z').toFixed(0)}×${size('y').toFixed(0)} мм не влезает на стол ${bed} мм`,
        'уменьши или разрежь на части');
  if(all.min.y > 0.05) add('err', `деталь висит над столом на ${all.min.y.toFixed(1)} мм`, 'нажми «На стол»');

  // связность: тела, которые не касаются друг друга, печатаются отдельными деталями
  const groups = [];
  for(const s of solids){
    const touching = groups.filter(g => g.some(t => overlap(s, t, 0.2)));
    const merged = [s, ...touching.flat()];
    for(const g of touching) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  for(const g of groups){
    const low = Math.min(...g.map(b => b.min.y));
    if(low > 0.2) add('err', `${g.map(b => b.name).join(', ')} — висит в воздухе на ${low.toFixed(1)} мм`,
                      'опусти на стол или соедини с деталью');
  }
  if(groups.length > 1)
    add('warn', `на столе ${groups.length} отдельные детали — напечатаются раздельно`, 'если это одна деталь — сдвинь тела, чтобы касались');

  for(const s of solids){
    const t = Math.min(s.max.x - s.min.x, s.max.y - s.min.y, s.max.z - s.min.z);
    if(t < 2*LINE) add('err', `${s.name}: ${t.toFixed(2)} мм — тоньше двух линий сопла, не напечатается`, 'сделай не тоньше 0.8 мм');
    else if(t < 3*LINE) add('warn', `${s.name}: ${t.toFixed(2)} мм — хрупко`, 'для прочности от 1.2 мм');
  }

  for(const h of holes){
    const hits = solids.filter(s => overlap(h, s));
    if(!hits.length){ add('warn', `${h.name} не задевает деталь — вырез ничего не делает`); continue; }
    if(hits.some(s => Math.abs(h.min.y - s.min.y) < 0.01 && s.min.y < 0.05))
      add('warn', `${h.name} стоит вровень с дном — на столе останется плёнка`, 'опусти вырез на 0.5–1 мм ниже стола');
  }

  const foot = Math.min(size('x'), size('z'));
  if(size('y') > 40 && size('y') > 4*foot)
    add('warn', `высокая узкая деталь (${size('y').toFixed(0)} мм при основании ${foot.toFixed(0)}) — может раскачаться`,
        'положи на бок или включи кайму (brim) в слайсере');

  // нависания по треугольникам: вниз круче 45° и не на столе
  const overhangTris = [];
  let hang = 0, ceil = 0;
  if(pos){
    const n = index ? index.length/3 : pos.length/9, at = (t, c) => index ? index[t*3 + c] : t*3 + c;
    for(let t = 0; t < n; t++){
      const a = at(t, 0)*3, b = at(t, 1)*3, c = at(t, 2)*3;
      const ux = pos[b] - pos[a], uy = pos[b+1] - pos[a+1], uz = pos[b+2] - pos[a+2];
      const vx = pos[c] - pos[a], vy = pos[c+1] - pos[a+1], vz = pos[c+2] - pos[a+2];
      const nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx, len = Math.hypot(nx, ny, nz);
      if(!len || ny/len > OVERHANG) continue;
      if(Math.min(pos[a+1], pos[b+1], pos[c+1]) - all.min.y < 0.3) continue;   // лежит на столе
      const area = len/2;
      if(ny/len < CEILING) ceil += area; else hang += area;
      overhangTris.push(t);
    }
  }
  if(hang > 5) add(supports ? 'ok' : 'warn', `нависания круче 45°: ${hang.toFixed(0)} мм² (подсвечены)`,
                   supports ? 'поддержки включены' : 'включи «поддержки» или поверни деталь');
  if(ceil > 5) add('ok', `потолки над пустотой: ${ceil.toFixed(0)} мм² — мосты`, 'до ~15 мм пролёта A1 тянет без поддержек');

  if(!items.some(i => i.level !== 'ok')) add('ok', 'проблем не найдено');
  return {items, overhangTris};
}
