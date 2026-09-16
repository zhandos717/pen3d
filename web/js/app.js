import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { unitGeo } from './geometry.js';
import { parseStl } from './stl-import.js';
import { buildResult, holeGhost } from './csg.js';
import { meshToStlAsync } from './stl.js';
import { PROMPT, PROVIDERS, sanitize } from './ai.js';
import { gearSketch, roundedRect } from './gear.js';
import { t } from './i18n.js';

const BED = 256;
const PLATE_GAP = 320;                 // сдвиг стола агента по X
const $ = id => document.getElementById(id);
const say = (t, k='') => { const s = $('status'); s.textContent = t; s.className = k; };

// ---------- данные ----------
// объект: {id,name,type:'box'|'cyl'|'poly'|'sketch',x,y,z,w,d,h,rot,sides,hole,vis,pts?}
let objects = [], nextId = 1, selId = null;
const byId = id => objects.find(o => o.id === id);
const sel = () => byId(selId);

// ---------- сцена ----------
const view = $('view');
const renderer = new THREE.WebGLRenderer({canvas:view, antialias:true});
renderer.setPixelRatio(devicePixelRatio || 1);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x111318);
const cam = new THREE.PerspectiveCamera(45, 1, 1, 5000);
cam.position.set(220, 200, 260);
scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2f3a, 2.0));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.4); keyLight.position.set(1,2,1); scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(0xffffff, .5); fillLight.position.set(-1,1,-1); scene.add(fillLight);

function makePlate(offset, tint){
  const g = new THREE.Group(); g.position.x = offset;
  const b = new THREE.Mesh(new THREE.PlaneGeometry(BED, BED),
    new THREE.MeshStandardMaterial({color:tint, roughness:1}));
  b.rotation.x = -Math.PI/2; b.position.y = -0.05; g.add(b);
  const grid = new THREE.GridHelper(BED, BED/10, 0x3a4150, 0x262b35); g.add(grid);
  const g5 = new THREE.GridHelper(BED, BED/50, 0x4a5262, 0x4a5262); g5.position.y = .02; g.add(g5);
  // деления по 1мм — включаются только при сильном приближении, иначе на весь стол это муар
  const g1 = new THREE.GridHelper(BED, BED, 0x565f70, 0x565f70); g1.position.y = .03; g1.visible = false; g.add(g1);
  const h = BED/2, y = .06;
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
    [[-h,y,-h],[h,y,-h],[h,y,h],[-h,y,h]].map(q => new THREE.Vector3(...q))),
    new THREE.LineBasicMaterial({color:0x3fae8c}));
  g.add(edge);
  scene.add(g);
  return {group:g, plate:b, grid, g5, g1, edge, tint};
}
const plates = [makePlate(0, 0x1c2028), makePlate(PLATE_GAP, 0x1a2431)];

let agentBusy = false, pulse = 0;
function stepPulse(){
  if(!agentBusy) return;
  pulse += .06;
  const k = .5 + .5*Math.sin(pulse);
  const e = plates[1].edge;
  e.visible = true;
  e.material.color.setRGB(.18 + .36*k, .55 + .3*k, 1);
  plates[1].plate.material.color.setRGB(.1 + .05*k, .14 + .06*k, .21 + .08*k);
}

// видно, какой стол уедет в печать
// Цвет плиты — по температуре: холодная синеватая, горячая уходит в тёплый.
// Пока принтер молчит, берём температуру из типа пластины и заряженного материала.
const PLATE_TEMP = {'Cool Plate': 35, 'Textured PEI Plate': 65, 'Engineering Plate': 80, 'High Temp Plate': 100};
let bedNow = null;                             // фактическая температура стола, если принтер отвечает

function bedColor(temp, active){
  const k = Math.max(0, Math.min(1, ((temp ?? 25) - 25) / 75));   // 25° → 0, 100° → 1
  const cold = new THREE.Color(0x1a222e), hot = new THREE.Color(0x33231e);
  const c = cold.clone().lerp(hot, k);
  return active ? c.multiplyScalar(1.15) : c.multiplyScalar(.7);
}

function plateTemp(){
  return bedNow ?? PLATE_TEMP[$('bed')?.value] ?? 60;
}

// второй стол — только пока агент что-то на нём держит, не загромождает выбор пластины без надобности
function updatePlateOption(){
  const has = agentBusy || objects.some(o => o.plate);
  $('plate-agent-opt').hidden = !has;
  if(!has && printPlate() === 1) $('plate-print').value = '0';
}

function markPlates(){
  const active = printPlate();
  const temp = plateTemp();
  plates.forEach((p, i) => {
    const on = i === active;
    p.edge.visible = on;
    p.plate.material.color.copy(bedColor(temp, on));
    p.grid.material.transparent = !on; p.grid.material.opacity = on ? 1 : .4;
  });
}

const orbit = new OrbitControls(cam, view);
orbit.enableDamping = true; orbit.dampingFactor = .12; orbit.maxPolarAngle = Math.PI/2 - .02;
orbit.mouseButtons = {LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN};

orbit.addEventListener('start', () => fly = null);

// камера переживает reload: сохраняем не по событию (их источников много — орбита,
// колесо, pan-бар, кнопки видов, F), а по факту изменения раз в кадр — дёшево и не
// зависит от того, каким жестом камеру подвинули
let camSaveAt = 0, camSavedPos = null, camSavedTarget = null;
function saveCam(){
  if(camSavedPos && cam.position.distanceToSquared(camSavedPos) < 1e-6 &&
     orbit.target.distanceToSquared(camSavedTarget) < 1e-6) return;   // не сдвинулась — нечего писать
  const now = performance.now();
  if(now - camSaveAt < 400) return;
  camSaveAt = now;
  camSavedPos = cam.position.clone(); camSavedTarget = orbit.target.clone();
  try{
    localStorage.cam = JSON.stringify({
      p: [cam.position.x, cam.position.y, cam.position.z],
      t: [orbit.target.x, orbit.target.y, orbit.target.z],
    });
  }catch(e){}
}
function restoreCam(){
  try{
    const c = JSON.parse(localStorage.cam || 'null'); if(!c) return;
    cam.position.set(...c.p); orbit.target.set(...c.t); cam.lookAt(orbit.target); orbit.update();
  }catch(e){}
}

// бегунок снизу — тот же сдвиг, что у ПКМ-панорамы, но для тех, у кого нет правой кнопки/удобного жеста
{
  const bar = $('pan-bar'), thumb = bar.querySelector('i');
  const right = new THREE.Vector3();
  let dragging = false, lastX = 0;
  const step = () => {
    if(!dragging) return;
    right.setFromMatrixColumn(cam.matrix, 0);         // локальный "вправо" камеры, проецируем на плоскость стола
    const d = (thumbX / 60) * (cam.position.distanceTo(orbit.target) * .02 + .3);
    const v = right.multiplyScalar(d);
    cam.position.add(v); orbit.target.add(v);
    requestAnimationFrame(step);
  };
  let thumbX = 0;
  bar.addEventListener('pointerdown', e => {
    dragging = true; lastX = e.clientX; bar.classList.add('on'); bar.setPointerCapture(e.pointerId);
    fly = null; step();
  });
  bar.addEventListener('pointermove', e => {
    if(!dragging) return;
    thumbX = Math.max(-70, Math.min(70, thumbX + (e.clientX - lastX)));
    lastX = e.clientX;
    thumb.style.transform = `translateX(calc(-50% + ${thumbX}px))`;
  });
  const stop = () => { dragging = false; thumbX = 0; thumb.style.transform = 'translateX(-50%)'; bar.classList.remove('on'); };
  bar.addEventListener('pointerup', stop);
  bar.addEventListener('pointercancel', stop);
}

const gizmo = new TransformControls(cam, view);
gizmo.setTranslationSnap(1); gizmo.setRotationSnap(THREE.MathUtils.degToRad(15)); gizmo.setScaleSnap(.05);
scene.add(gizmo.getHelper());
let dragged = false;
gizmo.addEventListener('dragging-changed', e => { orbit.enabled = !e.value && !sketching; if(e.value) dragged = true; else gizmoDone(); });
gizmo.addEventListener('objectChange', () => {
  const o = sel(); if(!o) return;
  const was = {x:o.x, y:o.y, z:o.z};
  meshToObj(o); objToMesh(o, meshOf(o.id));
  if(o.grp && gizmo.getMode() === 'translate'){
    const dx = o.x - was.x, dy = o.y - was.y, dz = o.z - was.z;
    objects.forEach(x => {
      if(x.grp !== o.grp || x === o) return;
      x.x = +(x.x + dx).toFixed(2); x.y = +(x.y + dy).toFixed(2); x.z = +(x.z + dz).toFixed(2);
      const m = meshOf(x.id); if(m) objToMesh(x, m);
    });
  }
  fillProps(); updateDims();
});

const raw = new THREE.Group(); scene.add(raw);
// тёмная обводка на каждом теле — иначе однотонные тела впритык сливаются в одно пятно
const EDGE_MAT = new THREE.LineBasicMaterial({color:0x0a0e12, transparent:true, opacity:.55});
let resultMesh = null, showResult = false;

const matCache = new Map();
function solidMat(color){
  const c = color || '#3fae8c';
  if(!matCache.has(c)) matCache.set(c, new THREE.MeshStandardMaterial({color:c, roughness:.5, metalness:.05}));
  return matCache.get(c);
}
// Погружённая часть сидит внутри непрозрачного тела, поэтому тест глубины её отбрасывал
// и на экране не было видно ничего. Рисуем поверх всего, как рентген.
const GHOST = new THREE.MeshStandardMaterial({color:0xff5a76, roughness:.4, metalness:0,
  transparent:true, opacity:.5, depthWrite:false, depthTest:false});
const GHOST_EDGE = new THREE.LineDashedMaterial({color:0xffd0d8, dashSize:2.2, gapSize:1.6,
  depthTest:false, transparent:true});
let ghost = null;

// Видно, какая часть отверстия реально сидит в детали, а какая торчит наружу
function updateGhost(){
  if(ghost){ ghost.traverse(o => o.geometry?.dispose()); scene.remove(ghost); ghost = null; }
  const o = sel();
  if(!o || !o.hole || !o.vis || showResult) return;
  // keep-тела не материал, а маска обрезки — в расчёт погружения не берём
  const solids = objects.filter(x => x.vis && !x.hole && x.mode !== 'keep' && (x.plate || 0) === (o.plate || 0));
  let res = null;
  try{ res = holeGhost(o, solids, (q, m) => objToMesh(q, m), GHOST); }
  catch(e){ return; }
  if(!res){ ghostDepth = null; return; }
  ghost = new THREE.Group();
  ghost.renderOrder = 999;                 // поверх детали, иначе его закроет её поверхность
  const body = new THREE.Mesh(res.geometry, GHOST);
  body.renderOrder = 999;
  ghost.add(body);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(res.geometry, 25), GHOST_EDGE);
  edges.computeLineDistances();
  edges.renderOrder = 1000;
  ghost.add(edges);
  scene.add(ghost);
  const sz = new THREE.Vector3(); res.box.getSize(sz);
  ghostDepth = {size: sz, center: res.box.getCenter(new THREE.Vector3()), top: res.box.max.y};
}
let ghostDepth = null;

const MAT = {
  solid: new THREE.MeshStandardMaterial({color:0x3fae8c, roughness:.5, metalness:.05}),
  hole:  new THREE.MeshStandardMaterial({color:0xd0455f, roughness:.6, transparent:true, opacity:.45}),
  result:new THREE.MeshStandardMaterial({color:0x8fd6bd, roughness:.45, metalness:.05}),
};

