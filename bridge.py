#!/usr/bin/env python3
"""Мост браузер -> Bambu Lab A1 в LAN Mode: STL -> слайс -> FTPS -> MQTT print."""
import ftplib, json, os, socket, ssl, subprocess, sys, tempfile, time, uuid

import db
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(HERE, 'web')
CFG = os.path.expanduser('~/.pen3d.json')
STUDIO = '/Applications/BambuStudio.app/Contents/MacOS/BambuStudio'
SYS = os.path.expanduser('~/Library/Application Support/BambuStudio/system/BBL')
PRESETS = dict(
    machine=f'{SYS}/machine/Bambu Lab A1 0.4 nozzle.json',
    process=f'{SYS}/process/0.20mm Standard @BBL A1.json',
    filament=f'{SYS}/filament/Bambu PLA Basic @BBL A1.json',
)


BED = 256

SHAPE_TYPES = ['box', 'cyl', 'poly', 'sphere', 'cone', 'wedge', 'thread']

TOOLS = [
    {'type': 'function', 'function': {
        'name': 'add_shape',
        'description': 'Поставить тело на стол. Возвращает id. Для thread задают dia и pitch, а не w/d.',
        'parameters': {'type': 'object', 'properties': {
            'name': {'type': 'string'},
            'type': {'type': 'string', 'enum': SHAPE_TYPES},
            'x': {'type': 'number', 'description': 'центр по X, мм'},
            'y': {'type': 'number', 'description': 'центр по Y (вглубь стола), мм'},
            'z': {'type': 'number', 'description': 'низ тела над столом, мм'},
            'w': {'type': 'number'}, 'd': {'type': 'number'}, 'h': {'type': 'number'},
            'rot': {'type': 'number'}, 'sides': {'type': 'integer'},
            'dia': {'type': 'number'}, 'pitch': {'type': 'number'},
            'hole': {'type': 'boolean', 'description': 'true — тело вычитается из остальных'}},
            'required': ['name', 'type', 'h']}}},
    {'type': 'function', 'function': {
        'name': 'update_shape',
        'description': 'Изменить поля тела по id.',
        'parameters': {'type': 'object', 'properties': {
            'id': {'type': 'integer'},
            'x': {'type': 'number'}, 'y': {'type': 'number'}, 'z': {'type': 'number'},
            'w': {'type': 'number'}, 'd': {'type': 'number'}, 'h': {'type': 'number'},
            'rot': {'type': 'number'}, 'sides': {'type': 'integer'},
            'dia': {'type': 'number'}, 'pitch': {'type': 'number'}, 'hole': {'type': 'boolean'}},
            'required': ['id']}}},
    {'type': 'function', 'function': {
        'name': 'delete_shape', 'description': 'Удалить тело по id.',
        'parameters': {'type': 'object', 'properties': {'id': {'type': 'integer'}}, 'required': ['id']}}},
    {'type': 'function', 'function': {
        'name': 'get_scene', 'description': 'Список тел с габаритами и общий размер детали.',
        'parameters': {'type': 'object', 'properties': {}}}},
    {'type': 'function', 'function': {
        'name': 'check',
        'description': 'Проверить деталь: связность, висящие в воздухе тела, отверстия крупнее детали, выход за стол, тонкие стенки.',
        'parameters': {'type': 'object', 'properties': {}}}},
    {'type': 'function', 'function': {
        'name': 'finish', 'description': 'Деталь готова и check не нашёл проблем.',
        'parameters': {'type': 'object', 'properties': {'summary': {'type': 'string'}}, 'required': ['summary']}}},
]

