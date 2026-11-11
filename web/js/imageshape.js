// Рельеф из картинки: SVG или PNG растеризуется на canvas, тёмные непрозрачные пиксели
// обводятся той же функцией, что буквы. Растеризация асинхронная (картинке надо
// загрузиться), поэтому контуры кэшируются, а готовность сообщается колбэком.
import { maskToShapes } from './textshape.js';

const SIDE = 512;                          // длинная сторона растра: ~0.1 мм на пиксель у логотипа 50 мм
const cache = new Map(), pending = new Map();
export let onImageReady = () => {};
export const setImageReady = f => { onImageReady = f; };

// короткий ключ исходника: сам исходник может весить сотни килобайт, в sig его не тащим
export function srcKey(src){
  let h = 5381;
  for(let i = 0; i < src.length; i++) h = (h * 33 ^ src.charCodeAt(i)) >>> 0;
  return h.toString(36) + ':' + src.length;
}

function load(src){
  return new Promise((ok, fail) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => fail(new Error('картинка не читается')); im.src = src; });
}

// пиксель — материал, если после наложения на белое он темнее порога
export async function rasterize(src, thr = 180){
  const im = await load(src);
  const k = SIDE / Math.max(im.naturalWidth || im.width || SIDE, im.naturalHeight || im.height || SIDE);
  const w = Math.max(1, Math.round((im.naturalWidth || SIDE) * k)), h = Math.max(1, Math.round((im.naturalHeight || SIDE) * k));
  const pad = 2, c = document.createElement('canvas');
  c.width = w + 2*pad; c.height = h + 2*pad;
  const g = c.getContext('2d', {willReadFrequently: true});
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(im, pad, pad, w, h);
  const px = g.getImageData(0, 0, c.width, c.height).data, mask = new Uint8Array(c.width * c.height);
  for(let i = 0; i < mask.length; i++) mask[i] = .299*px[i*4] + .587*px[i*4 + 1] + .114*px[i*4 + 2] < thr ? 1 : 0;
  return {mask, w: c.width, h: c.height};
}

// синхронно отдаёт готовые контуры или null; во втором случае запускает растеризацию
export function imageShapes(src, thr = 180, eps = .8){
  const k = `${srcKey(src)}|${thr}|${eps}`;
  if(cache.has(k)) return cache.get(k);
  if(!pending.has(k)){
    pending.set(k, rasterize(src, thr).then(r => { cache.set(k, maskToShapes(r.mask, r.w, r.h, eps)); })
      .catch(() => cache.set(k, null)).finally(() => { pending.delete(k); onImageReady(); }));
  }
  return null;
}
export const imageReady = (src, thr, eps) => cache.has(`${srcKey(src)}|${thr}|${eps}`);

// исходник для хранения в проекте: SVG — как есть (векторный, мал), PNG/JPG — уменьшенный PNG
export async function importImage(file){
  if(/\.svg$/i.test(file.name) || file.type === 'image/svg+xml'){
    const text = await file.text();
    if(text.length > 500_000) throw new Error('SVG больше 500 КБ — упрости рисунок');
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  }
  const url = URL.createObjectURL(file);
  try{
    const im = await load(url), k = Math.min(1, SIDE / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }finally{ URL.revokeObjectURL(url); }
}