function objToMesh(o, m){
  m.position.set(o.x + (o.plate ? PLATE_GAP : 0), o.z + o.h/2, o.y);
  if(o.type === 'thread'){ m.scale.set(1,1,1); o.w = o.d = o.dia; }
  else m.scale.set(o.w, o.h, o.d);
  m.rotation.set(THREE.MathUtils.degToRad(o.rx || 0), THREE.MathUtils.degToRad(o.rot),
                 THREE.MathUtils.degToRad(o.rz || 0), 'YXZ');
  m.material = o.hole ? MAT.hole : solidMat(o.color);
  m.visible = o.vis && !showResult;
}
function meshToObj(o){
  const m = meshOf(o.id); if(!m) return;
  if(o.type === 'thread'){
    o.x = +(m.position.x - (o.plate ? PLATE_GAP : 0)).toFixed(2); o.y = +m.position.z.toFixed(2);
    const lowT = m.position.y - o.h/2;
    o.z = +(o.hole ? lowT : Math.max(0, lowT)).toFixed(2);
    o.rot = +(((THREE.MathUtils.radToDeg(m.rotation.y) % 360) + 360) % 360).toFixed(1);
    m.position.y = o.z + o.h/2; m.scale.set(1,1,1); return;
  }
  o.w = +Math.max(.2, Math.abs(m.scale.x)).toFixed(2);
  o.h = +Math.max(.2, Math.abs(m.scale.y)).toFixed(2);
  o.d = +Math.max(.2, Math.abs(m.scale.z)).toFixed(2);
  o.x = +(m.position.x - (o.plate ? PLATE_GAP : 0)).toFixed(2); o.y = +m.position.z.toFixed(2);
  const deg = r => +(((THREE.MathUtils.radToDeg(r) % 360) + 360) % 360).toFixed(1);
  o.rot = deg(m.rotation.y); o.rx = deg(m.rotation.x); o.rz = deg(m.rotation.z);
  const low = m.position.y - o.h/2;
  o.z = +(o.hole ? low : Math.max(0, low)).toFixed(2);
  m.position.y = o.z + o.h/2;
}
const meshOf = id => raw.children.find(m => m.userData.id === id);
const kill = m => { m.geometry?.dispose(); m.children.forEach(c => c.geometry?.dispose()); m.parent?.remove(m); };
const sig = o => o.type === 'poly' ? 'poly:' + o.sides
  : o.type === 'sketch' ? 'sketch:' + JSON.stringify(o.pts)
  : o.type === 'thread' ? `thread:${o.dia}:${o.pitch}:${o.h}`
  : o.type === 'stl' ? 'stl:' + o.id            // точки импорта неизменны — не перестраивать зря
  : o.type;

function sync(){
  updatePlateOption();
  const ids = new Set(objects.map(o => o.id));
  [...raw.children].forEach(m => { if(!ids.has(m.userData.id)) kill(m); });
  objects.forEach(o => {
    let m = meshOf(o.id);
    if(!m || m.userData.sig !== sig(o)){
      if(m) kill(m);
      let g; try{ g = unitGeo(o); }catch(e){ g = new THREE.BoxGeometry(1,1,1); say('контур эскиза не строится, заменён коробом', 'err'); }
      m = new THREE.Mesh(g); m.userData = {id:o.id, sig:sig(o)}; raw.add(m);
      // рёбра — ребёнок меша: масштаб/поворот/позиция подхватываются сами, отдельно не синхронизируем
      const edgeGeo = o.type === 'stl' ? null : new THREE.EdgesGeometry(g, 25);   // импорт STL — своя плотная сетка, обводка была бы мусором
      if(edgeGeo){
        const edges = new THREE.LineSegments(edgeGeo, EDGE_MAT);
        edges.raycast = () => {};           // иначе клик мимо тела ловит линию рядом (у Line свой допуск)
        m.add(edges);
      }
    }
    objToMesh(o, m);
  });
  const s = sel();
  if(s && s.vis && !showResult && !sketching) gizmo.attach(meshOf(s.id)); else gizmo.detach();
  renderList(); fillProps(); updateDims(); updateGhost();
  if(showResult) rebuildSoon();
  persist();
}

// ---------- CSG результат ----------
// Пересчёт булевой геометрии стоит сотни миллисекунд, а sync() вызывается на каждое
// движение мыши — поэтому результат обновляем по паузе, а во время перетаскивания
// вообще не трогаем: на экране остаётся прошлый, он догонит после отпускания.
let rebuildTimer = null;
function rebuildSoon(){
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => { if(showResult && !gizmo.dragging) rebuild(); }, 250);
}

function rebuild(){
  clearTimeout(rebuildTimer);
  if(resultMesh){ kill(resultMesh); resultMesh = null; }
  try{ resultMesh = buildResult(objects.filter(o => (o.plate || 0) === printPlate()),
                                (o,b) => objToMesh({...o, plate: printPlate()}, b), MAT.result); }
  catch(e){ showResult = false; $('result').classList.remove('on'); say('не удалось собрать: ' + e.message, 'err'); sync(); return; }
  if(resultMesh) scene.add(resultMesh);
}
$('result').onclick = () => {
  showResult = !showResult; $('result').classList.toggle('on', showResult);
  if(!showResult && resultMesh){ kill(resultMesh); resultMesh = null; }
  sync(); say(showResult ? 'показан результат — отверстия вычтены' : 'редактирование');
};

// ---------- история ----------
// undo живёт в localStorage, а не только в памяти вкладки — иначе reload стирает
// всю историю правок. Риск: если сцену параллельно поменяли из другой вкладки/сессии,
// сохранённый снимок может не совпасть с текущим — это цена клиентского undo при общей БД.
const hist = [], redoStack = [];
try{
  const saved = JSON.parse(localStorage.hist || 'null');
  if(saved){ hist.push(...saved.hist); redoStack.push(...saved.redo); }
}catch(e){}
const saveHist = () => { try{ localStorage.hist = JSON.stringify({hist, redo: redoStack}); }catch(e){} };
const snapshot = () => JSON.stringify({objects, nextId});
// push() — состояние ДО изменения; вызывать перед мутацией objects
function push(){ hist.push(snapshot()); if(hist.length > 100) hist.shift(); redoStack.length = 0; saveHist(); }
// Неполный объект (чужой или старый файл проекта) давал NaN в габаритах и матрицах,
// поэтому недостающие поля добираем значениями по умолчанию, а не доверяем файлу.
const DEFAULTS = {type:'box', x:0, y:0, z:0, w:10, d:10, h:10, rot:0, rx:0, rz:0,
                  sides:6, dia:10, pitch:1.5, hole:false, vis:true, color:'#3fae8c'};
const fill = o => {
  const r = {...DEFAULTS, ...o};
  for(const k of ['x','y','z','w','d','h','rot','rx','rz','sides','dia','pitch'])
    if(!Number.isFinite(+r[k])) r[k] = DEFAULTS[k];
  return r;
};

function restore(s){
  const d = typeof s === 'string' ? JSON.parse(s) : s;   // из истории приходит строка, из базы — объект
  if(!Array.isArray(d?.objects)) throw new Error('битый файл проекта');
  objects = d.objects.map(fill); nextId = +d.nextId || Math.max(0, ...objects.map(o => o.id)) + 1;
  if(!byId(selId)) selId = null;
  sync();
}
$('lang').value = localStorage.lang || 'en';
$('lang').onchange = e => { localStorage.lang = e.target.value; location.reload(); };

// боковые панели: сворачиваем в 0, состояние помним между заходами
[['toggle-left', 'left', '‹', '›'], ['toggle-right', 'right', '›', '‹']].forEach(([btn, side, open, closed]) => {
  const aside = document.querySelector('aside.' + side);
  const apply = collapsed => { aside.classList.toggle('collapsed', collapsed); $(btn).textContent = collapsed ? closed : open; };
  apply(localStorage['panel-' + side] === '1');
  $(btn).onclick = () => {
    const collapsed = !aside.classList.contains('collapsed');
    apply(collapsed);
    localStorage['panel-' + side] = collapsed ? '1' : '';
  };
});

$('undo').onclick = () => { if(!hist.length) return; redoStack.push(snapshot()); restore(hist.pop()); saveHist(); say('отменено'); };
$('redo').onclick = () => { if(!redoStack.length) return; hist.push(snapshot()); restore(redoStack.pop()); saveHist(); say('повторено'); };
let gizmoStart = null;
gizmo.addEventListener('mouseDown', () => gizmoStart = snapshot());
function gizmoDone(){
  updateGhost();
  if(gizmoStart && gizmoStart !== snapshot()){ hist.push(gizmoStart); redoStack.length = 0; saveHist(); }
  gizmoStart = null; sync();
}

// Blob-ссылку надо освобождать руками: браузер держит данные, пока жив URL,
// и каждый экспорт оставлял в памяти сотни килобайт до перезагрузки вкладки.
function download(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);   // даём браузеру дописать файл
}

// ---------- сохранение ----------
// sync() дёргается на каждое движение гизмо, поэтому пишем в базу не чаще раза в 400 мс
let saveTimer = null;
function persist(){
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch('/api/scene', {method:'POST', headers:{'content-type':'application/json'}, body: snapshot()})
      .catch(() => say('сцена не сохранилась — сервер не отвечает', 'err'));
  }, 400);
}
$('save').onclick = () => {
  download(new Blob([snapshot()], {type:'application/json'}), 'project.pen3d.json');
  say('проект сохранён', 'ok');
};

// содержимое печати живёт в разметке отдельно, а не сбоку — переносим в попап под кнопкой
$('printer-menu').appendChild($('printer-panel'));
$('printer-panel').hidden = false;

// открытие/закрытие/позиционирование попапов теперь в solid/popovers.js (SolidJS) —
// собранный js/popovers-solid.js подключён отдельным <script> в index.html

$('save-as-json').onclick = () => { $('save').click(); window.__popovers?.close(); };
$('save-as-stl').onclick = () => { $('stl').click(); window.__popovers?.close(); };
$('open').onclick = () => $('file').click();
$('file').onchange = async e => {
  const f = e.target.files[0]; if(!f) return;
  try{
    if(f.name.toLowerCase().endsWith('.stl')){
      const {pts3, w, d, h} = parseStl(await f.arrayBuffer());
      add('stl', {pts3, w, d, h, name: f.name.replace(/\.stl$/i, '')});
      say('STL импортирован: ' + f.name, 'ok');
    }else{
      const before = snapshot(); const t = await f.text(); restore(t); hist.push(before); redoStack.length = 0; saveHist();
      say('проект открыт: ' + f.name, 'ok');
    }
  }catch(err){ say('не открылся: ' + err.message, 'err'); }
  e.target.value = '';
};
$('clear').onclick = () => { if(!objects.length) return; if(!confirm('Очистить проект?')) return;
  push(); objects = []; selId = null; nextId = 1; sync(); say('новый проект'); };

// ---------- объекты ----------
// новую фигуру ставим справа от того, что уже на столе, а не поверх него
function freeSpot(o){
  const vis = objects.filter(x => x.vis && !x.plate);
  if(!vis.length) return {x:0, y:0};
  const box = new THREE.Box3();
  vis.forEach(x => { const m = meshOf(x.id); if(m){ m.updateMatrixWorld(); box.expandByObject(m); } });
  if(!box.isEmpty() && box.max.x + 10 + o.w/2 < BED/2) return {x: +(box.max.x + 10 + o.w/2).toFixed(1), y: 0};
  if(!box.isEmpty() && box.max.z + 10 + o.d/2 < BED/2) return {x: 0, y: +(box.max.z + 10 + o.d/2).toFixed(1)};
  return {x:0, y:0};
}