AGENT_PROMPT = """Ты инженер-конструктор. Собираешь деталь для FDM-печати из примитивов через инструменты.

Оси: X вправо, Y вглубь стола, z — высота НИЗА тела над столом. Всё в миллиметрах, стол 256x256.
Типы: box, cyl (цилиндр), poly (призма, sides граней), sphere, cone, wedge (клин),
thread (настоящая метрическая резьба: dia и pitch; шаг M6=1, M8=1.25, M10=1.5, M12=1.75, M14=2, M16=2).
hole:true — тело вычитается из остальных. Оно вычитается ЦЕЛИКОМ, поэтому не должно быть шире детали.
Фасок и скруглений нет — не пытайся делать их вычитанием, испортишь деталь.
У cyl, box, poly ВСЕГДА задавай w и d явно: для цилиндра w = d = диаметр. Пропущенный размер
молча станет 10 мм, и деталь выйдет не той, что просили.

Порядок работы: поставь тела, вызови check, исправь всё, что он нашёл, снова check, и только
после чистого check вызывай finish. Не пиши текст вместо вызова инструментов.

Требования к детали: тела образуют одно связное целое; ничего не висит в воздухе; сквозное отверстие
длиннее стенки на 1 мм с каждой стороны; стенки от 2 мм; лишних деталей не добавляй."""


def bbox(o):
    t = o.get('type')
    w = o.get('dia', o.get('w', 10)) if t == 'thread' else o.get('w', 10)
    d = o.get('dia', o.get('d', 10)) if t == 'thread' else o.get('d', 10)
    h = o.get('h', 10)
    x, y, z = o.get('x', 0), o.get('y', 0), o.get('z', 0)
    return (x - w/2, y - d/2, z, x + w/2, y + d/2, z + h)


def overlaps(a, b, gap=0.01):
    A, B = bbox(a), bbox(b)
    return all(A[i] < B[i+3] + gap and B[i] < A[i+3] + gap for i in range(3))


def scene_report(shapes):
    if not shapes:
        return {'shapes': [], 'size': None}
    solids = [o for o in shapes if not o.get('hole')]
    boxes = [bbox(o) for o in solids] or [bbox(o) for o in shapes]
    size = {'x': round(max(b[3] for b in boxes) - min(b[0] for b in boxes), 1),
            'y': round(max(b[4] for b in boxes) - min(b[1] for b in boxes), 1),
            'z': round(max(b[5] for b in boxes) - min(b[2] for b in boxes), 1)}
    return {'shapes': shapes, 'size': size}


def check_scene(shapes):
    problems = []
    solids = [o for o in shapes if not o.get('hole')]
    holes = [o for o in shapes if o.get('hole')]
    if not solids:
        return ['на столе нет ни одного тела (только отверстия)']

    # связность: тела должны касаться друг друга
    linked = {id(solids[0])}
    changed = True
    while changed:
        changed = False
        for o in solids:
            if id(o) in linked:
                continue
            if any(overlaps(o, p, 0.2) for p in solids if id(p) in linked):
                linked.add(id(o)); changed = True
    lost = [o['name'] for o in solids if id(o) not in linked]
    if lost:
        problems.append(f'тела не соединены с остальной деталью: {", ".join(lost)}')

    for o in solids:
        b = bbox(o)
        if b[2] > 0.2 and not any(p is not o and overlaps(o, p, 0.2) for p in solids):
            problems.append(f'{o["name"]} висит в воздухе на высоте {b[2]} мм')
        if b[2] < -0.01:
            problems.append(f'{o["name"]} провалилось под стол')
        if max(b[3]-b[0], b[4]-b[1]) > BED:
            problems.append(f'{o["name"]} шире стола {BED} мм')
        for k in ('w', 'd', 'h'):
            if 0 < o.get(k, 10) < 2:
                problems.append(f'{o["name"]}: размер {k}={o[k]} мм тоньше 2 мм, сломается')

    for o in holes:
        eats = solids and all(
            bbox(o)[0] <= bbox(s)[0] + .01 and bbox(o)[3] >= bbox(s)[3] - .01 and
            bbox(o)[1] <= bbox(s)[1] + .01 and bbox(o)[4] >= bbox(s)[4] - .01 for s in solids)
        if eats:
            problems.append(f'отверстие {o["name"]} накрывает деталь целиком — оно её съест')
        if not any(overlaps(o, s) for s in solids):
            problems.append(f'отверстие {o["name"]} не пересекает ни одно тело — оно бесполезно')
        for s in solids:
            if overlaps(o, s) and abs(bbox(o)[2] - bbox(s)[2]) < .01:
                problems.append(f'отверстие {o["name"]} стоит вровень с низом {s["name"]} — '
                                'опусти его на 1 мм ниже, иначе останется плёнка')
    return problems


