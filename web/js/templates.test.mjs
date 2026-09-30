// Шаблоны: каждый с умолчаниями и на краях диапазонов полей обязан собираться без NaN,
// а сцены уходят в check_scene на стороне Python. Запуск: make check-templates
import assert from 'assert';
import { writeFileSync } from 'fs';
import { TEMPLATES, defaults, clampValues } from './templates.js';

const scenes = [];
for(const tpl of TEMPLATES){
  const variants = [defaults(tpl),
    Object.fromEntries(tpl.fields.map(f => [f.k, f.type ? f.def : f.min])),
    Object.fromEntries(tpl.fields.map(f => [f.k, f.type === 'check' ? !f.def : f.type ? f.def : f.max]))];
  // каждый телефон — отдельной сборкой: у них разные вырезы
  const phones = tpl.fields.find(f => f.k === 'phone');
  if(phones) for(const [k] of phones.options.slice(1)) variants.push({...defaults(tpl), phone: k});
  for(const raw of variants){
    const v = clampValues(tpl, raw), objs = tpl.build(v);
    assert.ok(objs.length > 0, tpl.id);
    for(const o of objs)
      for(const k of ['x', 'y', 'z', 'w', 'd', 'h'])
        assert.ok(Number.isFinite(o[k]), `${tpl.id}: ${o.name}.${k} = ${o[k]}`);
    scenes.push({id: tpl.id, v, objects: objs});
  }
}
assert.deepStrictEqual(clampValues(TEMPLATES[1], {w: 9999, wall: 'x'}).w, 250);
assert.strictEqual(clampValues(TEMPLATES[1], {wall: 'x'}).wall, 2.4, 'мусор в поле — умолчание');
writeFileSync(process.argv[2] || '/dev/null', JSON.stringify(scenes));
// пример в examples/ — тот же шаблон на умолчаниях, а не отдельная копия размеров
if(process.argv[3]){
  const tpl = TEMPLATES.find(t => t.id === 'phone-case');
  const objects = tpl.build(defaults(tpl)).map((o, i) => ({...o, id: i + 1}));
  writeFileSync(process.argv[3], JSON.stringify({objects, nextId: objects.length + 1}, null, 1));
}
console.log(`templates: ${scenes.length} сборок`);
