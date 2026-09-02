# pen3d

Локальный 3D-редактор для печати на Bambu Lab A1 напрямую из браузера, без облака Bambu.

> Browser-based 3D editor that slices and prints to a Bambu Lab A1 over LAN, no Bambu Cloud involved.

## Файлы

- `index.html` — 3D-редактор (примитивы, AI-помощник через DeepSeek)
- `editor-2d-old.html` — старая 2D-версия
- `bridge.py` — локальный сервер: раздаёт статику, слайсит STL и печатает

## Запуск

Нужны macOS с установленной Bambu Studio (для CLI-слайсинга) и Python 3.11+.

```
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python bridge.py
```

Проверить, что слайсер жив: `.venv/bin/python bridge.py --selfcheck`.

Сервер поднимается на `http://127.0.0.1:8765`. Флаг `--lan` — слушать не только localhost, а на всех интерфейсах (без авторизации, см. «Ограничения»).

## Настройка ~/.pen3d.json

```json
{
  "ip": "192.168.1.50",
  "code": "12345678",
  "serial": "01P00A000000000",
  "deepseek_key": "sk-..."
}
```

- `ip`, `code` (Access Code), `serial` — экран принтера: Settings → Network → LAN Only Mode.
- `deepseek_key` — ключ DeepSeek для AI-помощника в редакторе (опционально, без него работает только ручное моделирование).

## Пайплайн печати

1. Редактор шлёт STL модели на `POST /upload` (или `/print`).
2. `bridge.py` слайсит STL через Bambu Studio CLI → `out.3mf`.
3. `.3mf` заливается на принтер по FTPS (implicit TLS, порт 990).
4. `/print` дополнительно шлёт команду старта печати по MQTT (порт 8883).

## Пресеты слайсинга

Зашиты в `bridge.py` (`PRESETS`): Bambu Lab A1 0.4 nozzle / 0.20mm Standard / Bambu PLA Basic. Чтобы поменять — отредактировать пути в словаре `PRESETS` на другие профили из `~/Library/Application Support/BambuStudio/system/BBL`.

## Горячие клавиши редактора

- `G` / `R` / `S` — перемещение / вращение / масштаб
- `1`–`4` — виды камеры
- `⌘Z` / `⇧⌘Z` — отмена / повтор
- `⌘D` — дублировать объект
- `Delete` — удалить объект
- `Esc` — снять выделение

## Ограничения

- TLS-соединение с принтером не проверяет сертификат (самоподписанный) — это ожидаемо для LAN Mode, но не для интернета.
- Флаг `--lan` открывает сервер на все интерфейсы без какой-либо авторизации — использовать только в доверенной локальной сети.

## Лицензия

MIT
