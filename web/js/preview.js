// Превью изделия: роли деталей (кнопка, свет) и сценарии — именованные состояния светов.
// Только вид: в STL, CSG и слайс не попадает. Роли живут там же, где поля разбора: у детали
// в parts[grp], у одиночного тела в нём самом.

export const LIGHT_MODES = ['off', 'steady', 'pulse', 'blink', 'breathe'];
export const ROLES = ['', 'button', 'light'];

// яркость света 0..1 в момент t (секунды)
export function lightLevel(mode, t){
  switch(mode){
    case 'steady': return 1;
    case 'pulse': return .55 + .45 * Math.sin(t * 2 * Math.PI * 1.6);
    case 'blink': return (t % 1) < .5 ? 1 : 0;
    case 'breathe': return .1 + .9 * (.5 - .5 * Math.cos(t * 2 * Math.PI / 3.2));
    default: return 0;
  }
}

// режим и цвет каждого света: базовый из свойств → сценарий → удерживаемые кнопки (важнее всего)
// lights: {key: {mode, color}}, buttons: {key: {links: [key], linkMode}}, held: Set(key)
export function resolveLights(lights, scenario, buttons, held){
  const out = {};
  for(const [k, l] of Object.entries(lights)) out[k] = {mode: l.mode || 'off', color: l.color || '#46d9ff'};
  for(const [k, s] of Object.entries(scenario?.lights || {})) if(out[k]) out[k] = {...out[k], ...s};
  for(const k of held || []){
    const b = buttons[k]; if(!b) continue;
    for(const t of b.links || []) if(out[t]) out[t] = {...out[t], mode: b.linkMode || 'pulse'};
  }
  return out;
}

// приводит поля роли к допустимым — проект может прийти из чужого файла
export function normRole(m){
  const r = {};
  if(!ROLES.includes(m.role) || !m.role) return r;
  r.role = m.role;
  if(m.role === 'button'){
    r.travel = Math.min(5, Math.max(.2, +m.travel || 1.5));
    r.links = Array.isArray(m.links) ? m.links.filter(x => typeof x === 'string') : [];
    r.linkMode = LIGHT_MODES.includes(m.linkMode) ? m.linkMode : 'pulse';
  }else{
    r.lColor = /^#[0-9a-f]{6}$/i.test(m.lColor) ? m.lColor : '#46d9ff';
    r.lMode = LIGHT_MODES.includes(m.lMode) ? m.lMode : 'steady';
    r.lPower = Math.min(4, Math.max(0, +m.lPower || 1.5));
    r.halo = m.halo !== false;
  }
  return r;
}

export function normScenarios(list){
  if(!Array.isArray(list)) return [];
  return list.filter(s => s && typeof s.name === 'string' && s.name.trim()).map(s => ({
    name: s.name.trim(),
    lights: Object.fromEntries(Object.entries(s.lights || {}).filter(([, v]) => v && LIGHT_MODES.includes(v.mode))
      .map(([k, v]) => [k, {mode: v.mode, ...(/^#[0-9a-f]{6}$/i.test(v.color) ? {color: v.color} : {})}])),
  }));
}
