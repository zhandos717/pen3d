// Параметры проекта: именованные значения (wall = 2, bolt = 3.2) и формулы в полях тел.
// Формула запоминается в o.f[поле], только если ссылается на параметр — тогда смена
// параметра перестраивает все зависимые тела. Ссылки на собственные поля тела (w/2)
// считаются один раз, как раньше, и формулой не становятся.

const ID = /[A-Za-z_][A-Za-z0-9_]*/g;
export const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
// имена параметров уходят аргументами в Function: ключевое слово там — SyntaxError,
// и падали бы все формулы проекта разом
export const JS_RESERVED = new Set(('break case catch class const continue debugger default delete do else enum export ' +
  'extends false finally for function if implements import in instanceof interface let new null package private ' +
  'protected public return static super switch this throw true try typeof var void while with yield await ' +
  'eval arguments undefined NaN Infinity').split(' '));
const MATH = {PI: Math.PI, sqrt: Math.sqrt, min: Math.min, max: Math.max, round: Math.round,
              floor: Math.floor, ceil: Math.ceil, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan};

export const idents = str => String(str).match(ID) || [];

// не eval: пропускаем только цифры/операторы/скобки/запятые и известные имена
export function evalExpr(str, scope){
  str = String(str).trim();
  if(!/^[-+*/%().,\s\d]*$/.test(str.replace(ID, ''))) return NaN;
  // точка — только внутри числа: иначе sqrt.constructor(...) достаёт Function
  if(/\.(?!\d)|[A-Za-z_]\s*\./.test(str)) return NaN;
  const all = {...MATH};
  for(const [k, v] of Object.entries(scope || {})) if(typeof v === 'number') all[k] = v;
  const names = Object.keys(all).filter(n => NAME_RE.test(n));
  for(const w of idents(str)) if(!Object.hasOwn(all, w)) return NaN;
  try{
    const v = Function(...names, `"use strict"; return (${str || '0'})`)(...names.map(n => all[n]));
    return typeof v === 'number' ? v : NaN;
  }catch(e){ return NaN; }
}

// параметры считаются по порядку: каждый видит только тех, кто выше — циклов не бывает
export function paramValues(params){
  const vals = {}, errors = {};
  for(const p of params || []){
    const v = evalExpr(p.expr, vals);
    if(Number.isFinite(v)) vals[p.name] = v; else errors[p.name] = true;
  }
  return {vals, errors};
}

export const refsParam = (str, params) => idents(str).some(w => (params || []).some(p => p.name === w));

// Формула видит только параметры, не поля своего тела: «w + wall» от текущего w
// росла бы на wall при каждом пересчёте. set — как записать значение (клампы, группа,
// петля); стенку пишем последней, её предел зависит от уже обновлённых размеров.
export function applyParams(objects, params, set = (o, k, v) => { o[k] = v; }){
  const {vals} = paramValues(params), bad = [];
  for(const o of objects){
    const keys = Object.keys(o.f || {}).sort((a, b) => (a === 'shell') - (b === 'shell'));
    for(const k of keys){
      const v = evalExpr(o.f[k], vals);
      if(Number.isFinite(v)) set(o, k, +v.toFixed(3));
      else bad.push(`${o.name}.${k}`);
    }
  }
  return bad;
}

// кто использует параметр — чтобы не дать удалить или переименовать его молча
export const usersOf = (objects, name) =>
  objects.filter(o => Object.values(o.f || {}).some(e => idents(e).includes(name)));