function add(type, extra={}){
  const NAMES = {box:'Короб', cyl:'Цилиндр', poly:'Призма', sketch:'Эскиз', thread:'Резьба',
                 sphere:'Шар', cone:'Конус', torus:'Кольцо', wedge:'Клин'};
  const o = {id: nextId, name: NAMES[type] + ' ' + nextId,
    type, x:0, y:0, z:0, w:30, d:30, h:10, rot:0, rx:0, rz:0, sides:6, dia:10, pitch:1.5,
    color:'#3fae8c', shell:0, openTop:false, hole:false, vis:true, ...extra};
  if(['cyl','poly','cone','sphere','torus','wedge'].includes(type)) o.h = 15;
  if(type === 'thread'){ o.h = 20; o.w = o.d = o.dia; }
  if(!('x' in extra)) Object.assign(o, freeSpot(o));
  push();
  nextId++; objects.push(o); selId = o.id; sync(); say('добавлен: ' + o.name);
  return o;
}
document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => add(b.dataset.add));
$('del').onclick = () => { const o = sel(); if(!o) return;
  push();
  objects = objects.filter(x => x !== o); selId = null; sync(); say('удалён: ' + o.name); };
$('hud-hide').onclick = () => { hudOff = true;
  say('панель скрыта — выбери фигуру заново, чтобы вернуть'); };
$('hud-dup').onclick = () => $('dup').click();
$('hud-del').onclick = () => $('del').click();
$('hud-center').onclick = () => $('center').click();
$('hud-drop').onclick = () => $('drop').click();
$('hud-group').onclick = () => $('group').click();

$('dup').onclick = () => { const o = sel(); if(!o) return;
  push();
  const c = {...o, id: nextId++, name: o.name + ' копия', x: o.x + 10, y: o.y + 10, pts: o.pts && o.pts.map(p => p.slice())};
  objects.push(c); selId = c.id; sync(); say('дубль: ' + c.name); };

// Копия тела: pts копируем поштучно, иначе обе фигуры будут делить один контур
// и правка одной молча поменяет вторую.
const copyOf = (o, extra) => ({...o, id: nextId++, pts: o.pts && o.pts.map(p => p.slice()), ...extra});

// Зеркало. Отражаем координату и разворот; у эскиза переворачиваем сам контур,
// иначе получится копия, а не зеркальная деталь.
$('mirror').onclick = () => {
  const o = sel(); if(!o) return say('выбери фигуру', 'err');
  const ax = $('mirror-ax').value;                       // 'x' или 'y'
  const part = o.grp ? objects.filter(x => x.grp === o.grp) : [o];
  const c = ax === 'x'
    ? (Math.min(...part.map(p => p.x - p.w/2)) + Math.max(...part.map(p => p.x + p.w/2))) / 2
    : (Math.min(...part.map(p => p.y - p.d/2)) + Math.max(...part.map(p => p.y + p.d/2))) / 2;
  push();
  const grp = part.length > 1 ? 'g' + Date.now() : undefined;
  const made = part.map(p => {
    const q = copyOf(p, {grp});
    if(ax === 'x'){ q.x = +(2*c - p.x).toFixed(2); q.rot = (360 - (p.rot || 0)) % 360; }
    else          { q.y = +(2*c - p.y).toFixed(2); q.rot = (180 - (p.rot || 0) + 360) % 360; }
    if(q.pts) q.pts = q.pts.map(([px, py]) => ax === 'x' ? [-px, py] : [px, -py]);
    return q;
  });
  objects.push(...made); selId = made[0].id; sync();
  say(`зеркало по ${ax === 'x' ? 'X' : 'Y'} · тел: ${made.length}`, 'ok');
};

// Массив. Линейный — n копий с шагом, круговой — n копий по окружности вокруг центра детали.
$('array').onclick = () => {
  const o = sel(); if(!o) return say('выбери фигуру', 'err');
  const n = Math.max(2, Math.min(64, Math.round(+$('arr-n').value || 4)));
  const step = +$('arr-step').value || 20;
  const round = $('arr-kind').value === 'round';
  const part = o.grp ? objects.filter(x => x.grp === o.grp) : [o];
  push();
  const made = [];
  for(let i = 1; i < n; i++){
    for(const p of part){
      if(round){
        const a = i * 360 / n, rad = a * Math.PI / 180;
        const r = Math.hypot(p.x, p.y) || step;
        const a0 = Math.atan2(p.y, p.x);
        made.push(copyOf(p, {x: +(r * Math.cos(a0 + rad)).toFixed(2),
                             y: +(r * Math.sin(a0 + rad)).toFixed(2),
                             rot: +(((p.rot || 0) + a) % 360).toFixed(1)}));
      }else{
        made.push(copyOf(p, {x: +(p.x + step * i).toFixed(2)}));
      }
    }
  }
  objects.push(...made); sync();
  say(`${round ? 'по кругу' : 'в ряд'}: добавлено тел ${made.length}`, 'ok');
};

function select(id){
  hudOff = false;
  selId = id;
  const s = sel();
  if(s && s.vis && !showResult && !sketching) gizmo.attach(meshOf(s.id)); else gizmo.detach();
  document.querySelectorAll('#list .obj').forEach(r => r.classList.toggle('sel', +r.dataset.id === selId));
  fillProps(); updateGhost(); if(s) say(s.name);
}

// ---------- список ----------
function renderList(){
  const L = $('list'); L.innerHTML = '';
  $('empty').hidden = objects.length > 0;
  [...objects].reverse().forEach(o => {
    const row = document.createElement('div');
    row.className = 'obj' + (o.id === selId ? ' sel' : '') + (o.hole ? ' hole' : '')
                  + (o.vis ? '' : ' hidden') + (o.grp ? ' grp' : '');
    row.dataset.id = o.id;
    row.innerHTML = `<span class="sw" style="background:${o.hole ? '' : esc(o.color || '#3fae8c')}"></span><span class="nm">${esc(o.name)}</span>
      <button title="отверстие / тело">${o.hole ? '⊖' : '⊕'}</button><button title="видимость">${o.vis ? '👁' : '—'}</button>`;
    row.onclick = () => select(o.id);
    const nm = row.querySelector('.nm'), [bh, bv] = row.querySelectorAll('button');
    nm.ondblclick = e => { e.stopPropagation(); nm.contentEditable = 'true'; nm.focus();
      document.execCommand('selectAll', false, null); };
    nm.onblur = () => { nm.contentEditable = 'false';
      const v = nm.textContent.trim(); if(v && v !== o.name){ push(); o.name = v; sync(); } };
    nm.onkeydown = e => { if(e.key === 'Enter'){ e.preventDefault(); nm.blur(); } e.stopPropagation(); };
    bh.onclick = e => { e.stopPropagation(); push(); o.hole = !o.hole; sync();
      say(o.hole ? 'теперь отверстие' : 'теперь тело'); };
    bv.onclick = e => { e.stopPropagation(); push(); o.vis = !o.vis; sync(); };
    L.appendChild(row);
  });
}
const esc = s => String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

// ---------- табы правой панели ----------
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  document.querySelectorAll('.tabpane').forEach(p => p.hidden = p.dataset.pane !== b.dataset.tab);
});
const showTab = t => document.querySelector(`.tabs button[data-tab="${t}"]`).click();

// ---------- свойства ----------
const P = ['name','hole','keep','vis','color','w','d','h','x','y','z','rot','rx','rz','sides','dia','pitch','shell','openTop'];
const NUM_FIELDS = new Set(['w','d','h','x','y','z','rot','rx','rz','sides','dia','pitch','shell']);
// поля размеров/позиции принимают выражения (w/2+3), не только число — считаем сами,
// а не через eval: разрешаем только цифры/операторы/скобки и уже известные имена переменных
function evalExpr(str, scope){
  str = String(str).trim();
  if(!/^[-+*/().\s\d]*$/.test(str.replace(/[a-zA-Z]+/g, ''))) return NaN;
  const names = Object.keys(scope);
  for(const w of str.match(/[a-zA-Z]+/g) || []) if(!names.includes(w)) return NaN;
  try{ return Function(...names, `"use strict"; return (${str || '0'})`)(...names.map(n => scope[n])); }
  catch(e){ return NaN; }
}
// сама отрисовка формы — в solid/props-panel.js (SolidJS), тут только источник данных
function fillProps(){ window.__propsPanel?.update(sel()); }
// скругление углов короба — не свойство, а подмена короба на эскиз с дугами по углам
// (полноценного fillet по рёбрам в CSG нет); 0 в поле возвращает обратно в короб
$('p-round').onchange = () => {
  const o = sel(); if(!o) return;
  const r = Math.max(0, evalExpr($('p-round').value, o) || 0);
  if(!r){
    if(o.type !== 'sketch' || !('round' in o)) return;
    push(); Object.assign(o, {type:'box', w:o.roundW, d:o.roundD});
    delete o.pts; delete o.round; delete o.roundW; delete o.roundD; sync(); say('скругление убрано');
    return;
  }
  const w = o.type === 'sketch' ? o.roundW : o.w, d = o.type === 'sketch' ? o.roundD : o.d;
  const g = roundedRect(w, d, r);
  push(); Object.assign(o, {type:'sketch', pts:g.pts, w:g.size, d:g.size, round:g.r, roundW:w, roundD:d});
  sync(); say(`угол скруглён: R${g.r.toFixed(1)}`, 'ok');
};
P.forEach(k => {
  const el = $('p-' + k);
  el.onchange = () => { const o = sel(); if(!o) return;
    let v = el.type === 'checkbox' ? el.checked : NUM_FIELDS.has(k) ? evalExpr(el.value, o) : el.value.trim();
    if(NUM_FIELDS.has(k) && !Number.isFinite(v)){ say('не считается: ' + el.value, 'err'); el.value = o[k]; return; }
    if(k === 'keep'){ push(); o.mode = v ? 'keep' : undefined; sync(); return; }
    if(k === 'color'){ o.color = v; sync(); persist(); return; }
    if(k === 'sides') v = Math.max(3, Math.min(64, Math.round(v)));
    if(k === 'dia') v = Math.max(2, v);
    if(k === 'pitch') v = Math.max(.3, Math.min(v, 5));
    if(k === 'shell'){
      v = Math.max(0, v);
      const lim = +(Math.min(o.w, o.d, o.h)/2 - .2).toFixed(1);
      if(v > 0 && v < .8){ say('стенка тоньше 0.8 мм — печатать нечем, поднял до 0.8', 'err'); v = .8; }
      if(v > lim){ say(`стенка не может быть толще ${lim} мм для этой детали`, 'err'); v = Math.max(0, lim); }
      if(v > 0 && !o.shell) o.openTop = true;     // закрытая полость = мостик через всю деталь
    }
    if('wdh'.includes(k)) v = Math.max(.2, v);
    if(k === 'z') v = o.hole ? v : Math.max(0, v);
    if(k === 'rot' || k === 'rx' || k === 'rz') v = ((v % 360) + 360) % 360;
    if(k === 'name' && !v) return;
    if(o[k] === v) return;
    push();
    if(o.grp && 'xyz'.includes(k) && k.length === 1){
      const d = v - o[k];
      objects.forEach(x => { if(x.grp === o.grp && x !== o) x[k] = +(x[k] + d).toFixed(2); });
    }
    o[k] = v; sync(); };
});

// выравнивание: угол к ближайшим 90°, деталь обратно на стол
document.querySelectorAll('[data-align]').forEach(b => b.onclick = () => {
  const o = sel(); if(!o) return say('выбери фигуру', 'err');
  const k = b.dataset.align, v = (Math.round((o[k] || 0)/90)*90) % 360;
  if(v === (o[k] || 0)) return say('уже выровнено');
  push(); o[k] = v; sync(); $('drop').click();
  say(`${k === 'rot' ? 'Y' : k === 'rx' ? 'X' : 'Z'} → ${v}°`);
});