STOP = {'flag': False}


def trim_history(messages, keep=6, limit=60000, legacy=False):
    """Историю не трогаем, пока она не станет неприлично большой.

    Замер на одной задаче: сжатие истории не окупается. Кэш префикса и так покрывает
    94-98% ввода в обоих режимах — обрезка старых сообщений его почти не ломает.
    Зато она лишает агента контекста, и он делает лишние шаги: 14 против 10."""
    if not legacy and sum(len(str(m.get('content') or '')) for m in messages) < limit:
        return messages
    if legacy:
        keep = 3
    tool_idx = [i for i, m in enumerate(messages) if m.get('role') == 'tool']
    for i in tool_idx[:-keep]:
        c = messages[i].get('content') or ''
        if len(c) > 120:
            messages[i] = dict(messages[i], content=c[:80] + ' …(свёрнуто)')
    return messages


def run_agent(task, scene, model, base, key, on_event=None, max_steps=10, legacy=False):
    """Цикл tool-use: модель строит деталь, проверяет её и правит сама.

    legacy=True воспроизводит прежнее поведение (сжатие истории, без temperature) —
    нужно только для повторения замеров расхода токенов, на основной путь не влияет."""
    import urllib.request
    shapes = [dict(o) for o in (scene or [])]
    next_id = max([o.get('id', 0) for o in shapes], default=0) + 1
    trace = []
    usage = {'prompt_tokens': 0, 'completion_tokens': 0, 'total_tokens': 0,
             'prompt_cache_hit_tokens': 0, 'prompt_cache_miss_tokens': 0, 'steps': 0}

    def call(name, args):
        nonlocal next_id
        if name == 'add_shape':
            o = {k: v for k, v in args.items() if v is not None}
            o.setdefault('type', 'box')
            if o['type'] not in SHAPE_TYPES:
                o['type'] = 'box'
            for k, dv in (('x', 0), ('y', 0), ('z', 0), ('w', 10), ('d', 10), ('h', 10),
                          ('rot', 0), ('sides', 6), ('dia', 10), ('pitch', 1.5)):
                o.setdefault(k, dv)
            o['hole'] = bool(o.get('hole'))
            if o['type'] == 'thread':
                o['w'] = o['d'] = o['dia']
            o['id'] = next_id; next_id += 1
            shapes.append(o)
            return {'id': o['id'], 'bbox': [round(v, 1) for v in bbox(o)]}
        if name == 'update_shape':
            o = next((x for x in shapes if x['id'] == args.get('id')), None)
            if not o:
                return {'error': 'нет тела с таким id'}
            o.update({k: v for k, v in args.items() if k != 'id' and v is not None})
            if o['type'] == 'thread':
                o['w'] = o['d'] = o['dia']
            return {'ok': True, 'bbox': [round(v, 1) for v in bbox(o)]}
        if name == 'delete_shape':
            before = len(shapes)
            shapes[:] = [x for x in shapes if x['id'] != args.get('id')]
            return {'deleted': before - len(shapes)}
        if name == 'get_scene':
            return scene_report(shapes)
        if name == 'check':
            p = check_scene(shapes)
            return {'ok': not p, 'problems': p}
        return {'error': 'неизвестный инструмент'}

    messages = [{'role': 'system', 'content': AGENT_PROMPT},
                {'role': 'user', 'content': f'Деталь: {task}\n\nТекущая сцена: '
                                            f'{json.dumps(scene_report(shapes), ensure_ascii=False)}'}]
    headers = {'content-type': 'application/json'}
    if key:
        headers['authorization'] = 'Bearer ' + key

    STOP['flag'] = False
    for step in range(max_steps):
        if STOP['flag']:
            trace.append({'step': step, 'stopped': True})
            break
        body = {'model': model, 'max_tokens': 4000, 'tools': TOOLS,
                'messages': trim_history(messages, legacy=legacy)}
        if not legacy:
            body['temperature'] = 0
        req = urllib.request.Request(base + '/chat/completions', headers=headers,
                                     data=json.dumps(body).encode())
        if on_event:
            on_event({'type': 'thinking', 'step': step})
        r = json.load(urllib.request.urlopen(req, timeout=180))
        u = r.get('usage') or {}
        for k in usage:
            usage[k] += u.get(k, 0)
        usage['steps'] = step + 1
        msg = r['choices'][0]['message']
        messages.append(msg)
        calls = msg.get('tool_calls') or []
        if not calls:
            text = msg.get('content') or ''
            trace.append({'step': step, 'text': text[:200]})
            messages.append({'role': 'user', 'content': 'Работай только инструментами. '
                             'Если деталь готова — вызови check, затем finish.'})
            continue
        done = False
        for c in calls:
            fn = c['function']['name']
            try:
                args = json.loads(c['function']['arguments'] or '{}')
            except json.JSONDecodeError:
                args = {}
            if fn == 'finish':
                problems = check_scene(shapes)
                if problems:
                    result = {'error': 'ещё есть проблемы, исправь их', 'problems': problems}
                else:
                    result = {'ok': True}
                    done = True
            else:
                result = call(fn, args)
            trace.append({'step': step, 'tool': fn, 'args': args, 'result': result})
            if on_event:
                on_event({'type': 'tool', 'step': step, 'tool': fn, 'args': args,
                          'result': result, 'shapes': shapes})
            messages.append({'role': 'tool', 'tool_call_id': c['id'],
                             'content': json.dumps(result, ensure_ascii=False)})
        if done:
            break

    return {'objects': shapes, 'trace': trace, 'problems': check_scene(shapes),
            'usage': usage, 'stopped': STOP['flag']}


