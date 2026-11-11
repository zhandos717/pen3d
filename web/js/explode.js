// Вид в разборе: детали расходятся слоями, только на экране — o.x/y/z не меняются,
// печать, STL и CSG берут собранное положение. Единица — деталь (группа) или тело.
// Слой — единицы с одной высотой центра (или одним явным порядком). Слои ставятся
// стопкой: нижний на месте, каждый следующий — над верхом предыдущего с зазором.

const SAME_Z = 0.5;

// units: [{key, min, max (высота низа/верха), order?, dir?: 'up'|'down'|'side', dist?}]
// → {key: {off, dir, layer}} — смещение при полном разборе, мм
export function explodePlan(units, gap = 8){
  const keyOf = u => Number.isFinite(u.order) ? u.order : (u.min + u.max) / 2;
  const sorted = [...units].sort((a, b) => keyOf(a) - keyOf(b));
  const layers = [];
  for(const u of sorted){
    const last = layers[layers.length - 1];
    const k = keyOf(u);
    const same = last && (Number.isFinite(u.order) ? last.k === k : !last.explicit && Math.abs(last.k - k) <= SAME_Z);
    if(same){ last.units.push(u); last.min = Math.min(last.min, u.min); last.max = Math.max(last.max, u.max); }
    else layers.push({k, explicit: Number.isFinite(u.order), units: [u], min: u.min, max: u.max});
  }
  const plan = {};
  let top = -Infinity;
  layers.forEach((L, i) => {
    const bottom = i === 0 ? L.min : top + gap;
    const off = bottom - L.min;
    top = bottom + (L.max - L.min);
    for(const u of L.units){
      const dir = u.dir || 'up';
      const auto = dir === 'down' ? -off : off;
      plan[u.key] = {off: Number.isFinite(u.dist) ? (dir === 'down' ? -u.dist : u.dist) : auto, dir, layer: i};
    }
  });
  return plan;
}

// плавный старт и остановка: разлёт не дёргается в начале и в конце
export const ease = t => t < .5 ? 4*t*t*t : 1 - Math.pow(-2*t + 2, 3) / 2;