$('sink').onclick = () => {
  const o = sel(); if(!o) return say('выбери фигуру', 'err');
  if(!o.hole) return say('это тело, а не отверстие — включи «отверстие»', 'err');
  push(); o.z = -1; sync(); say('отверстие утоплено на 1 мм ниже стола');
};

// закрытая сверху полость — мостик во всю ширину, слайсер его провесит
function shellWarning(){
  const bad = objects.filter(o => o.vis && !o.hole && o.shell > 0 && !o.openTop);
  if(!bad.length) return '';
  const w = Math.max(...bad.map(o => Math.max(o.w, o.d) - 2*o.shell));
  return ` · полость закрыта сверху: мостик ${w.toFixed(0)} мм провиснет, включи «открыть сверху»`;
}

$('center').onclick = () => {
  const o = sel(); if(!o) return say('выбери фигуру', 'err');
  const hosts = objects.filter(x => !x.hole && x.vis && x !== o && (x.plate||0) === (o.plate||0));
  if(!hosts.length) return say('не с чем совмещать — на столе нет тел', 'err');
  const inside = hosts.find(x => Math.abs(o.x - x.x) <= x.w/2 && Math.abs(o.y - x.y) <= x.d/2);
  const host = inside || hosts.reduce((a, b) =>
    Math.hypot(a.x-o.x, a.y-o.y) < Math.hypot(b.x-o.x, b.y-o.y) ? a : b);
  push(); o.x = host.x; o.y = host.y; sync();
  say(inside ? `по центру «${host.name}»`
             : `фигура была не внутри детали — поставил по центру ближайшей «${host.name}»`,
      inside ? '' : 'err');
};

$('stack').onclick = () => {
  const o = sel(); if(!o) return say('выбери фигуру', 'err');
  const hosts = objects.filter(x => !x.hole && x.vis && x !== o && (x.plate||0) === (o.plate||0));
  if(!hosts.length) return say('не с чем совмещать — на столе нет тел', 'err');
  const inside = hosts.find(x => Math.abs(o.x - x.x) <= x.w/2 && Math.abs(o.y - x.y) <= x.d/2);
  const host = inside || hosts.reduce((a, b) =>
    Math.hypot(a.x-o.x, a.y-o.y) < Math.hypot(b.x-o.x, b.y-o.y) ? a : b);
  push(); o.x = host.x; o.y = host.y; o.z = +(host.z + host.h).toFixed(2); sync();
  say(`поставлена сверху на «${host.name}»`, 'ok');
};

$('drop').onclick = () => {
  const o = sel(), m = o && meshOf(o.id); if(!m) return;
  m.updateMatrixWorld();
  const under = new THREE.Box3().setFromObject(m).min.y;
  if(Math.abs(under) < 1e-3) return say('уже на столе');
  push(); o.z = +Math.max(0, o.z - under).toFixed(2); sync(); say('посажена на стол');
};

// два тела одного сечения (тот же X/Y-центр и Ш/Г), уложенные впритык или внахлёст по Z —
// грани совпадают в глубину: на экране z-fighting, а при сборке «Результата» риск зависа CSG
function coplanarWarning(){
  const vis = objects.filter(o => o.vis && !o.hole && (o.plate || 0) === printPlate());
  for(let i = 0; i < vis.length; i++) for(let j = i + 1; j < vis.length; j++){
    const a = vis[i], b = vis[j];
    if(Math.abs(a.x - b.x) > .05 || Math.abs(a.y - b.y) > .05) continue;
    if(Math.abs(a.w - b.w) > .05 || Math.abs(a.d - b.d) > .05) continue;
    const touch = Math.abs(a.z - (b.z + b.h)) < .05 || Math.abs(b.z - (a.z + a.h)) < .05;
    const overlap = a.z < b.z + b.h - .05 && b.z < a.z + a.h - .05;
    if(touch || overlap)
      return ` · «${a.name}» и «${b.name}» одного сечения впритык по Z — разведи по высоте, иначе мерцание/зависание`;
  }
  return '';
}

function updateDims(){
  const vis = objects.filter(o => o.vis && !o.hole && (o.plate || 0) === printPlate());
  if(!vis.length){ $('dims').textContent = ''; return; }
  const box = new THREE.Box3();
  vis.forEach(o => { const m = meshOf(o.id); if(m){ m.updateMatrixWorld(); box.expandByObject(m); } });
  const s = new THREE.Vector3(); box.getSize(s);
  const over = s.x > BED || s.z > BED || s.y > BED;
  const sunk = box.min.y < -0.2;
  const warn = shellWarning(), coplanar = coplanarWarning();
  $('dims').textContent = `${s.x.toFixed(1)} × ${s.z.toFixed(1)} × ${s.y.toFixed(1)}`
    + t(' мм · стол A1 256×256×256')
    + (over ? t(' · НЕ ВЛЕЗАЕТ') : '') + (sunk ? t(' · ниже стола') : '') + warn + coplanar;
  $('dims').style.color = over || sunk || warn || coplanar ? 'var(--danger)' : '';
}

// ---------- гизмо / выбор ----------
function setMode(m){ gizmo.setMode(m); gizmo.showX = gizmo.showY = gizmo.showZ = true;
  document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m)); }
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
let snap = true;
$('snap').onclick = () => { snap = !snap; $('snap').classList.toggle('on', snap);
  gizmo.setTranslationSnap(snap ? 1 : null); gizmo.setRotationSnap(snap ? THREE.MathUtils.degToRad(15) : null); gizmo.setScaleSnap(snap ? .05 : null); };

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pointerNdc(e){ const r = view.getBoundingClientRect();
  ndc.set((e.clientX - r.left)/r.width*2 - 1, -((e.clientY - r.top)/r.height*2 - 1)); }
let downAt = null;
view.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
view.addEventListener('pointerup', e => {
  if(dragged){ dragged = false; downAt = null; return; }
  if(!downAt || sketching || gizmo.dragging) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4; downAt = null;
  if(moved || e.button !== 0) return;
  pointerNdc(e); ray.setFromCamera(ndc, cam);
  if(measuring){ measureClick(); return; }
  const hit = ray.intersectObjects(raw.children.filter(m => m.visible))[0];
  select(hit ? hit.object.userData.id : null);
});

// ---------- измерение расстояния ----------
// не CAD-констрейнты, просто «поставил две точки — увидел мм»: клик по телу или по столу
let measuring = false, measurePts = [];
const MEASURE_MAT = new THREE.LineDashedMaterial({color:0xffd166, dashSize:3, gapSize:2, depthTest:false});
const measureDot = () => new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 12),
  new THREE.MeshBasicMaterial({color:0xffd166, depthTest:false}));
const measureDots = [measureDot(), measureDot()];
measureDots.forEach(d => { d.visible = false; d.renderOrder = 999; scene.add(d); });
let measureLine = null;
function measureClick(){
  const targets = raw.children.filter(m => m.visible).concat(plates.map(p => p.plate));
  const hit = ray.intersectObjects(targets)[0];
  if(!hit) return;
  if(measurePts.length >= 2) measurePts = [];
  measurePts.push(hit.point.clone());
  measureDots.forEach((d, i) => d.visible = i < measurePts.length);
  if(measurePts.length >= 1) measureDots[measurePts.length - 1].position.copy(hit.point);
  if(measureLine){ scene.remove(measureLine); measureLine.geometry.dispose(); measureLine = null; }
  if(measurePts.length === 2){
    const g = new THREE.BufferGeometry().setFromPoints(measurePts);
    measureLine = new THREE.Line(g, MEASURE_MAT); measureLine.computeLineDistances();
    measureLine.renderOrder = 999; scene.add(measureLine);
  }
}
function measureOff(){
  measuring = false; measurePts = []; $('measure').classList.remove('on');
  measureDots.forEach(d => d.visible = false);
  if(measureLine){ scene.remove(measureLine); measureLine.geometry.dispose(); measureLine = null; }
}
$('measure').onclick = () => {
  measuring = !measuring; $('measure').classList.toggle('on', measuring);
  if(!measuring) measureOff(); else { measurePts = []; measureDots.forEach(d => d.visible = false);
    if(measureLine){ scene.remove(measureLine); measureLine.geometry.dispose(); measureLine = null; } }
  say(measuring ? 'измерение: кликни две точки' : 'измерение выключено');
};

// ---------- эскиз ----------
let sketching = false, sk = null, skLine = null;
const bedPlane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
$('sketch').onclick = () => {
  sketching = !sketching; $('sketch').classList.toggle('on', sketching); $('stage').classList.toggle('sketch', sketching);
  orbit.enabled = !sketching;
  sk = null; if(skLine){ kill(skLine); skLine = null; }
  if(sketching){ setView('top'); say('рисуй контур на столе, отпусти — получится фигура'); }
  sync();
};
function bedPoint(e){ pointerNdc(e); ray.setFromCamera(ndc, cam);
  const p = new THREE.Vector3(); return ray.ray.intersectPlane(bedPlane, p) ? p : null; }
view.addEventListener('pointerdown', e => {
  if(!sketching || e.button !== 0) return;
  const p = bedPoint(e); if(!p) return;
  sk = [[p.x, p.z]]; view.setPointerCapture(e.pointerId);
});
view.addEventListener('pointermove', e => {
  if(!sk || !sketching) return; const p = bedPoint(e); if(!p) return;
  const l = sk[sk.length-1];
  if(Math.hypot(p.x - l[0], p.z - l[1]) > 1.5){ sk.push([p.x, p.z]); drawSk(); }
});
view.addEventListener('pointerup', () => {
  if(!sk) return;
  if(skLine){ kill(skLine); skLine = null; }
  if(sk.length > 5) finishSketch(sk);
  sk = null;
});
function drawSk(){
  if(skLine) kill(skLine);
  const g = new THREE.BufferGeometry().setFromPoints(sk.map(p => new THREE.Vector3(p[0], .3, p[1])));
  skLine = new THREE.Line(g, new THREE.LineBasicMaterial({color:0x3fae8c})); scene.add(skLine);
}
function finishSketch(p){
  const xs = p.map(q => q[0]), zs = p.map(q => q[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const w = Math.max(1, x1 - x0), d = Math.max(1, z1 - z0);
  // нормализуем в [-0.5,0.5]; z стола идёт вглубь, у Shape ось y — вверх, поэтому инвертируем
  const pts = p.map(q => [(q[0] - x0)/w - .5, -((q[1] - z0)/d - .5)]);
  add('sketch', {pts, w:+w.toFixed(1), d:+d.toFixed(1), h:10, x:+((x0+x1)/2).toFixed(1), y:+((z0+z1)/2).toFixed(1)});
}

// ---------- виды ----------
// перелёт между столами: скучный мгновенный прыжок сбивает ориентацию
let fly = null;
function focusPlate(x = printPlate() * PLATE_GAP, dur = 550){
  const dx = x - orbit.target.x;
  if(Math.abs(dx) < .01) return;
  fly = {t0: performance.now(), dur, tx: orbit.target.x, cx: cam.position.x, dx};
}
function stepFly(){
  if(!fly) return;
  const k = Math.min(1, (performance.now() - fly.t0) / fly.dur);
  const e = k < .5 ? 4*k*k*k : 1 - Math.pow(-2*k + 2, 3)/2;   // ease-in-out
  orbit.target.x = fly.tx + fly.dx*e;
  cam.position.x = fly.cx + fly.dx*e;
  if(k >= 1) fly = null;
}

function setView(v){
  const t = new THREE.Vector3(printPlate() * PLATE_GAP, 20, 0); orbit.target.copy(t);
  const r = 320;
  if(v === 'top') cam.position.set(t.x, r, 0.001);
  if(v === 'front') cam.position.set(t.x, 40, r);
  if(v === 'side') cam.position.set(t.x + r, 40, 0);
  if(v === 'iso') cam.position.set(t.x + 220, 200, 260);
  cam.lookAt(t); orbit.update(); fly = null;
}
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => setView(b.dataset.view));

// Виды ставят камеру на весь стол 256 мм, поэтому деталь на 20 мм видна как точка,
// а подписи и подсветка отверстия сливаются. F подводит камеру к тому, что выбрано.
function focusSelection(){
  const o = sel(), m = o && meshOf(o.id);
  const box = new THREE.Box3();
  if(m && m.visible){ m.updateMatrixWorld(); box.expandByObject(m); }
  else objects.filter(x => x.vis).forEach(x => { const q = meshOf(x.id);
    if(q){ q.updateMatrixWorld(); box.expandByObject(q); } });
  if(box.isEmpty()) return say('нечего приближать', 'err');
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
  const r = Math.max(sz.x, sz.y, sz.z) || 10;
  const dist = r / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) * 2.4;
  const dir = cam.position.clone().sub(orbit.target).normalize();
  fly = null;                                  // ручной перелёт отменяет анимацию столов
  orbit.target.copy(c);
  cam.position.copy(c).add(dir.multiplyScalar(Math.max(dist, r * 1.5)));
  orbit.update();
  say(o ? `приближено: ${o.name}` : 'приближено к детали');
}
$('focus')?.addEventListener('click', focusSelection);

