// Заполнение панели свойств и показ/скрытие строк под тип фигуры — раньше жило прямо
// в app.js как fillProps(), дёргалась вручную после каждой мутации сцены. Сама валидация
// полей (P.forEach в app.js: выражения, клампы, привязка к группе) осталась там как была —
// она завязана на push()/sync()/say() и трогать её тут не с руки. Solid отвечает только
// за «отрисовать текущее состояние объекта в форму», реагируя на сигнал.
import { createRoot, createSignal, createEffect } from 'solid-js';

// держать в паре с P в app.js — набор полей панели свойств
const P = ['name', 'hole', 'keep', 'vis', 'color', 'w', 'd', 'h', 'x', 'y', 'z',
           'rot', 'rx', 'rz', 'sides', 'dia', 'pitch', 'shell', 'openTop'];

const $ = id => document.getElementById(id);

createRoot(() => {
  const [obj, setObj] = createSignal(null);

  createEffect(() => {
    const o = obj();
    $('props').hidden = !o;
    $('noprops').hidden = !!o;
    if(!o) return;

    for(const k of P){
      const el = $('p-' + k);
      if(!el) continue;
      if(k === 'keep') el.checked = o.mode === 'keep';
      else if(el.type === 'checkbox') el.checked = o[k];
      else if(document.activeElement !== el) el.value = o[k];   // не сбивать то, что человек сейчас печатает
    }

    $('p-sides-row').style.display = o.type === 'poly' ? '' : 'none';
    const th = o.type === 'thread';
    const hollow = ['box', 'cyl', 'poly'].includes(o.type) && !o.hole;
    $('p-shell-row').style.display = hollow ? '' : 'none';
    $('p-open-row').style.display = hollow && o.shell > 0 ? '' : 'none';
    $('p-dia-row').style.display = $('p-pitch-row').style.display = th ? '' : 'none';
    $('p-w').disabled = $('p-d').disabled = th;
    $('p-round-row').style.display = o.type === 'box' || (o.type === 'sketch' && 'round' in o) ? '' : 'none';
    if(document.activeElement !== $('p-round')) $('p-round').value = o.round || 0;
  });

  // новый объект-снимок на каждый вызов: сигналы Solid сравнивают по ссылке,
  // а sel() отдаёт ту же самую (просто мутированную) запись — без {...o} эффект
  // не перезапустился бы после правки поля
  window.__propsPanel = { update: o => setObj(o ? {...o} : null) };
});
