// Раскладка деталей на стол полками: самые высокие (по глубине) первыми, слева направо,
// новая полка — когда ряд кончился. Детали не поворачиваем: как смоделирована, так и печатается.
// Координаты — от центра стола, как в сцене. null — не влезло.
export function packShelves(items, bed = 256, gap = 6, margin = 5){
  const order = items.map((it, i) => ({...it, i})).sort((a, b) => b.d - a.d || b.w - a.w);
  const span = bed - 2 * margin, out = new Array(items.length);
  let x = 0, y = 0, row = 0;
  for(const it of order){
    if(it.w > span || it.d > span) return null;
    if(x > 0 && x + it.w > span){ y += row + gap; x = 0; row = 0; }
    if(y + it.d > span) return null;
    out[it.i] = {x: -bed/2 + margin + x + it.w/2, y: -bed/2 + margin + y + it.d/2};
    x += it.w + gap; row = Math.max(row, it.d);
  }
  return out;
}