// ---------- клавиши ----------
addEventListener('keydown', e => {
  if(/INPUT|TEXTAREA/.test(document.activeElement.tagName) || document.activeElement.isContentEditable) return;
  const meta = e.metaKey || e.ctrlKey;
  if(meta && e.key.toLowerCase() === 'z'){ e.preventDefault(); (e.shiftKey ? $('redo') : $('undo')).click(); return; }
  if(meta && e.key.toLowerCase() === 'd'){ e.preventDefault(); $('dup').click(); return; }
  if(e.key === 'Delete' || e.key === 'Backspace'){ e.preventDefault(); $('del').click(); return; }
  if(e.key === 'Escape'){ if(measuring) measureOff(); else if(sketching) $('sketch').click(); else select(null); return; }
  const k = e.key.toLowerCase();
  if(k === 'g') setMode('translate'); if(k === 'r') setMode('rotate'); if(k === 's') setMode('scale');
  if(k === 'f'){ e.preventDefault(); focusSelection(); return; }
  if(e.key >= '1' && e.key <= '4') setView(['iso','top','front','side'][e.key - 1]);
});

// ---------- экспорт ----------
const printPlate = () => +$('plate-print').value;
function stlBytes(){
  let m;
  const on = objects.filter(o => (o.plate || 0) === printPlate());
  if(!on.length) say(printPlate() ? 'стол агента пуст' : 'твой стол пуст', 'err');
  try{ m = buildResult(on, (o, b) => objToMesh({...o, plate:0}, b), MAT.result); }
  catch(e){ say('не удалось собрать: ' + e.message, 'err'); return null; }
  if(!m){ say('нет ни одного тела', 'err'); return null; }
  // меш собран только ради экспорта и в сцену не попадает — освобождаем сразу,
  // иначе каждая выгрузка оставляет в памяти геометрию на тысячи треугольников
  return meshToStlAsync(m).finally(() => m.geometry.dispose());
}

$('estimate').onclick = async e => {
  const btn = e.currentTarget, box = $('est');
  const done = busy(btn, t('считаем…')); say(t('готовлю модель'));
  const out = await stlBytes(); if(!out) return done();
  say(t('слайсим, чтобы посчитать расход'));
  try{
    const r = await fetch('/estimate', {method:'POST', body: out, headers:{
      'x-support': $('sup').checked ? '1' : '0', 'x-infill': $('infill').value,
      'x-pattern': $('pattern').value, 'x-walls': $('walls').value, 'x-bed': $('bed').value}});
    const j = await r.json();
    if(j.error) throw new Error(j.error);
    const h = Math.floor(j.seconds/3600), m = Math.round(j.seconds%3600/60);
    box.hidden = false;
    box.innerHTML = `<b style="color:var(--ink);font-size:13px">${j.grams} ${t('г пластика')}</b>`
      + `<br>${t('время печати')} ${h} ${t('ч')} ${m} ${t('мин')} · ${j.layers} ${t('слоёв')}`
      + `<br>${t('филамента')} ${j.length_m} ${t('м')} · ${j.volume_cm3} ${t('см³')}`
      + (j.cost ? `<br>${t('материал на')} ${j.cost} $` : '')
      + `<br><span style="color:#5c626e">${j.material} · ${j.density} ${t('г/см³')} · Ø${j.diameter} ${t('мм пруток')}</span>`;
    say(`${j.grams} ${t('г')} · ${h}${t('ч')} ${m}${t('мин')}`, 'ok');
  }catch(err){ say(t('не удалось посчитать: ') + err.message, 'err'); }
  done();
};

$('stl').onclick = async e => {
  const done = busy(e.currentTarget, t('готовлю…'));
  const out = await stlBytes();
  done();
  if(!out) return;
  download(new Blob([out], {type:'model/stl'}), 'pen3d.stl');
  say('STL сохранён', 'ok');
};
async function toPrinter(path, btn, label){
  if(path === '/print' && !confirm('Запустить печать на A1 прямо сейчас?')) return;
  const done = busy(btn, t('слайсим…')); say('слайсим в Bambu Studio, ~20 сек');
  const out = await stlBytes(); if(!out) return done();
  try{
    const r = await fetch(path, {method:'POST', body: out, headers:{
      'x-support': $('sup').checked ? '1' : '0',
      'x-infill': $('infill').value, 'x-pattern': $('pattern').value, 'x-walls': $('walls').value, 'x-bed': $('bed').value}});
    const j = await r.json();
    if(j.error) throw new Error(j.error);
    say((j.printing ? 'печать запущена: ' : 'залито на принтер: ') + j.file
        + (j.support ? ' · с поддержками' : '') + ` · заполнение ${j.infill}%`, 'ok');
  }catch(e){ say(e.message.split('\n')[0] + ' — проверь ~/.pen3d.json и LAN Only Mode', 'err'); }
  done();
}
$('send').onclick = e => toPrinter('/upload', e.currentTarget, 'Залить на A1');
$('print').onclick = e => toPrinter('/print', e.currentTarget, 'Печатать сейчас');

// ---------- AI ----------
const key = $('key'), prov = $('prov'), model = $('model'), base = $('base');
const aiCfg = () => { try{ return JSON.parse(localStorage.aicfg) || {}; }catch(e){ return {}; } };
function saveAi(){
  const c = aiCfg(); c.prov = prov.value;
  c[prov.value] = {model: model.value.trim(), base: base.value.trim(), key: key.value};
  localStorage.aicfg = JSON.stringify(c);
}
function loadAi(){
  const c = aiCfg(); prov.value = c.prov || 'deepseek'; applyPreset();
}
function applyPreset(){
  const p = PROVIDERS[prov.value], saved = aiCfg()[prov.value] || {};
  model.value = saved.model || p.model;
  base.value = saved.base || p.base;
  key.value = saved.key || '';
  $('base-row').style.display = prov.value === 'anthropic' ? 'none' : '';
  key.placeholder = prov.value === 'anthropic' ? 'sk-ant-… (обязателен)'
    : prov.value === 'ollama' ? 'не нужен' : 'API-ключ (пусто — из ~/.pen3d.json)';
  $('ai-hint').textContent = p.hint;
}
prov.onchange = () => { applyPreset(); saveAi(); };
[model, base, key].forEach(el => el.oninput = saveAi);
loadAi();

async function askAi(prompt){
  if(prov.value === 'anthropic'){
    if(!key.value) throw new Error('нужен Anthropic API-ключ');
    const r = await fetch('https://api.anthropic.com/v1/messages', {method:'POST', headers:{
      'content-type':'application/json', 'x-api-key':key.value, 'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true'},
      body: JSON.stringify({model: model.value || 'claude-sonnet-5', max_tokens:8000,
                            messages:[{role:'user', content: prompt}]})});
    const j = await r.json();
    if(!j.content) throw new Error(JSON.stringify(j).slice(0,200));
    return j.content.find(c => c.type === 'text')?.text || '';
  }
  const r = await fetch('/ai', {method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({prompt, model: model.value, base_url: base.value, key: key.value})});
  const j = await r.json();
  if(j.error) throw new Error(j.error);
  return j.text;
}
$('ping').onclick = async e => {
  const b = e.currentTarget; b.disabled = true; b.textContent = 'проверяем…';
  try{ const t = await askAi('Ответь одним словом: ок');
    say(`${model.value} отвечает: ${t.trim().slice(0,40)}`, 'ok'); }
  catch(err){ say('модель недоступна: ' + err.message, 'err'); }
  b.disabled = false; b.textContent = 'Проверить связь';
};
$('ai').value = localStorage.aitask || '';
$('ai').oninput = () => localStorage.aitask = $('ai').value;

async function loadLog(){
  const box = $('log');
  try{
    const j = await (await fetch('/ai-log')).json();
    box.innerHTML = '';
    if(!j.rows.length){ box.innerHTML = '<div class="hint">пока пусто</div>'; return; }
    j.rows.slice().reverse().forEach(r => {
      const d = document.createElement('div');
      d.className = 'rec' + (r.error ? ' bad' : '');
      const n = r.answer ? (r.answer.match(/"type"/g) || []).length : 0;
      d.innerHTML = `<div class="task">${esc(r.task || '—')}</div>
        <div class="meta">${esc(r.ts)} · ${esc(r.model || '')} · ${r.error ? esc(r.error.slice(0,60)) : n + ' тел'}</div>`;
      d.onclick = () => { $('ai').value = r.task; localStorage.aitask = r.task; say('запрос подставлен'); };
      box.appendChild(d);
    });
  }catch(e){ box.innerHTML = '<div class="hint">лог недоступен</div>'; }
}
$('log-refresh').onclick = loadLog;
loadLog();

// статус принтера: опрашиваем сервер, он держит MQTT сам
const STATES = {IDLE:'простаивает', RUNNING:'печатает', PAUSE:'на паузе',
                FINISH:'печать закончена', FAILED:'сбой печати', PREPARE:'готовится', SLICING:'слайсит'};