def log_ai(model, prompt, answer, usage=None, error=None):
    """Ответы моделей копятся в базе — по ним видно, кто и как врёт."""
    task = prompt.split('Деталь: ')[-1][:400] if prompt else ''
    try:
        db.log_add(model, task, answer, usage, error)
    except Exception:
        pass


def cfg():
    with open(CFG) as f:
        return json.load(f)


def process_preset(outdir, support, infill=None, pattern=None, walls=None):
    """Поддержки и заполнение живут в профиле процесса, у CLI флагов для них нет."""
    if not (support or infill or pattern or walls):
        return PRESETS['process']
    with open(PRESETS['process']) as f:
        p = json.load(f)
    p['name'] = 'pen3d'
    if support:
        p.update(enable_support='1', support_type='tree(auto)', support_threshold_angle='30')
    if infill:
        p['sparse_infill_density'] = f'{infill}%'
    if pattern:
        p['sparse_infill_pattern'] = pattern
    if walls:
        p['wall_loops'] = str(walls)
    path = os.path.join(outdir, 'process-pen3d.json')
    with open(path, 'w') as f:
        json.dump(p, f)
    return path


def slice_stl(stl_path, outdir, support=False, infill=None, pattern=None, walls=None):
    proc = process_preset(outdir, support, infill, pattern, walls)
    r = subprocess.run([STUDIO, '--slice', '0', '--arrange', '1',
                        '--load-settings', f"{PRESETS['machine']};{proc}",
                        '--load-filaments', PRESETS['filament'],
                        '--export-3mf', 'out.3mf', '--outputdir', outdir, stl_path],
                       capture_output=True, text=True)
    out = os.path.join(outdir, 'out.3mf')
    if not os.path.exists(out):
        raise RuntimeError('слайс не удался: ' + r.stdout[-800:] + r.stderr[-800:])
    return out


