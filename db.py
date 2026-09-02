"""SQLite-хранилище: сцена, библиотека эскизов, лог ИИ, расход токенов.

Соединение открывается на каждый запрос: сервер многопоточный, а sqlite-объекты
между потоками не переносятся. Для локальной нагрузки этого хватает с запасом.
"""
import json, os, sqlite3, time

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, 'pen3d.db')

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects(
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,                 -- имя проекта, показывается в списке
  data       TEXT NOT NULL,                 -- снапшот сцены: {"objects":[...],"nextId":N}
  updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sketches(
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  pts        TEXT NOT NULL,                 -- контур [[x,y],...], нормализован в [-0.5,0.5]
  w          REAL NOT NULL,                 -- габариты оригинала, мм
  d          REAL NOT NULL,
  h          REAL NOT NULL,
  created_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS ai_log(
  id     INTEGER PRIMARY KEY,
  ts     TEXT NOT NULL,
  model  TEXT,
  task   TEXT,                              -- запрос пользователя без служебного промпта
  answer TEXT,
  usage  TEXT,                              -- {"prompt_tokens":N,...} как вернула модель
  error  TEXT);

CREATE TABLE IF NOT EXISTS snapshots(
  id      INTEGER PRIMARY KEY,
  ts      TEXT NOT NULL,
  data    TEXT NOT NULL,                 -- снимок сцены целиком
  bodies  INTEGER NOT NULL,              -- тел в снимке, чтобы список читался без разбора JSON
  note    TEXT);                         -- 'авто' или причина ручного снимка

CREATE TABLE IF NOT EXISTS counters(
  name  TEXT PRIMARY KEY,                   -- 'tokens': накопленный расход за всё время
  value TEXT NOT NULL);
"""


def conn():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA journal_mode=WAL')     # агент пишет лог, пока браузер его читает
    return c


def init(migrate=True):
    with conn() as c:
        c.executescript(SCHEMA)
    if migrate:
        migrate_jsonl()


def migrate_jsonl():
    """Старый ai-log.jsonl переносится в базу один раз и остаётся лежать как есть."""
    old = os.path.join(HERE, 'ai-log.jsonl')
    if not os.path.exists(old):
        return
    with conn() as c:
        if c.execute('SELECT 1 FROM ai_log LIMIT 1').fetchone():
            return
        rows = []
        for line in open(old, encoding='utf-8'):
            if not line.strip():
                continue
            try:
                r = json.loads(line)
            except ValueError:
                continue
            rows.append((r.get('ts'), r.get('model'), r.get('task'), r.get('answer'),
                         json.dumps(r['usage']) if r.get('usage') else None, r.get('error')))
        if rows:
            c.executemany('INSERT INTO ai_log(ts,model,task,answer,usage,error) VALUES(?,?,?,?,?,?)', rows)
            print(f'перенесено записей лога из ai-log.jsonl: {len(rows)}')


now = lambda: time.strftime('%Y-%m-%d %H:%M:%S')


# ---------- сцена ----------
def scene_get(pid=1):
    with conn() as c:
        r = c.execute('SELECT data FROM projects WHERE id=?', (pid,)).fetchone()
    return json.loads(r['data']) if r else None


def scene_put(data, pid=1, name='Текущий'):
    with conn() as c:
        c.execute("""INSERT INTO projects(id,name,data,updated_at) VALUES(?,?,?,?)
                     ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at""",
                  (pid, name, json.dumps(data, ensure_ascii=False), now()))


# ---------- история версий ----------
KEEP = 30                                # снимков храним не больше
EVERY = 300                              # и не чаще раза в пять минут


def snapshot_add(data, note='авто'):
    body = json.dumps(data, ensure_ascii=False)
    with conn() as c:
        c.execute('INSERT INTO snapshots(ts,data,bodies,note) VALUES(?,?,?,?)',
                  (now(), body, len(data.get('objects', [])), note))
        c.execute('DELETE FROM snapshots WHERE id NOT IN '
                  '(SELECT id FROM snapshots ORDER BY id DESC LIMIT ?)', (KEEP,))


def snapshot_maybe(data):
    """Снимок раз в EVERY секунд и только если сцена изменилась.

    Иначе автосохранение, срабатывающее на каждое движение мыши,
    забило бы историю сотней одинаковых версий за минуту.
    """
    body = json.dumps(data, ensure_ascii=False)
    with conn() as c:
        last = c.execute('SELECT ts, data FROM snapshots ORDER BY id DESC LIMIT 1').fetchone()
    if last:
        if last['data'] == body:
            return False
        age = time.time() - time.mktime(time.strptime(last['ts'], '%Y-%m-%d %H:%M:%S'))
        if age < EVERY:
            return False
    snapshot_add(data)
    return True


def snapshots():
    with conn() as c:
        return [{'id': r['id'], 'ts': r['ts'], 'bodies': r['bodies'], 'note': r['note']}
                for r in c.execute('SELECT id,ts,bodies,note FROM snapshots ORDER BY id DESC')]


def snapshot_get(sid):
    with conn() as c:
        r = c.execute('SELECT data FROM snapshots WHERE id=?', (sid,)).fetchone()
    return json.loads(r['data']) if r else None


# ---------- эскизы ----------
def sketches():
    with conn() as c:
        return [{'id': r['id'], 'name': r['name'], 'pts': json.loads(r['pts']),
                 'w': r['w'], 'd': r['d'], 'h': r['h']}
                for r in c.execute('SELECT * FROM sketches ORDER BY id')]


def sketch_add(s):
    with conn() as c:
        cur = c.execute('INSERT INTO sketches(name,pts,w,d,h,created_at) VALUES(?,?,?,?,?,?)',
                        (s['name'], json.dumps(s['pts']), s['w'], s['d'], s.get('h', 10), now()))
        return cur.lastrowid


def sketch_del(sid):
    with conn() as c:
        c.execute('DELETE FROM sketches WHERE id=?', (sid,))


# ---------- лог ИИ ----------
def log_add(model, task, answer, usage=None, error=None):
    with conn() as c:
        c.execute('INSERT INTO ai_log(ts,model,task,answer,usage,error) VALUES(?,?,?,?,?,?)',
                  (now(), model, task, answer, json.dumps(usage) if usage else None, error))


def log_rows(limit=30):
    with conn() as c:
        rows = c.execute('SELECT * FROM ai_log ORDER BY id DESC LIMIT ?', (limit,)).fetchall()
    out = []
    for r in reversed(rows):
        out.append({'ts': r['ts'], 'model': r['model'], 'task': r['task'],
                    'answer': r['answer'][-1500:] if r['answer'] else None,
                    'usage': json.loads(r['usage']) if r['usage'] else None, 'error': r['error']})
    return out


# ---------- счётчики ----------
def counter_get(name='tokens'):
    with conn() as c:
        r = c.execute('SELECT value FROM counters WHERE name=?', (name,)).fetchone()
    return json.loads(r['value']) if r else {'in': 0, 'out': 0, 'calls': 0}


def counter_put(value, name='tokens'):
    with conn() as c:
        c.execute("""INSERT INTO counters(name,value) VALUES(?,?)
                     ON CONFLICT(name) DO UPDATE SET value=excluded.value""",
                  (name, json.dumps(value)))


def selfcheck():
    """Полный круг: запись — чтение — удаление, на временной базе."""
    global DB
    import tempfile
    DB = os.path.join(tempfile.mkdtemp(), 'test.db')
    init(migrate=False)

    assert scene_get() is None, 'пустая база не должна отдавать сцену'
    scene_put({'objects': [{'id': 1, 'name': 'Короб'}], 'nextId': 2})
    assert scene_get()['objects'][0]['name'] == 'Короб'
    scene_put({'objects': [], 'nextId': 1})
    assert scene_get()['objects'] == [], 'вторая запись должна перезаписывать, а не плодить строки'

    sid = sketch_add({'name': 'звезда', 'pts': [[0, 0], [1, 1]], 'w': 10, 'd': 20, 'h': 5})
    assert [s['name'] for s in sketches()] == ['звезда']
    assert sketches()[0]['pts'] == [[0, 0], [1, 1]], 'контур должен вернуться списком, а не строкой'
    sketch_del(sid)
    assert sketches() == []

    log_add('deepseek-chat', 'гайка М10', 'x' * 2000, {'total_tokens': 100})
    r = log_rows()[-1]
    assert r['model'] == 'deepseek-chat' and len(r['answer']) == 1500, 'длинный ответ должен обрезаться'
    assert r['usage']['total_tokens'] == 100

    assert snapshots() == [], 'история пуста на старте'
    sc = {'objects': [{'id': 1, 'name': 'Короб'}], 'nextId': 2}
    assert snapshot_maybe(sc), 'первый снимок должен создаться'
    assert not snapshot_maybe(sc), 'та же сцена второй раз в историю не идёт'
    sc2 = {'objects': [], 'nextId': 1}
    assert not snapshot_maybe(sc2), 'изменённая сцена ждёт своей минуты, а не пишется сразу'
    snapshot_add(sc2, 'вручную')
    h = snapshots()
    assert len(h) == 2 and h[0]['note'] == 'вручную', h
    assert h[0]['bodies'] == 0 and h[1]['bodies'] == 1, 'число тел считается при записи'
    assert snapshot_get(h[1]['id'])['objects'][0]['name'] == 'Короб'
    assert snapshot_get(10**6) is None, 'несуществующий снимок — None, а не падение'
    for i in range(KEEP + 5):
        snapshot_add({'objects': [{'id': i}], 'nextId': i + 1})
    assert len(snapshots()) == KEEP, f'старые снимки должны вытесняться, осталось {len(snapshots())}'

    assert counter_get() == {'in': 0, 'out': 0, 'calls': 0}, 'счётчик по умолчанию нулевой'
    counter_put({'in': 5, 'out': 7, 'calls': 1})
    assert counter_get()['out'] == 7
    print('db selfcheck ok:', DB)


if __name__ == '__main__':
    selfcheck()
