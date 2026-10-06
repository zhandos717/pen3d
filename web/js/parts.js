// Детали и коннекторы. Деталь — именованная группа тел (o.grp), её имя живёт в
// parts[grp]. Коннектор — точка с направлением на грани тела, как mate connector в
// Onshape: хранится в единичных координатах тела, поэтому едет вместе с ним при сдвиге,
// повороте и изменении размера. Сопряжение потом совмещает два коннектора.

// строки списка объектов: деталь заголовком, её тела под ним; одиночные тела как были.
// Порядок — новые сверху, деталь встаёт туда, где её самое новое тело
export function listRows(objects, parts){
  const rows = [], seen = new Set();
  for(const o of [...objects].reverse()){
    if(!o.grp){ rows.push({kind: 'body', o}); continue; }
    if(seen.has(o.grp)) continue;
    seen.add(o.grp);
    const members = [...objects].reverse().filter(x => x.grp === o.grp);
    rows.push({kind: 'part', grp: o.grp, name: parts[o.grp]?.name || 'Деталь', count: members.length});
    members.forEach(m => rows.push({kind: 'body', o: m, inPart: true}));
  }
  return rows;
}

export const partName = (o, parts) => (o?.grp && parts[o.grp]?.name) || o?.name || 'деталь';

// следующее свободное имя «Деталь N» / «К N»: номера не переиспользуем после удаления,
// иначе в журнале и сопряжениях два разных объекта назывались бы одинаково
export function nextName(prefix, names){
  let n = 1;
  for(const s of names){ const m = String(s).match(new RegExp(`^${prefix} (\\d+)$`)); if(m) n = Math.max(n, +m[1] + 1); }
  return `${prefix} ${n}`;
}

// коннекторы, чьё тело удалено, теряют смысл — выкидываем при каждой синхронизации
export const liveConnectors = (connectors, objects) => connectors.filter(c => objects.some(o => o.id === c.body));
