#!/usr/bin/env python3
"""Локальный агент: держит настоящее соединение с принтером (то же, что бы делал
bridge.py по HTTP), но сам достаёт команды из relay.py по исходящему WebSocket —
значит принтеру не нужен проброшенный порт и публичный IP, только исходящий доступ
в интернет. Запускать рядом с принтером, на том же Маке, что уже слайсит через
BambuStudio CLI (см. bridge.py — вся печатная логика переиспользуется отсюда, не задублирована).

Использование:
    python3 agent.py [ws://relay-host:8766]

Код пары генерируется при первом запуске и лежит в ~/.usta-agent.json — тот же код
нужно ввести на сайте, чтобы он подключился как role=site к тому же relay.
"""
import asyncio, base64, json, os, sys, traceback

import websockets

import bridge

AGENT_CFG = os.path.expanduser('~/.usta-agent.json')


def pair_code():
    if os.path.exists(AGENT_CFG):
        with open(AGENT_CFG) as f:
            c = json.load(f)
        if c.get('code'):
            return c['code']
    import secrets
    code = secrets.token_hex(16)   # 128 бит — код это пароль к печати, копипастой, не руками
    # файл с паролем — только владельцу; дефолтный umask (обычно 644) читался бы кем угодно в системе
    fd = os.open(AGENT_CFG, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump({'code': code}, f)
    return code


async def handle(cmd_id, cmd, args):
    if cmd == 'status':
        return bridge.printer_status()

    if cmd == 'print':
        c = bridge.cfg()
        stl = base64.b64decode(args['stl_b64'])
        mf, _td = bridge.sliced(stl, args.get('support', False), args.get('infill'),
                                 args.get('pattern'), args.get('walls'), None,
                                 args.get('bed', 'Textured PEI Plate'))
        name = f"usta-{os.urandom(3).hex()}.gcode.3mf"
        bridge.upload(mf, name, c['ip'], c['code'])
        if args.get('do_print'):
            bridge.start_print(name, c['ip'], c['code'], c['serial'], bridge.file_md5(mf))
        return {'ok': True, 'file': name, 'printing': bool(args.get('do_print'))}

    raise ValueError(f'неизвестная команда: {cmd}')


async def run(relay_url, code):
    print(f'agent: код пары {code} — введи его на сайте')
    while True:
        try:
            async with websockets.connect(relay_url, max_size=32 * 1024 * 1024) as ws:
                await ws.send(json.dumps({'role': 'agent', 'code': code}))
                print('agent: подключён к relay, жду напарника (сайт)')
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if 'sys' in msg:
                        print('agent:', msg['sys']); continue
                    cmd_id, cmd, args = msg.get('id'), msg.get('cmd'), msg.get('args', {})
                    try:
                        result = await handle(cmd_id, cmd, args)
                        await ws.send(json.dumps({'id': cmd_id, 'ok': True, 'result': result}))
                    except Exception as e:
                        traceback.print_exc()
                        await ws.send(json.dumps({'id': cmd_id, 'ok': False,
                                                   'error': f'{type(e).__name__}: {e}'}))
        except (websockets.ConnectionClosed, OSError) as e:
            print(f'agent: связь с relay оборвалась ({e}), переподключаюсь через 3с')
            await asyncio.sleep(3)


if __name__ == '__main__':
    url = sys.argv[1] if len(sys.argv) > 1 else 'ws://127.0.0.1:8766'
    asyncio.run(run(url, pair_code()))