class ImplicitFTP_TLS(ftplib.FTP_TLS):
    """A1 говорит по implicit TLS на 990 — ftplib умеет только explicit."""
    def __init__(self, *a, **kw):
        self._sock = None
        super().__init__(*a, **kw)

    @property
    def sock(self):
        return self._sock

    @sock.setter
    def sock(self, value):
        if value is not None and not isinstance(value, ssl.SSLSocket):
            value = self.context.wrap_socket(value)
        self._sock = value


def upload(path, name, ip, code):
    ctx = ssl._create_unverified_context()
    ftp = ImplicitFTP_TLS(context=ctx)
    ftp.connect(host=ip, port=990, timeout=30)
    ftp.login('bblp', code)
    ftp.prot_p()
    with open(path, 'rb') as f:
        ftp.storbinary(f'STOR {name}', f)
    ftp.quit()


PRINTER = {'state': {}, 'ts': 0, 'error': None, 'client': None}


def printer_watch():
    """Одно живое MQTT-соединение: копим последний отчёт принтера.
    Адрес, код и серийник берутся только из конфига — в исходнике их быть не должно."""
    if PRINTER['client']:
        return
    import paho.mqtt.client as mqtt
    c = cfg() if os.path.exists(CFG) else {}
    if not (c.get('ip') and c.get('code') and c.get('serial')):
        PRINTER['error'] = 'в ~/.pen3d.json нет ip, code или serial'
        return

    def on_connect(cl, ud, flags, rc, props=None):
        PRINTER['error'] = None if rc == 0 else f'MQTT отказал: {rc}'
        cl.subscribe(f"device/{c['serial']}/report")
        cl.publish(f"device/{c['serial']}/request",
                   json.dumps({'pushing': {'sequence_id': '1', 'command': 'pushall'}}))

    def on_message(cl, ud, msg):
        try:
            d = json.loads(msg.payload).get('print') or {}
        except (ValueError, AttributeError):
            return
        if d:
            PRINTER['state'].update(d)
            PRINTER['ts'] = time.time()

    def on_disconnect(cl, ud, *a):
        PRINTER['error'] = 'связь с принтером потеряна, переподключаюсь'

    cl = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    cl.username_pw_set('bblp', c['code'])
    cl.tls_set(cert_reqs=ssl.CERT_NONE, tls_version=ssl.PROTOCOL_TLS_CLIENT)
    cl.tls_insecure_set(True)
    cl.reconnect_delay_set(1, 30)          # принтер засыпает и рвёт связь
    cl.on_connect, cl.on_message, cl.on_disconnect = on_connect, on_message, on_disconnect
    try:
        cl.connect_async(c['ip'], 8883, 20)
        cl.loop_start()                     # paho поднимает поток демоном сам
    except OSError as e:
        PRINTER['error'] = f'принтер не отвечает: {e}'
        return
    PRINTER['client'] = cl


def printer_status():
    printer_watch()
    st = PRINTER['state']
    if not st:
        return {'online': False, 'error': PRINTER['error'] or 'жду ответа принтера'}
    ams = []
    for a in ((st.get('ams') or {}).get('ams') or []):
        for tray in a.get('tray', []):
            if tray.get('tray_type'):
                ams.append({'type': tray['tray_type'], 'color': tray.get('tray_color', '')})
    age = round(time.time() - PRINTER['ts'])
    return {
        'online': age < 120, 'age': age, 'error': PRINTER['error'],
        'state': st.get('gcode_state'), 'error_code': st.get('print_error'),
        'percent': st.get('mc_percent'), 'remaining': st.get('mc_remaining_time'),
        'layer': st.get('layer_num'), 'layers': st.get('total_layer_num'),
        'job': st.get('subtask_name') or '',
        'nozzle': st.get('nozzle_temper'), 'nozzle_target': st.get('nozzle_target_temper'),
        'bed': st.get('bed_temper'), 'bed_target': st.get('bed_target_temper'),
        'wifi': st.get('wifi_signal'), 'filament': ams,
    }