async function pollPrinter(){
  const box = $('printer');
  try{
    const p = await (await fetch('/printer')).json();
    if(!p.online){
      box.className = 'pr err';
      box.innerHTML = `<div class="pr-row"><span class="dot"></span><b>нет связи</b></div>
        <div>${esc(p.error || 'принтер не отвечает')}</div>`;
      return;
    }
    const busy = p.state === 'RUNNING' || p.state === 'PREPARE';
    const wasBed = bedNow;
    bedNow = busy ? (p.bed ?? null) : null;      // вне печати показываем расчёт по пластине
    if (Math.round(wasBed ?? -1) !== Math.round(bedNow ?? -1)) markPlates();
    box.className = 'pr ' + (p.error_code ? 'err' : busy ? 'busy' : 'on');
    const mins = p.remaining ? `${Math.floor(p.remaining/60)} ч ${p.remaining%60} мин` : '';
    box.innerHTML = `
      <div class="pr-row"><span class="dot"></span><b>${esc(STATES[p.state] || p.state || '—')}</b>
        <span>${p.wifi ? 'Wi-Fi ' + esc(p.wifi) : ''}</span></div>
      ${busy ? `<div class="bar"><i style="width:${p.percent || 0}%"></i></div>
        <div class="pr-row"><span>${esc(p.job || 'печать')}</span>
          <span class="t">${p.percent || 0}%</span></div>
        <div class="pr-row"><span>слой ${p.layer || 0} из ${p.layers || 0}</span>
          <span class="t">${mins}</span></div>` : ''}
      <div class="pr-row"><span>сопло</span>
        <span class="t">${Math.round(p.nozzle || 0)}°${p.nozzle_target ? ' → ' + Math.round(p.nozzle_target) + '°' : ''}</span></div>
      <div class="pr-row"><span>стол</span>
        <span class="t">${Math.round(p.bed || 0)}°${p.bed_target ? ' → ' + Math.round(p.bed_target) + '°' : ''}</span></div>
      ${p.filament.length ? p.filament.map(f => `<div class="pr-row"><span>${esc(f.source || t('филамент'))}</span>
        <span class="t"><i class="sw" style="background:#${esc((f.color||'').slice(0,6) || '888')}"></i>${esc(f.type)}${f.temp && f.temp !== '-' ? ' · ' + esc(f.temp) + '°' : ''}</span></div>`).join('')
        : `<div class="pr-row"><span>${t('филамент')}</span><span class="t">${t('не определён')}</span></div>`}
      ${p.error_code && p.error_info ? `<div style="color:var(--danger);margin-top:4px">
        <b>${t('ошибка')} ${esc(p.error_info.code)}</b><br>${esc(p.error_info.hint || p.error_info.text || '')}</div>` : ''}
      ${p.age > 30 ? `<div>данные ${p.age} с назад</div>` : ''}`;
  }catch(e){
    box.className = 'pr err';
    box.innerHTML = '<div class="pr-row"><span class="dot"></span><b>сервер не отвечает</b></div>';
  }
}
pollPrinter(); setInterval(pollPrinter, 4000);

// расход токенов, копится в базе
const tok = {in:0, out:0, calls:0};
const saveTokens = () => fetch('/api/tokens', {method:'POST', headers:{'content-type':'application/json'},
                                               body: JSON.stringify(tok)}).catch(() => {});
function showTokens(){
  $('tokens').textContent = tok.calls
    ? t('запросов ') + tok.calls + t(' · ввод ') + tok.in.toLocaleString('ru')
      + t(' · ответ ') + tok.out.toLocaleString('ru')
      + t(' · всего ') + (tok.in + tok.out).toLocaleString('ru')
      + (tok.cached ? t(' · из кэша ') + tok.cached.toLocaleString('ru') + t(' (дешевле)') : '')
    : 'пока ничего не потрачено';
}
function addTokens(u){
  if(!u) return;
  tok.in += u.prompt_tokens || 0; tok.out += u.completion_tokens || 0; tok.calls++;
  tok.cached = (tok.cached || 0) + (u.prompt_cache_hit_tokens || 0);
  saveTokens(); showTokens();
}
$('tokens-reset').onclick = () => { tok.in = tok.out = tok.calls = 0;
  saveTokens(); showTokens(); say('счётчик сброшен'); };
showTokens();

$('bed').value = localStorage.bed || 'Textured PEI Plate';
$('bed').onchange = () => { localStorage.bed = $('bed').value; markPlates();
  say(`пластина: ${$('bed').selectedOptions[0].textContent}`); };

// Двойной клик по плите делает её активной: печатать будем её, камера переезжает следом.
// Точку берём на плоскости стола — тем же лучом, что и рисование эскиза.
view.addEventListener('dblclick', e => {
  if(sketching || gizmo.dragging) return;
  const p = bedPoint(e);
  if(!p) return;
  const near = Math.abs(p.x) < Math.abs(p.x - PLATE_GAP) ? 0 : 1;
  if(Math.abs(p.x - near * PLATE_GAP) > BED / 2 + 20) return;   // мимо обеих плит
  const sel2 = $('plate-print');
  if(+sel2.value === near) return focusPlate();                 // уже активна — просто подлетаем
  sel2.value = String(near);
  sel2.dispatchEvent(new Event('change'));
});

$('plate-print').onchange = () => { updateDims(); markPlates(); focusPlate(); if(showResult) rebuild();
  say(printPlate() ? 'печатаем стол агента' : 'печатаем твой стол'); };

// показать промежуточное состояние стола агента, не трогая историю
function showAgentShapes(shapes){
  const maxId = Math.max(0, ...objects.filter(o => !o.plate).map(o => o.id));
  objects = objects.filter(o => !o.plate).concat(shapes.map(o => ({
    rot:0, rx:0, rz:0, sides:6, dia:10, pitch:1.5, color:'#8fb4f7', vis:true, ...o,
    id: maxId + 1 + (o.id || 0), plate: 1})));
  sync();
}

$('stop').onclick = async () => {
  $('stop').disabled = true;
  await fetch('/agent/stop', {method:'POST', body:'{}'});
  say('останавливаем агента — доработает текущий шаг');
};

async function runAgentStream(task, onEvent){
  const r = await fetch('/agent/stream', {method:'POST', headers:{'content-type':'application/json'},
    body: JSON.stringify({task, scene: objects.filter(o => o.plate).map(({plate, ...o}) => o),
                          model: model.value, base_url: base.value, key: key.value,
                          max_steps: +$('max-steps').value || 10})});
  if(!r.ok || !r.body) throw new Error('сервер не отдал поток: ' + r.status);
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '', last = null;
  for(;;){
    const {value, done} = await reader.read();
    if(done) break;
    buf += dec.decode(value, {stream:true});
    const parts = buf.split('\n\n'); buf = parts.pop();
    for(const p of parts){
      const line = p.replace(/^data: /, '').trim();
      if(!line) continue;
      let ev; try{ ev = JSON.parse(line); }catch(e){ continue; }
      if(ev.type === 'done' || ev.type === 'error') last = ev; else onEvent(ev);
    }
  }
  if(!last) throw new Error('поток оборвался');
  return last;
}

$('take').onclick = () => {
  const theirs = objects.filter(o => o.plate);
  if(!theirs.length) return say('у агента пусто', 'err');
  push();
  const mine = objects.filter(o => !o.plate && o.vis);
  const right = mine.length ? Math.max(...mine.map(o => o.x + o.w/2)) : -1e9;
  const left = Math.min(...theirs.map(o => o.x - o.w/2));
  const shift = mine.length ? +(right + 10 - left).toFixed(1) : 0;
  const grp = 'g' + Date.now();
  objects = objects.filter(o => !o.plate)
    .concat(theirs.map(o => ({...o, plate:0, grp, x: +(o.x + shift).toFixed(2)})));
  selId = null; sync();
  say(`забрано со стола агента: ${theirs.length} · двигаются вместе, «Разгруппировать» разрывает связь`, 'ok');
};

// Деталь — это связка касающихся тел, поэтому в группу берём не всё подряд,
// а всё, что реально соединено с выбранной фигурой.
function connectedTo(start){
  const boxOf = o => { const m = meshOf(o.id); if(!m) return null;
    m.updateMatrixWorld(); return new THREE.Box3().setFromObject(m).expandByScalar(0.2); };
  const pool = objects.filter(o => o.vis && (o.plate || 0) === (start.plate || 0));
  const boxes = new Map(pool.map(o => [o.id, boxOf(o)]));
  const got = [start];
  for(let i = 0; i < got.length; i++){
    const b = boxes.get(got[i].id); if(!b) continue;
    for(const o of pool){
      if(got.includes(o)) continue;
      const b2 = boxes.get(o.id);
      if(b2 && b.intersectsBox(b2)) got.push(o);
    }
  }
  return got;
}

$('group').onclick = () => {
  const o = sel();
  if(!o) return say('выбери любую часть детали', 'err');
  const part = connectedTo(o);
  if(part.length < 2) return say('эта фигура ни с чем не соединена — двигать нечего вместе', 'err');
  const grp = 'g' + Date.now();
  push(); part.forEach(x => x.grp = grp); sync();
  say(`связано тел: ${part.length} · теперь двигаются вместе`, 'ok');
};

$('ungroup').onclick = () => {
  const o = sel(); if(!o) return say('выбери фигуру', 'err');
  if(!o.grp) return say('фигура и так сама по себе');
  const n = objects.filter(x => x.grp === o.grp).length;
  push(); objects.forEach(x => { if(x.grp === o.grp) delete x.grp; });
  sync(); say(`группа из ${n} тел разорвана`);
};
$('wipe-agent').onclick = () => {
  if(!objects.some(o => o.plate)) return say('у агента пусто');
  push(); objects = objects.filter(o => !o.plate); selId = null; sync(); say('стол агента очищен');
};

$('gen').onclick = async e => {
  const btn = e.currentTarget, task = $('ai').value.trim();
  if(!task) return say('опиши деталь', 'err');
  const done = busy(btn, t('думает…')); say(`${model.value} ${t('думает…')}`);
  try{
    if($('agent').checked && prov.value !== 'anthropic'){
      agentBusy = true; $('stop').disabled = false; updatePlateOption(); focusPlate(PLATE_GAP);
      const j = await runAgentStream(task, ev => {
        if(ev.type === 'thinking'){ say(`агент думает… шаг ${ev.step + 1}`); return; }
        if(ev.type !== 'tool') return;
        const names = {add_shape:'ставит', update_shape:'правит', delete_shape:'убирает',
                       get_scene:'смотрит сцену', check:'проверяет', finish:'заканчивает'};
        say(`агент ${names[ev.tool] || ev.tool} ${ev.args?.name || ''}`.trim());
        if(ev.shapes) showAgentShapes(ev.shapes);        // деталь растёт на глазах
      });
      agentBusy = false; $('stop').disabled = true; markPlates();
      if(j.error) throw new Error(j.error);
      push();
      const maxId = Math.max(0, ...objects.map(o => o.id));
      const got = j.objects.map(o => ({rot:0, rx:0, rz:0, sides:6, dia:10, pitch:1.5,
        color:'#8fb4f7', vis:true, ...o, id: maxId + 1 + o.id, plate: 1}));
      // агент не знает про два стола — ставим его деталь по центру своей плиты
      const solid = got.filter(o => !o.hole);
      if(solid.length){
        const cx = (Math.min(...solid.map(o => o.x - o.w/2)) + Math.max(...solid.map(o => o.x + o.w/2)))/2;
        const cy = (Math.min(...solid.map(o => o.y - o.d/2)) + Math.max(...solid.map(o => o.y + o.d/2)))/2;
        got.forEach(o => { o.x = +(o.x - cx).toFixed(2); o.y = +(o.y - cy).toFixed(2); });
      }
      objects = objects.filter(o => !o.plate).concat(got);
      nextId = Math.max(0, ...objects.map(o => o.id)) + 1;
      selId = null; sync(); loadLog(); addTokens(j.usage);
      const steps = j.steps_used ?? j.trace.filter(t => t.tool).length;
      const bodies = j.objects.filter(o => !o.hole).length;
      const REASON = {
        finished: [`деталь готова · тел ${bodies}` + (j.template ? ' · по шаблону, без запроса к модели'
                                                    : ` · шагов ${steps}`), 'ok'],
        stopped:  [`остановлено тобой · тел ${bodies}, шагов ${steps} — деталь не доделана`, ''],
        max_steps:[`кончились шаги (${steps}) · тел ${bodies} — деталь может быть не доделана,`
                   + ' подними лимит и повтори', 'err'],
        failed_check: [`агент закончил, но деталь с браком · тел ${bodies}`, 'err'],
      };
      const [text, kind] = REASON[j.reason] || [`готово · шагов ${steps}`, 'ok'];
      say(text + (j.problems.length ? ` · ${j.problems[0]}` : ''), j.problems.length ? 'err' : kind);
      done();
      return;
    }
    const text = await askAi(PROMPT + task);
    const blocks = text.match(/\{[\s\S]*\}/g) || [];
    const parsed = blocks.map(b => { try{ return JSON.parse(b); }catch(e){ return null; } })
                         .filter(x => Array.isArray(x?.objects)).pop();
    if(!parsed) throw new Error('модель вернула не JSON: ' + text.slice(0, 120));
    const {list, dropped} = sanitize(parsed.objects);
    push();
    list.forEach(o => objects.push({...o, id: nextId++, color:'#3fae8c', rx:0, rz:0, vis:true}));
    selId = null; sync(); loadLog();
    say(`добавлено фигур: ${list.length}` +
        (dropped.length ? ` · выброшены отверстия крупнее детали: ${dropped.join(', ')}` : ''),
        dropped.length ? 'err' : 'ok');
  }catch(err){ say('AI: ' + err.message, 'err'); loadLog(); }
  done();
};

