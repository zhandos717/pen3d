# pen3d

Browser-based 3D editor that slices and prints to a **Bambu Lab A1 over your LAN** — no Bambu Cloud, no account, no vendor app. Model a part, hit print, watch it come out.

An optional AI agent builds parts for you: it places primitives step by step, checks its own work against printability rules, and fixes what it finds.

*[Русская версия](README.ru.md)*

## What it does

- **Model in the browser** — box, cylinder, prism, sphere, cone, torus, wedge and real metric threads; freehand sketches extruded into solids; booleans (any body can become a hole).
- **Slice and print over LAN** — the editor sends STL to a local Python server, which slices via the Bambu Studio CLI, uploads the `.3mf` over FTPS and starts the print over MQTT.
- **AI agent** — describe the part in plain language; the agent works with tools (`add_shape`, `update_shape`, `delete_shape`, `get_scene`, `check`, `finish`) on its own build plate, so your work is never touched. You watch it build live and can take the result over or stop it mid-run.
- **Live printer status** — state, nozzle and bed temperatures, Wi-Fi signal, and during a print the progress bar, layer count and time left, read straight off the printer over MQTT.
- **Printer camera** — the A1 has no RTSP; its chamber camera speaks a small protocol on port 6000. The server relays it as an MJPEG stream, so a plain `<img>` shows it live with no JavaScript.
- **Server-side printability checks** — connectivity, floating bodies, holes larger than the part, walls too thin.

Works with DeepSeek, any OpenAI-compatible endpoint (OpenRouter, Groq, Together), local Ollama, or Anthropic.

## Requirements

- macOS with [Bambu Studio](https://bambulab.com/en/download/studio) installed — used headless for slicing
- Python 3.11+
- A Bambu Lab A1 in **LAN Only Mode**

Other Bambu printers (P1/X1) speak the same protocol and differ only in slicer presets — untested, patches welcome.

## Getting started

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python bridge.py
```

Open <http://127.0.0.1:8765>. Without a config you can still model and download STL — printing and AI need the file below.

Sanity checks: `.venv/bin/python bridge.py --selfcheck` slices a test cube; `.venv/bin/python db.py` exercises the database.

## Configuration — `~/.pen3d.json`

```json
{
  "ip": "192.168.1.50",
  "code": "12345678",
  "serial": "01P00A000000000",
  "deepseek_key": "sk-..."
}
```

`ip`, `code` (Access Code) and `serial` are on the printer screen under **Settings → Network → LAN Only Mode**. `deepseek_key` is optional — without it, manual modelling still works.

## Layout

```
bridge.py              server: serves web/, slices STL, prints, runs the agent
db.py                  SQLite: scene, sketch library, AI log, token counter
pen3d.db               database, created on first run (not in git)
web/
  index.html           editor UI
  js/                  app, geometry, csg, stl, ai
  icon.svg
```

Only `web/` is exposed over HTTP — `bridge.py`, the database and your config are not reachable from the browser.

## Print pipeline

1. Editor POSTs the STL to `/upload` (or `/print`).
2. `bridge.py` slices it through the Bambu Studio CLI into `out.3mf`.
3. The `.3mf` is uploaded to the printer over FTPS (implicit TLS, port 990).
4. `/print` additionally sends the start command over MQTT (port 8883).

`GET /camera` opens a separate TLS connection to port 6000, authenticates with the access code and relays the JPEG frames as `multipart/x-mixed-replace` (~1 frame every 2 s). The stream only runs while the editor asks for it.

The same MQTT connection feeds `GET /printer`, which the editor polls for live status. The response carries an `age` field, so stale data is visible instead of silently frozen.

Slicer presets are pinned in `bridge.py` (`PRESETS`): A1 0.4 nozzle / 0.20mm Standard / Bambu PLA Basic. Point them at other profiles in `~/Library/Application Support/BambuStudio/system/BBL` to change them.

## Storage

Everything lives in SQLite next to the server:

| table | holds |
|---|---|
| `projects` | the scene, autosaved on every edit |
| `sketches` | sketch library |
| `ai_log` | model requests and responses |
| `counters` | cumulative token spend |

Saves are debounced to once per 400 ms, so dragging a gizmo does not hammer the database. On first run, an older `ai-log.jsonl` and anything in `localStorage` migrate over automatically. Only model settings and the last prompt stay in the browser — **API keys are never sent to the server**.

## Keyboard

| key | action |
|---|---|
| `G` / `R` / `S` | move / rotate / scale |
| `1`–`4` | camera views |
| `⌘Z` / `⇧⌘Z` | undo / redo |
| `⌘D` | duplicate |
| `Delete` | delete |
| `Esc` | deselect |

## Notes on agent cost

Agent runs are metered and the spend is visible in the UI. One measured comparison on the same part (angled phone stand with a cable cutout):

| | before | after |
|---|---|---|
| steps | 14 | 10 |
| tokens | 201 637 | 78 013 |
| wall time | 245 s | 92 s |
| per step | 14 402 | 7 801 |

The saving came from **capping the step count and setting `temperature: 0`** — the agent stopped second-guessing and redoing work. It did *not* come from prompt caching: cache hits covered 94–98% of input tokens in both runs. That is also why conversation history is left intact below 60 000 characters — trimming it does not pay for itself and costs the agent the context it needs. Pass `legacy: true` to `/agent` to reproduce the old behaviour and re-run the comparison.

## Limitations

- TLS to the printer does not verify the certificate (it is self-signed) — expected for LAN Mode, not acceptable over the internet.
- `--lan` binds all interfaces **with no authentication**. Use it only on a network you trust.
- No fillets or chamfers — the primitive set does not cover them.
- macOS-only paths for Bambu Studio and its profiles.

## License

MIT — see [LICENSE](LICENSE).