def start_print(name, ip, code, serial):
    import paho.mqtt.client as mqtt
    payload = {"print": {
        "sequence_id": "0", "command": "project_file", "param": "Metadata/plate_1.gcode",
        "url": f"file:///sdcard/{name}", "subtask_name": name.rsplit('.', 1)[0],
        "bed_type": "auto", "timelapse": False, "bed_leveling": True, "flow_cali": True,
        "vibration_cali": True, "layer_inspect": False, "use_ams": False,
        "profile_id": "0", "project_id": "0", "subtask_id": "0", "task_id": "0"}}
    c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    c.username_pw_set('bblp', code)
    c.tls_set(cert_reqs=ssl.CERT_NONE, tls_version=ssl.PROTOCOL_TLS_CLIENT)
    c.tls_insecure_set(True)
    c.connect(ip, 8883, 30)
    c.loop_start()
    info = c.publish(f'device/{serial}/request', json.dumps(payload), qos=1)
    info.wait_for_publish(10)
    time.sleep(1)
    c.loop_stop(); c.disconnect()


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('content-type', 'application/json')
        self.send_header('access-control-allow-origin', '*')
        self.send_header('access-control-allow-headers', '*')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(200, {})

    def do_GET(self):
        p = self.path.split('?')[0].rstrip('/')
        if p.endswith('/printer'):
            try:
                return self._send(200, printer_status())
            except Exception as e:
                return self._send(200, {'online': False, 'error': f'{type(e).__name__}: {e}'})
        if p.endswith('/ai-log'):
            return self.do_ai_log()
        if p == '/api/state':
            return self._send(200, {'scene': db.scene_get(), 'sketches': db.sketches(),
                                    'tokens': db.counter_get()})
        rel = self.path.split('?')[0].lstrip('/') or 'index.html'
        path = os.path.normpath(os.path.join(WEB, rel))
        if not path.startswith(WEB) or not os.path.isfile(path):
            return self._send(404, {'error': 'not found'})
        body = open(path, 'rb').read()
        ctype = {'.html': 'text/html', '.js': 'text/javascript',
                 '.css': 'text/css', '.json': 'application/json',
                 '.svg': 'image/svg+xml'}.get(os.path.splitext(path)[1], 'application/octet-stream')
        self.send_response(200)
        self.send_header('cache-control', 'no-store')
        self.send_header('content-type', ctype + '; charset=utf-8')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('content-length') or 0))
        p = self.path.rstrip('/')
        try:
            if p == '/api/scene':
                db.scene_put(json.loads(body))
                return self._send(200, {'ok': True})
            if p == '/api/sketches':
                return self._send(200, {'id': db.sketch_add(json.loads(body))})
            if p.startswith('/api/sketches/'):
                db.sketch_del(int(p.rsplit('/', 1)[1]))
                return self._send(200, {'ok': True})
            if p == '/api/tokens':
                db.counter_put(json.loads(body))
                return self._send(200, {'ok': True})
        except Exception as e:
            return self._send(500, {'error': f'{type(e).__name__}: {e}'})
        if self.path.rstrip('/').endswith('/ai'):
            return self.do_ai(json.loads(body))
        if self.path.rstrip('/').endswith('/agent/stop'):
            STOP['flag'] = True
            return self._send(200, {'ok': True})
        if self.path.rstrip('/').endswith('/agent/stream'):
            return self.do_agent_stream(json.loads(body))
        if self.path.rstrip('/').endswith('/agent'):
            return self.do_agent(json.loads(body))
        stl = body
        support = self.headers.get('x-support') == '1'
        infill = self.headers.get('x-infill')
        pattern = self.headers.get('x-pattern')
        walls = self.headers.get('x-walls')
        do_print = self.path.rstrip('/').endswith('/print')
        try:
            c = cfg()
            with tempfile.TemporaryDirectory() as td:
                sp = os.path.join(td, 'model.stl')
                open(sp, 'wb').write(stl)
                mf = slice_stl(sp, td, support, infill, pattern, walls)
                name = f'pen3d-{uuid.uuid4().hex[:6]}.3mf'
                upload(mf, name, c['ip'], c['code'])
                if do_print:
                    start_print(name, c['ip'], c['code'], c['serial'])
            self._send(200, {'ok': True, 'file': name, 'printing': do_print,
                             'support': support, 'infill': infill})
        except Exception as e:
            self._send(500, {'error': f'{type(e).__name__}: {e}'})

    def do_ai_log(self):
        self._send(200, {'rows': db.log_rows()})

    def do_agent_stream(self, req_body):
        """Шаги агента уходят в браузер по мере работы — видно, что он делает."""
        self.send_response(200)
        self.send_header('content-type', 'text/event-stream; charset=utf-8')
        self.send_header('cache-control', 'no-store')
        self.send_header('connection', 'close')
        self.end_headers()

        def push(ev):
            try:
                self.wfile.write(('data: ' + json.dumps(ev, ensure_ascii=False) + '\n\n').encode())
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                raise
        try:
            c = cfg() if os.path.exists(CFG) else {}
            base = (req_body.get('base_url') or c.get('base_url') or 'https://api.deepseek.com').rstrip('/')
            model = req_body.get('model') or c.get('model') or 'deepseek-chat'
            key = req_body.get('key') or c.get('deepseek_key') or c.get('api_key') or ''
            out = run_agent(req_body['task'], req_body.get('scene') or [], model, base, key, push,
                            int(req_body.get('max_steps') or 10))
            log_ai(model, 'Деталь: ' + req_body['task'],
                   json.dumps(out['objects'], ensure_ascii=False),
                   dict(out['usage'], steps=len(out['trace'])))
            push({'type': 'done', **out})
        except Exception as e:
            try:
                push({'type': 'error', 'error': f'{type(e).__name__}: {e}'})
            except Exception:
                pass

    def do_agent(self, req_body):
        import urllib.request
        try:
            c = cfg() if os.path.exists(CFG) else {}
            base = (req_body.get('base_url') or c.get('base_url') or 'https://api.deepseek.com').rstrip('/')
            model = req_body.get('model') or c.get('model') or 'deepseek-chat'
            key = req_body.get('key') or c.get('deepseek_key') or c.get('api_key') or ''
            out = run_agent(req_body['task'], req_body.get('scene') or [], model, base, key, None,
                            int(req_body.get('max_steps') or 10), bool(req_body.get('legacy')))
            log_ai(model, 'Деталь: ' + req_body['task'],
                   json.dumps(out['objects'], ensure_ascii=False),
                   dict(out['usage'], steps=len(out['trace'])))
            self._send(200, out)
        except urllib.error.HTTPError as e:
            err = f'HTTP {e.code}: {e.read()[:300].decode("utf-8", "replace")}'
            log_ai(req_body.get('model', '?'), req_body.get('task', ''), None, None, err)
            self._send(500, {'error': err})
        except Exception as e:
            log_ai(req_body.get('model', '?'), req_body.get('task', ''), None, None, f'{type(e).__name__}: {e}')
            self._send(500, {'error': f'{type(e).__name__}: {e}'})

    def do_ai(self, req_body):
        """OpenAI-совместимый чат: DeepSeek, любой свой base_url, локальная Ollama."""
        import urllib.request
        try:
            c = cfg() if os.path.exists(CFG) else {}
            base = (req_body.get('base_url') or c.get('base_url') or 'https://api.deepseek.com').rstrip('/')
            model = req_body.get('model') or c.get('model') or 'deepseek-chat'
            key = req_body.get('key') or c.get('deepseek_key') or c.get('api_key') or ''
            headers = {'content-type': 'application/json'}
            if key:
                headers['authorization'] = 'Bearer ' + key
            req = urllib.request.Request(
                base + '/chat/completions',
                data=json.dumps({'model': model, 'max_tokens': 16000,
                                 'messages': [{'role': 'user', 'content': req_body['prompt']}]}).encode(),
                headers=headers)
            r = json.load(urllib.request.urlopen(req, timeout=180))
            msg = r['choices'][0]['message']
            # у reasoner-моделей ответ может уехать целиком в reasoning_content
            text = msg.get('content') or msg.get('reasoning_content') or ''
            if not text.strip():
                raise RuntimeError('модель вернула пустой ответ (кончились токены на рассуждения) — '
                                   'возьми deepseek-chat или подними лимит')
            log_ai(model, req_body['prompt'], text, r.get('usage'))
            self._send(200, {'text': text, 'model': model})
        except urllib.error.HTTPError as e:
            err = f'HTTP {e.code}: {e.read()[:300].decode("utf-8", "replace")}'
            log_ai(model, req_body.get('prompt', ''), None, None, err)
            self._send(500, {'error': err})
        except Exception as e:
            log_ai(locals().get('model', '?'), req_body.get('prompt', ''), None, None, f'{type(e).__name__}: {e}')
            self._send(500, {'error': f'{type(e).__name__}: {e}'})

    def log_message(self, *a):
        pass