// ---------- шестерни ----------
// Колесо задают два числа: z (зубьев) и m (модуль, мм). Всё остальное из них следует,
// поэтому шестерню нельзя тянуть за размер — изменится модуль, и пара перестанет цепляться.
function gearInfo(){
  const z = Math.max(6, Math.min(200, Math.round(+$('g-z').value || 17)));
  const m = Math.max(.3, Math.min(10, +$('g-m').value || 2));
  const g = gearSketch(z, m);
  $('gear-hint').textContent =
    `Ø${g.size} мм внешний · делительный ${g.pitch} · с такой же ось на ${g.pitch} мм`;
  return {z, m, g};
}
['g-z', 'g-m'].forEach(id => $(id).oninput = gearInfo);
gearInfo();

$('gear').onclick = () => {
  const {z, m, g} = gearInfo();
  add('sketch', {pts: g.pts, name: `Шестерня z${z} m${m}`, w: g.size, d: g.size, h: 6});
  showTab('props');
  say(`шестерня z${z} m${m} · Ø${g.size} мм · размер не меняй, иначе не зацепится`, 'ok');
};

// Скруглённая площадка. Полноценного fillet по всем рёбрам в CSG нет,
// но скругление в плане закрывает большинство корпусов и накладок.
function rrectInfo(){
  const w = Math.max(4, +$('r-w').value || 60), d = Math.max(4, +$('r-d').value || 40);
  const g = roundedRect(w, d, Math.max(.5, +$('r-r').value || 8));
  $('rrect-hint').textContent = +$('r-r').value > Math.min(w, d) / 2
    ? `радиус больше половины стороны — обрезан до ${g.r.toFixed(1)} мм`
    : `${w}×${d} мм, углы R${g.r.toFixed(1)}`;
  return {w, d, g};
}
['r-w', 'r-d', 'r-r'].forEach(id => $(id).oninput = rrectInfo);
rrectInfo();

$('rrect').onclick = () => {
  const {w, d, g} = rrectInfo();
  add('sketch', {pts: g.pts, name: `Площадка ${w}×${d} R${g.r.toFixed(1)}`,
                 w: g.size, d: g.size, h: 5});
  showTab('props');
  say(`площадка ${w}×${d} мм со скруглением R${g.r.toFixed(1)}`, 'ok');
};

// ---------- библиотека эскизов ----------
// эскизы живут в базе; здесь их копия, чтобы renderLib оставалась синхронной
let lib = [];
const libGet = () => lib;
async function libReload(){
  try{ lib = (await (await fetch('/api/state')).json()).sketches || []; }catch(e){ lib = []; }
  renderLib();
}
async function libAdd(s){
  const r = await fetch('/api/sketches', {method:'POST', headers:{'content-type':'application/json'},
                                          body: JSON.stringify(s)});
  if(!r.ok) throw new Error('сервер не принял эскиз');
  await libReload();
}
async function libDel(id){
  await fetch('/api/sketches/' + id, {method:'POST'});
  await libReload();
}

