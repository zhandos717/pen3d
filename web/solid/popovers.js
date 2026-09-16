// Открытие/закрытие/позиционирование трёх попапов шапки (Сохранить, Принтер, Проект) —
// раньше это был кусок ручного кода в app.js (форк один и тот же паттерн на каждый попап,
// вручную выставляли hidden/left/top/maxHeight). Сама разметка попапов остаётся в index.html
// как была — этот модуль только управляет их видимостью и позицией через сигнал.
import { createRoot, createSignal, createEffect } from 'solid-js';

const POPOVERS = [
  ['save-top', 'save-menu'],
  ['printer-top', 'printer-menu'],
  ['project-btn', 'project-menu'],
];

function position(menu, btn){
  if(!menu.classList.contains('fixed')) return;   // остальные позиционируются чистым CSS (right:0 от кнопки)
  const r = btn.getBoundingClientRect(), margin = 10;
  const below = window.innerHeight - r.bottom - margin, above = r.top - margin;
  const up = below < 160 && above > below;
  menu.style.left = r.left + 'px';
  menu.style.maxHeight = Math.max(120, up ? above : below) + 'px';
  if(up){ menu.style.top = ''; menu.style.bottom = (window.innerHeight - r.top + 6) + 'px'; }
  else { menu.style.bottom = ''; menu.style.top = (r.bottom + 6) + 'px'; }
}

createRoot(() => {
  const [open, setOpen] = createSignal(null);   // id открытого меню или null

  createEffect(() => {
    const name = open();
    for(const [btnId, menuId] of POPOVERS){
      const menu = document.getElementById(menuId);
      if(!menu) continue;
      const isOpen = name === menuId;
      menu.hidden = !isOpen;
      if(isOpen) position(menu, document.getElementById(btnId));
    }
  });

  for(const [btnId, menuId] of POPOVERS){
    const btn = document.getElementById(btnId), menu = document.getElementById(menuId);
    if(!btn || !menu) continue;
    btn.addEventListener('click', e => { e.stopPropagation(); setOpen(cur => cur === menuId ? null : menuId); });
    menu.addEventListener('click', e => e.stopPropagation());   // клик внутри попапа не должен его закрывать
  }

  document.addEventListener('click', () => setOpen(null));
  document.addEventListener('keydown', e => { if(e.key === 'Escape') setOpen(null); });

  window.__popovers = { close: () => setOpen(null) };   // save-as-json/stl закрывают меню после действия
});