def selfcheck():
    """Слайсер жив и отдаёт валидный 3mf с gcode внутри."""
    import zipfile
    v = [(0,0,0),(20,0,0),(20,20,0),(0,20,0),(0,0,20),(20,0,20),(20,20,20),(0,20,20)]
    f = [(0,2,1),(0,3,2),(4,5,6),(4,6,7),(0,1,5),(0,5,4),
         (1,2,6),(1,6,5),(2,3,7),(2,7,6),(3,0,4),(3,4,7)]
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, 'cube.stl')
        with open(p, 'w') as o:
            o.write('solid c\n')
            for a, b, cc in f:
                o.write('facet normal 0 0 0\nouter loop\n')
                for i in (a, b, cc):
                    o.write('vertex %f %f %f\n' % v[i])
                o.write('endloop\nendfacet\n')
            o.write('endsolid c\n')
        mf = slice_stl(p, td)
        names = zipfile.ZipFile(mf).namelist()
        assert 'Metadata/plate_1.gcode.md5' in names, names
        print('selfcheck ok:', os.path.getsize(mf), 'байт 3mf')


if __name__ == '__main__':
    if '--selfcheck' in sys.argv:
        selfcheck(); sys.exit()
    if not os.path.exists(CFG):
        print(f'! Нет {CFG} — рисовать и качать STL можно, печать и AI не будут работать.\n'
              '  Создай: {"ip":"192.168.1.50","code":"12345678","serial":"01P00A...","deepseek_key":"sk-..."}\n'
              '  IP и Access Code — на экране A1: Settings > Network (LAN Only Mode), serial там же.')
    db.init()
    host = '0.0.0.0' if '--lan' in sys.argv else '127.0.0.1'
    port = 8765
    print(f'pen3d: http://{"127.0.0.1" if host == "127.0.0.1" else socket.gethostbyname(socket.gethostname())}:{port}'
          + ('' if host == '127.0.0.1' else '  (открыт в локальную сеть)'))
    ThreadingHTTPServer((host, port), H).serve_forever()
