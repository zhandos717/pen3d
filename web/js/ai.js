export const PROMPT = `Ты — инженер-конструктор. Собери деталь для FDM-печати из примитивов и верни ТОЛЬКО JSON:
{"objects":[{"name":"основание","type":"box","x":0,"y":0,"z":0,"w":60,"d":40,"h":4,"rot":0,"hole":false}]}

Поля: type — box | cyl | poly | thread | sphere | cone | wedge. Всё в миллиметрах.
poly — призма, "sides":6 даёт шестигранник (размер под ключ = w = d).
thread — НАСТОЯЩАЯ метрическая резьба: {"type":"thread","dia":14,"pitch":2,"h":40}. Ширину w/d у неё не задают.
  Шаг по ГОСТ: M6→1, M8→1.25, M10→1.5, M12→1.75, M14→2, M16→2. Гнездо под резьбу — та же thread с hole:true и dia на 0.2 больше.
x,y — координаты ЦЕНТРА тела на столе: X вправо, Y вглубь. z — высота НИЗА тела над столом (не центра).
w — размер по X, d — по Y, h — вверх. rot — поворот вокруг вертикали, градусы.
hole:true — тело не печатается, а ВЫЧИТАЕТСЯ из остальных: так делают отверстия, пазы, полости.

Правила, нарушение которых делает деталь браком:
1. Тела должны пересекаться или касаться, образуя одно целое. Висящих в воздухе кусков быть не должно: если z>0, под телом обязано быть другое тело.
2. Отверстие должно быть ДЛИННЕЕ стенки, которую пробивает, и торчать за неё с обеих сторон на 1-2 мм, иначе останется плёнка.
3. Стенки не тоньше 2 мм, штырьки не тоньше 3 мм, иначе сломается.
4. Полость в коробке = внешний box + внутренний box с hole:true, смещённый вверх на толщину дна.
4a. hole вычитает ВСЮ свою форму целиком. Тело-отверстие не должно быть шире или выше тела, из которого
    вычитается: цилиндр Ø24, вычтенный из короба 24×24, оставит четыре уголка вместо детали.
    Фаски и скругления делать НЕЛЬЗЯ — примитивов для них нет, просто не делай их.
4b. Шестигранная гайка = poly со sides:6 (размер под ключ = w = d) + сквозной cyl с hole:true,
    диаметр которого равен указанному размеру резьбы. Пример гайки M14:
    [{"name":"корпус","type":"poly","sides":6,"x":0,"y":0,"z":0,"w":22,"d":22,"h":12},
     {"name":"отверстие","type":"cyl","x":0,"y":0,"z":-1,"w":14.2,"d":14.2,"h":14,"hole":true}]
5. Нависания круче 45° печатаются плохо. Отверстие в вертикальной стенке делай каплевидным или квадратным, а не круглым.
6. Деталь целиком в пределах 250×250×250 мм и стоит на столе: хотя бы одно тело с z:0.
7. Никаких декоративных мелочей и отверстий, которых не просили. 3-8 тел достаточно.
8. Болт = головка poly sides:6 (w = 1.6 × диаметр резьбы, h = 0.7 × диаметр) + thread нужного диаметра
   снизу вверх от неё. Стержень болта на 14 мм — это thread с dia:14, а НЕ гладкий цилиндр.
   Пример болта M14 длиной 40:
   [{"name":"головка","type":"poly","sides":6,"x":0,"y":0,"z":0,"w":22,"d":22,"h":10},
    {"name":"стержень","type":"thread","x":0,"y":0,"z":10,"dia":14,"pitch":2,"h":40}]

Сначала кратко продумай размеры и посадочные места, потом выдай JSON последним блоком.
Деталь: `;

export const PROVIDERS = {
  deepseek:  {model:'deepseek-chat',        base:'https://api.deepseek.com',      hint:'Ключ берётся из ~/.pen3d.json (deepseek_key), либо впиши свой.'},
  openai:    {model:'gpt-4o-mini',          base:'https://api.openai.com/v1',     hint:'Любой OpenAI-совместимый сервер: OpenAI, OpenRouter, Groq, Together.'},
  ollama:    {model:'qwen2.5-coder:14b',    base:'http://127.0.0.1:11434/v1',     hint:'Ollama должна быть запущена: ollama serve. Ключ не нужен.'},
  anthropic: {model:'claude-sonnet-5',      base:'',                              hint:'Запрос идёт из браузера, ключ хранится в localStorage.'},
};

// Слабые модели стабильно косячат двумя способами: отверстие вровень со стенкой
// (остаётся плёнка) и отверстие крупнее самой детали (съедает её целиком).
export function sanitize(list){
  const TYPES = ['box','cyl','poly','thread','sphere','cone','wedge'];
  const norm = o => {
    const t = TYPES.includes(o.type) ? o.type : 'box';
    const dia = Math.max(2, +o.dia || +o.w || 10);
    return {type: t, x:+o.x||0, y:+o.y||0, z:+o.z||0,
      w: t === 'thread' ? dia : Math.max(.2, +o.w||10),
      d: t === 'thread' ? dia : Math.max(.2, +o.d||10),
      h: Math.max(.2, +o.h||10), rot:+o.rot||0,
      sides: Math.max(3, Math.min(64, +o.sides||6)),
      dia, pitch: Math.max(.3, Math.min(5, +o.pitch || Math.round(dia*.13*4)/4 || 1.5)),
      hole: !!o.hole, name: String(o.name || o.type)};
  };
  const all = list.map(norm);
  const solids = all.filter(o => !o.hole);
  const dropped = [];
  const out = all.filter(o => {
    if(!o.hole || !solids.length) return true;
    const eats = solids.every(s =>
      o.w >= s.w - .01 && o.d >= s.d - .01 && o.z <= s.z + .01 && o.z + o.h >= s.z + s.h - .01);
    if(eats) dropped.push(o.name);
    return !eats;
  }).map(o => {
    if(!o.hole) return o;
    const flush = solids.some(s => Math.abs(o.z - s.z) < .01 || Math.abs(o.z + o.h - s.z - s.h) < .01);
    return flush ? {...o, z: o.z - 1, h: o.h + 2} : o;
  });
  return {list: out, dropped};
}