function sketchSvg(pts){
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${(p[0]*100).toFixed(1)} ${(-p[1]*100).toFixed(1)}`).join(' ') + ' Z';
  return `<svg viewBox="-60 -60 120 120"><path d="${d}" fill="#3fae8c33" stroke="#3fae8c" stroke-width="3"/></svg>`;
}
function renderLib(){
  const box = $('lib'), l = libGet(); box.innerHTML = '';
  $('lib-empty').hidden = l.length > 0;
  l.forEach((it, i) => {
    const c = document.createElement('div');
    c.className = 'card';
    c.innerHTML = sketchSvg(it.pts) + `<div class="t">${esc(it.name)}</div><button class="x" title="удалить">✕</button>`;
    c.onclick = () => {
      add('sketch', {pts: it.pts.map(p => p.slice()), name: it.name,
                     w: it.w, d: it.d, h: it.h || 10, x: 0, y: 0});
      showTab('props'); say('поставлен эскиз: ' + it.name);
    };
    c.querySelector('.x').onclick = e => { e.stopPropagation();
      libDel(it.id).then(() => say('эскиз удалён')); };
    box.appendChild(c);
  });
}
$('lib-add').onclick = () => {
  const o = sel();
  if(!o || o.type !== 'sketch') return say('выбери эскиз на сцене или в списке объектов', 'err');
  const name = prompt('Имя эскиза:', o.name); if(!name) return;
  libAdd({name, pts: o.pts.map(p => p.slice()), w: o.w, d: o.d, h: o.h})
    .then(() => say('эскиз сохранён: ' + name, 'ok'))
    .catch(err => say(err.message, 'err'));
};
$('lib-export').onclick = () => {
  download(new Blob([JSON.stringify(libGet())], {type:'application/json'}), 'sketches.pen3d.json');
  say('библиотека выгружена', 'ok');
};
$('lib-import').onclick = () => $('libfile').click();
$('libfile').onchange = async e => {
  const f = e.target.files[0]; if(!f) return;
  try{
    const l = JSON.parse(await f.text());
    if(!Array.isArray(l)) throw new Error('это не библиотека эскизов');
    const good = l.filter(x => Array.isArray(x?.pts));
    for(const it of good) await libAdd(it);
    say(`добавлено эскизов: ${good.length}`, 'ok');
  }catch(err){ say('импорт не удался: ' + err.message, 'err'); }
  e.target.value = '';
};

// Долгие операции (запрос к модели, слайсинг) шли со статичной подписью на кнопке,
// и через полминуты это выглядело как зависание. Здесь кнопка пульсирует и считает секунды.
function busy(btn, label){
  const was = btn.textContent;
  const t0 = Date.now();
  btn.disabled = true; btn.classList.add('busy');
  const tick = () => btn.textContent = `${label} ${Math.round((Date.now() - t0) / 1000)} с`;
  tick();
  const id = setInterval(tick, 1000);
  return () => { clearInterval(id); btn.classList.remove('busy'); btn.disabled = false; btn.textContent = was; };
}

// ---------- история версий ----------
// Снимок пишется сервером не чаще раза в пять минут и только при изменениях,
// поэтому список остаётся коротким даже после часа работы.
async function renderHistory(){
  const box = $('hist-box');
  try{
    const rows = (await (await fetch('/api/history')).json()).rows || [];
    box.innerHTML = rows.length ? '' : '<div class="none">пока нет ни одной версии</div>';
    for(const r of rows){
      const el = document.createElement('div');
      el.className = 'v';
      el.innerHTML = `<b>${esc(r.ts.slice(5, 16))}</b><span>${r.bodies} тел · ${esc(r.note || '')}</span>`;
      el.onclick = async () => {
        if(!confirm(`Вернуть сцену на ${r.ts}? Текущая тоже попадёт в историю.`)) return;
        const j = await (await fetch('/api/history', {method:'POST', headers:{'content-type':'application/json'},
                                                     body: JSON.stringify({restore: r.id})})).json();
        if(j.error) return say(j.error, 'err');
        restore(j.scene); renderHistory(); say('сцена возвращена на ' + r.ts, 'ok');
      };
      box.appendChild(el);
    }
  }catch(e){ box.innerHTML = '<div class="none">история недоступна</div>'; }
}
$('history').onclick = () => {
  const box = $('hist-box'), show = box.hidden;
  box.hidden = !show;
  $('history').textContent = show ? 'Скрыть историю' : 'История версий';
  if(show) renderHistory();
};

// ---------- камера ----------
// Поток открывается только по кнопке: пока img без src, принтер его не отдаёт.
$('cam-toggle').onclick = () => {
  const box = $('cam-box'), img = $('cam'), on = box.hidden;
  box.hidden = !on;
  $('cam-toggle').textContent = on ? 'Скрыть камеру' : 'Показать камеру';
  if(on){
    $('cam-hint').textContent = 'подключаюсь к камере…';
    img.src = '/camera?' + Date.now();
  }else{
    img.removeAttribute('src');   // иначе браузер продолжит тянуть поток в фоне
  }
};
$('cam').onload = () => $('cam-hint').textContent = 'поток с принтера, ~1 кадр в 2 секунды';
$('cam').onerror = () => $('cam-hint').textContent = 'камера не отвечает — принтер спит или занят';

// ---------- размеры в сцене ----------
const labels = $('labels');
let hudAt = [-1, -1], hudOff = false;
const pool = [];
function label(i, text, v, cls){
  let el = pool[i];
  if(!el){ el = document.createElement('div'); labels.appendChild(el); pool[i] = el; }
  const p = v.clone().project(cam);
  if(p.z > 1){ el.style.display = 'none'; return; }
  el.style.display = ''; el.className = cls || '';
  el.textContent = text;
  const x = (p.x * .5 + .5) * labels.clientWidth, y = (-p.y * .5 + .5) * labels.clientHeight;
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  placed.push({el, x, y});
}

// У мелкой детали все подписи проецируются почти в одну точку: «в детали 5.5 мм»
// и «снаружи 1.5 мм» отличались на пиксель и читались как каша. Разводим по вертикали.
const ROW = 15;
function spread(){
  placed.sort((a, b) => a.y - b.y);
  for(let i = 1; i < placed.length; i++){
    const cur = placed[i];
    for(let j = 0; j < i; j++){
      const prev = placed[j];
      if(Math.abs(cur.x - prev.x) < 70 && cur.y - prev.y < ROW){
        cur.y = prev.y + ROW;
        cur.el.style.top = cur.y + 'px';
      }
    }
  }
}
const placed = [];
const V = (x,y,z) => new THREE.Vector3(x,y,z);
function drawLabels(){
  let i = 0;
  placed.length = 0;
  const half = BED/2;
  // разметка стола
  for(const t of [-half, -half/2, 0, half/2, half]){
    label(i++, `${t}`, V(t, 0, half + 8), 'bed');
    label(i++, `${-t}`, V(-half - 8, 0, t), 'bed');
  }
  // подписи столов: видно, какой печатается
  const act = printPlate();
  const plate = $('bed').selectedOptions[0]?.textContent || '';
  label(i++, act === 0 ? `МОЙ СТОЛ · ${plate} · в печать` : 'мой стол',
        V(0, 0, -BED/2 - 14), act === 0 ? '' : 'bed');
  label(i++, act === 1 ? 'СТОЛ АГЕНТА · в печать' : 'стол агента',
        V(PLATE_GAP, 0, -BED/2 - 14), act === 1 ? '' : 'bed');

  // мини-панель висит над выбранной фигурой, чтобы не бегать в угол сцены
  const hud = $('hud'), selHud = sel(), mHud = selHud && meshOf(selHud.id);
  // прячем на время перетаскивания: панель прыгала бы за фигурой и мешала целиться
  if(mHud && mHud.visible && !sketching && !gizmo.dragging && !hudOff){
    mHud.updateMatrixWorld();
    const b = new THREE.Box3().setFromObject(mHud), c = new THREE.Vector3();
    b.getCenter(c);
    const p = new THREE.Vector3(c.x, b.max.y, c.z).project(cam);
    const pc = c.clone().project(cam);
    if(p.z < 1){                                  // z > 1 — точка за камерой, координаты переворачиваются
      const W = labels.clientWidth, H = labels.clientHeight;
      const half = (hud.offsetWidth || 150) / 2;
      const x = Math.round(Math.min(W - half - 6, Math.max(half + 6, (p.x*.5 + .5) * W)));
      // гизмо рисуется постоянного экранного размера, поэтому его верх считаем от центра
      // фигуры в пикселях, а не в миллиметрах: панель должна быть выше всех стрелок
      const yTop = (-p.y*.5 + .5) * H - 62;
      const yGizmo = (-pc.y*.5 + .5) * H - 184;
      const y = Math.round(Math.min(H - 8, Math.max(46, Math.min(yTop, yGizmo))));
      hud.hidden = false;
      if(x !== hudAt[0] || y !== hudAt[1]){       // без этого каждый кадр дёргается раскладка
        hud.style.left = x + 'px'; hud.style.top = y + 'px';
        hudAt = [x, y];
      }
    } else hud.hidden = true;
  } else hud.hidden = true;

  // глубина захода отверстия
  const selObj = sel();
  if(ghostDepth && selObj && selObj.hole){
    const c = ghostDepth.center, s2 = ghostDepth.size;
    label(i++, `в детали ${s2.y.toFixed(1)} мм`, V(c.x, ghostDepth.top + 4, c.z));
    const out = selObj.h - s2.y;
    if(out > 0.2) label(i++, `снаружи ${out.toFixed(1)} мм`,
                        V(c.x, selObj.z + selObj.h + 3, c.z), 'bed');
  } else if(selObj && selObj.hole && selObj.vis && !showResult){
    const m = meshOf(selObj.id);
    if(m) label(i++, 'не задевает деталь', V(m.position.x, m.position.y + selObj.h/2 + 4, m.position.z));
  }

  // размеры выбранного объекта
  const o = sel(), m = o && meshOf(o.id);
  if(m && m.visible){
    const b = new THREE.Box3().setFromObject(m), c = new THREE.Vector3(), sz = new THREE.Vector3();
    b.getCenter(c); b.getSize(sz);
    label(i++, `${sz.x.toFixed(1)} мм`, V(c.x, b.min.y, b.max.z + 3));
    label(i++, `${sz.z.toFixed(1)} мм`, V(b.max.x + 3, b.min.y, c.z));
    label(i++, `${sz.y.toFixed(1)} мм`, V(b.max.x + 3, c.y, b.max.z + 3));
    if(o.z > 0.05) label(i++, `↑ ${o.z} мм`, V(b.min.x - 3, o.z/2, b.max.z));
  }

  if(measurePts.length === 2){
    const [a, bb] = measurePts, mid = a.clone().add(bb).multiplyScalar(.5);
    label(i++, `${a.distanceTo(bb).toFixed(2)} мм`, mid, 'measure');
  }
  for(; i < pool.length; i++) pool[i].style.display = 'none';
  spread();
}

// сетка густеет по мере приближения камеры — на весь стол частые деления были бы
// муаром, а мелкую деталь без них не разметить. Так же ведут себя Blender/Fusion.
function updateGridLOD(){
  const dist = cam.position.distanceTo(orbit.target);
  for(const p of plates){
    p.g5.visible = dist < 120;
    p.g1.visible = dist < 30;
  }
}

// ---------- линейки по краям — как в Figma, но привязаны к столу (мировые X/Z через
// плоскость Y=0, та же, что размечена краевыми подписями 128/64/0/-64/-128), а не к
// камере: подвинул вид — числа остались на месте, а не переехали вместе с фокусом.
// Точны в орто-видах (Сверху/Спереди/Сбоку); в свободном 3D — приближённо, как и
// любая линейка в перспективе без единого масштаба на весь экран.
const rulerX = $('ruler-x'), rulerY = $('ruler-y');
const rxCtx = rulerX.getContext('2d'), ryCtx = rulerY.getContext('2d');
const RULER_BG = getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#16181d';
const RULER_DIM = getComputedStyle(document.documentElement).getPropertyValue('--dim').trim() || '#8a909b';
const NICE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
const niceStep = (pxPerUnit, targetPx) => NICE_STEPS.find(s => s * pxPerUnit >= targetPx) || 1000;
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const rulerRay = new THREE.Raycaster();
function toGround(ndcX, ndcY){
  rulerRay.setFromCamera({x: ndcX, y: ndcY}, cam);
  const hit = new THREE.Vector3();
  return rulerRay.ray.intersectPlane(groundPlane, hit) ? hit : null;
}

function drawRulers(){
  const W = view.clientWidth, H = view.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if(rulerX.width !== Math.round(W*dpr)){ rulerX.width = W*dpr; rulerX.height = 20*dpr;
    rulerX.style.width = W+'px'; rulerX.style.height = '20px'; }
  if(rulerY.height !== Math.round(H*dpr)){ rulerY.width = 22*dpr; rulerY.height = H*dpr;
    rulerY.style.width = '22px'; rulerY.style.height = H+'px'; }
  rxCtx.setTransform(dpr,0,0,dpr,0,0); ryCtx.setTransform(dpr,0,0,dpr,0,0);

  rxCtx.clearRect(0, 0, W, 20); rxCtx.fillStyle = RULER_BG; rxCtx.fillRect(0, 0, W, 20);
  ryCtx.clearRect(0, 0, 22, H); ryCtx.fillStyle = RULER_BG; ryCtx.fillRect(0, 0, 22, H);
  rxCtx.strokeStyle = ryCtx.strokeStyle = RULER_DIM;
  rxCtx.fillStyle = ryCtx.fillStyle = RULER_DIM;
  rxCtx.font = ryCtx.font = '10px ui-monospace,monospace';

  // опорная точка — центр экрана на плоскости стола; относительно нее меряем
  // локальный масштаб (мм/пиксель), а сами деления кладём на круглые мировые X/Z
  const center = toGround(0, 0);
  if(!center) return;   // смотрим мимо стола (в небо) — мерить нечему
  const dx = toGround(20 / W, 0), dy = toGround(0, 20 / H);
  const pxPerMmX = dx ? 20 / Math.max(1e-6, Math.abs(dx.x - center.x)) : 0;
  const pxPerMmY = dy ? 20 / Math.max(1e-6, Math.abs(dy.z - center.z)) : 0;

  // в перспективе мировой шаг X/Z в пикселях неравномерен по экрану — единой линейкой
  // это не нарисовать честно. Смотрим напрямую, куда направлена камера: если это не
  // почти строго сверху и не почти строго вдоль X/Z (виды Сверху/Спереди/Сбоку,
  // не важно как их достигли — кнопкой или довернули орбитой) — деления не рисуем
  const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
  const axisAligned = Math.abs(dir.y) > .97 || Math.abs(dir.x) > .97 || Math.abs(dir.z) > .97;
  const tooTiltedX = !axisAligned, tooTiltedY = !axisAligned;

  if(pxPerMmX > .3 && !tooTiltedX){
    const step = niceStep(pxPerMmX, 55);
    const from = Math.floor((center.x - W/2/pxPerMmX) / step) * step;
    const to = center.x + W/2/pxPerMmX;
    rxCtx.beginPath();
    for(let v = from, i = 0; v <= to; v += step, i++){
      const s = new THREE.Vector3(v, 0, center.z).project(cam);
      const x = (s.x * .5 + .5) * W, major = i % 5 === 0;
      rxCtx.moveTo(x, 20); rxCtx.lineTo(x, major ? 9 : 14);
      if(major) rxCtx.fillText(String(Math.round(v)), x + 2, 9);
    }
    rxCtx.stroke();
  }
  if(pxPerMmY > .3 && !tooTiltedY){
    const step = niceStep(pxPerMmY, 55);
    const from = Math.floor((center.z - H/2/pxPerMmY) / step) * step;
    const to = center.z + H/2/pxPerMmY;
    ryCtx.beginPath();
    for(let v = from, i = 0; v <= to; v += step, i++){
      const s = new THREE.Vector3(center.x, 0, v).project(cam);
      const y = (-s.y * .5 + .5) * H, major = i % 5 === 0;
      ryCtx.moveTo(22, y); ryCtx.lineTo(major ? 8 : 13, y);
      if(major){ ryCtx.save(); ryCtx.translate(11, y - 2); ryCtx.rotate(-Math.PI/2);
        ryCtx.fillText(String(Math.round(v)), 0, 0); ryCtx.restore(); }
    }
    ryCtx.stroke();
  }
}

// ---------- цикл ----------
function loop(){
  const w = view.clientWidth, h = view.clientHeight, dpr = renderer.getPixelRatio();
  if(!w || !h){ requestAnimationFrame(loop); return; }
  if(view.width !== Math.round(w*dpr) || view.height !== Math.round(h*dpr)){
    renderer.setSize(w, h, false); cam.aspect = w/h; cam.updateProjectionMatrix(); }
  requestAnimationFrame(loop);
  stepFly(); stepPulse(); orbit.update(); updateGridLOD(); saveCam(); renderer.render(scene, cam);
  try{ drawLabels(); drawRulers(); }catch(e){ window.__lastErr = e.message + ' @ ' + (e.stack||'').split('\n')[1]; }
}
// всё состояние приезжает из базы одним запросом
// Разовый переезд: что лежало в localStorage до появления базы, заливаем в базу.
async function migrateLocal(st){
  if(st.scene) return st;
  let moved = 0;
  try{
    if(localStorage.pen3d){
      const d = JSON.parse(localStorage.pen3d);
      if(Array.isArray(d?.objects) && d.objects.length){
        await fetch('/api/scene', {method:'POST', headers:{'content-type':'application/json'},
                                   body: localStorage.pen3d});
        st.scene = d; moved += d.objects.length;
      }
    }
    for(const it of JSON.parse(localStorage.pen3dLib || '[]')){
      if(Array.isArray(it?.pts)){ await libAdd(it); moved++; }
    }
    if(localStorage.tokens){
      const t = JSON.parse(localStorage.tokens);
      if(t?.calls){ Object.assign(tok, t); await saveTokens(); st.tokens = t; }
    }
  }catch(e){ say('перенос старых данных не удался: ' + e.message, 'err'); }
  if(moved) say(`перенесено в базу: ${moved}`, 'ok');
  return moved ? await (await fetch('/api/state')).json() : st;
}

async function boot(){
  try{
    let st = await (await fetch('/api/state')).json();
    st = await migrateLocal(st);
    if(st.scene) restore(st.scene);
    lib = st.sketches || [];
    Object.assign(tok, st.tokens || {});
  }catch(e){ say('база недоступна, работаем без сохранения: ' + e.message, 'err'); }
  renderLib(); showTokens(); sync();
}
restoreCam(); boot(); markPlates(); loop();
// Копим задачи, из-за которых интерфейс замирал дольше 50 мс: зависания плавающие,
// и без записи момент не поймать. Смотреть: window.__long
window.__long = [];
try{
  new PerformanceObserver(list => {
    for(const e of list.getEntries())
      window.__long.push({мс: Math.round(e.duration), когда: new Date().toLocaleTimeString('ru')});
    if(window.__long.length > 20) window.__long.splice(0, window.__long.length - 20);
  }).observe({entryTypes: ['longtask']});
}catch(e){}

window.__dbg = () => ({objects, selId, долгиеЗадачи: window.__long.slice(-5), hist: hist.length, redo: redoStack.length, meshes: raw.children.length,
  result: !!resultMesh, plate: printPlate(),
  ghost: ghostDepth && {depth:+ghostDepth.size.y.toFixed(2), top:+ghostDepth.top.toFixed(2)}, cam: [+cam.position.x.toFixed(1), +orbit.target.x.toFixed(1)]});
