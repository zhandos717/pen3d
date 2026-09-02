#!/usr/bin/env python3
"""Мост браузер -> Bambu Lab A1 в LAN Mode: STL -> слайс -> FTPS -> MQTT print."""
import ftplib, json, os, socket, ssl, subprocess, sys, tempfile, time, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
AI_LOG = os.path.join(HERE, 'ai-log.jsonl')
CFG = os.path.expanduser('~/.pen3d.json')
STUDIO = '/Applications/BambuStudio.app/Contents/MacOS/BambuStudio'
SYS = os.path.expanduser('~/Library/Application Support/BambuStudio/system/BBL')
PRESETS = dict(
    machine=f'{SYS}/machine/Bambu Lab A1 0.4 nozzle.json',
    process=f'{SYS}/process/0.20mm Standard @BBL A1.json',
    filament=f'{SYS}/filament/Bambu PLA Basic @BBL A1.json',
)


def log_ai(model, prompt, answer, usage=None, error=None):
    """Ответы моделей копятся в ai-log.jsonl — по ним видно, кто и как врёт."""
    rec = {'ts': time.strftime('%Y-%m-%d %H:%M:%S'), 'model': model,
           'task': prompt.split('Деталь: ')[-1][:400] if prompt else '',
           'answer': answer, 'usage': usage, 'error': error}
    try:
        with open(AI_LOG, 'a') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
    except OSError:
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
        if self.path.split('?')[0].rstrip('/').endswith('/ai-log'):
            return self.do_ai_log()
        rel = self.path.split('?')[0].lstrip('/') or 'index.html'
        path = os.path.normpath(os.path.join(HERE, rel))
        if not path.startswith(HERE) or not os.path.isfile(path):
            return self._send(404, {'error': 'not found'})
        body = open(path, 'rb').read()
        ctype = {'.html': 'text/html', '.js': 'text/javascript',
                 '.css': 'text/css', '.json': 'application/json'}.get(os.path.splitext(path)[1], 'application/octet-stream')
        self.send_response(200)
        self.send_header('cache-control', 'no-store')
        self.send_header('content-type', ctype + '; charset=utf-8')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = self.rfile.read(int(self.headers['content-length']))
        if self.path.rstrip('/').endswith('/ai'):
            return self.do_ai(json.loads(body))
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
        try:
            with open(AI_LOG) as f:
                rows = [json.loads(l) for l in f if l.strip()]
        except OSError:
            rows = []
        for r in rows:
            if r.get('answer'):
                r['answer'] = r['answer'][-1500:]
        self._send(200, {'rows': rows[-30:]})

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
    host = '0.0.0.0' if '--lan' in sys.argv else '127.0.0.1'
    port = 8765
    print(f'pen3d: http://{"127.0.0.1" if host == "127.0.0.1" else socket.gethostbyname(socket.gethostname())}:{port}'
          + ('' if host == '127.0.0.1' else '  (открыт в локальную сеть)'))
    ThreadingHTTPServer((host, port), H).serve_forever()
