// Перевод обязан быть идемпотентным: наблюдатель за DOM переводит каждое изменение
// текста, и если t(t(x)) !== t(x), строка меняется на каждом проходе бесконечно —
// вкладка умирает вместе с консолью. Запуск: make check-i18n
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

const here = fileURLToPath(new URL('.', import.meta.url));
const src = readFileSync(here + 'i18n.js', 'utf8');
globalThis.document = {readyState: 'complete', addEventListener(){}, body: {}};
globalThis.window = {};
globalThis.MutationObserver = class { observe(){} };

let failed = 0;
for(const lang of ['en', 'kk']){
  globalThis.localStorage = {lang};
  const m = await import(`./i18n.js?${lang}`);
  const blk = src.slice(src.indexOf(`const ${lang.toUpperCase()} = {`));
  const vals = [...blk.slice(0, blk.indexOf('\n};')).matchAll(/:\s*'((?:[^'\\]|\\.)*)'/g)].map(x => x[1]);
  const samples = ['в детали 5.5 мм', 'снаружи 1.5 мм', '10.0 мм', '↑ 0.5 мм', ' мм', 'агент ',
                   'МОЙ СТОЛ · текстурированная PEI / HDT · в печать', 'добавлен: Короб 1', 'Цилиндр 7'];
  const bad = [];
  for(const s of [...vals, ...samples]){
    const once = m.t(s), twice = m.t(once);
    if(twice !== once) bad.push(`${JSON.stringify(s)} → ${JSON.stringify(once)} → ${JSON.stringify(twice)}`);
  }
  console.log(`${lang}: строк ${vals.length + samples.length}, не идемпотентных ${bad.length}`);
  bad.slice(0, 10).forEach(b => console.log('   ', b));
  failed += bad.length;
}
process.exit(failed ? 1 : 0);
