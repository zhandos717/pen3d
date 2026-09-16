#!/usr/bin/env python3
"""Relay для удалённого доступа: сайт (любой хостинг) <-> WebSocket <-> локальный agent.py
рядом с принтером. Сам relay печать не делает и в файлы не смотрит — просто сводит
двух живых по одному и тому же коду и пересылает сообщения как есть, в обе стороны.

Пара — ровно один agent и один site на код одновременно: значит control-канал
не разделяется между несколькими вкладками/устройствами без явной переотдачи кода,
и это единственная защита сейчас — код действует как пароль. Для реального интернета
этого мало (нет TLS, нет ограничения по времени жизни кода) — see README на будущее.
"""
import asyncio, json, secrets, sys

import websockets

ROOMS = {}   # code -> {'agent': ws | None, 'site': ws | None}


def room(code):
    return ROOMS.setdefault(code, {'agent': None, 'site': None})


async def pump(src, dst_role, code):
    """Пока src жив, шлём каждое его сообщение напарнику (или молча роняем, если тот не подключён)."""
    try:
        async for msg in src:
            dst = room(code).get(dst_role)
            if dst is not None:
                try:
                    await dst.send(msg)
                except websockets.ConnectionClosed:
                    pass
    except websockets.ConnectionClosed:
        pass


async def handler(ws):
    try:
        hello = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
    except (asyncio.TimeoutError, json.JSONDecodeError, websockets.ConnectionClosed):
        return await ws.close(code=4000, reason='нет hello в первые 10с')
    role, code = hello.get('role'), hello.get('code')
    if role not in ('agent', 'site') or not code:
        return await ws.close(code=4001, reason='hello: нужны role=agent|site и code')

    r = room(code)
    if r[role] is not None:
        return await ws.close(code=4002, reason=f'{role} с этим кодом уже подключён')
    r[role] = ws
    other = 'site' if role == 'agent' else 'agent'
    print(f'+ {role} код={code} (напарник {"на связи" if r[other] else "ждём"})')
    try:
        if r[other] is not None:
            await r[other].send(json.dumps({'sys': 'peer_up'}))
        await ws.send(json.dumps({'sys': 'ok', 'peer': r[other] is not None}))
        await pump(ws, other, code)
    finally:
        if room(code).get(role) is ws:
            room(code)[role] = None
        peer = room(code).get(other)
        if peer is not None:
            try:
                await peer.send(json.dumps({'sys': 'peer_down'}))
            except websockets.ConnectionClosed:
                pass
        if not room(code)['agent'] and not room(code)['site']:
            ROOMS.pop(code, None)
        print(f'- {role} код={code}')


async def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8766
    async with websockets.serve(handler, '0.0.0.0', port, max_size=32 * 1024 * 1024):
        print(f'relay: ws://0.0.0.0:{port}')
        await asyncio.Future()


def gen_code():
    # 128 бит энтропии — код действует как пароль к печати, коротким его делать нельзя;
    # вводится копипастой (или QR), не руками посимвольно
    return secrets.token_hex(16)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '--code':
        print(gen_code()); sys.exit(0)
    asyncio.run(main())
