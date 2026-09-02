"""Готовые сборки для pen3d: файлы проекта, которые открываются кнопкой «Открыть».

Каждая проходит тот же check_scene, которым проверяется работа агента.
"""
import json, os, sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import bridge

OUT = os.path.dirname(os.path.abspath(__file__))

BASE = dict(rot=0, rx=0, rz=0, sides=6, dia=10, pitch=1.5, vis=True, hole=False, color='#2dd4a7')


def scene(*objs):
    out, i = [], 1
    for o in objs:
        out.append({**BASE, 'id': i, **o})
        i += 1
    return {'objects': out, 'nextId': i}


def box(name, x, y, z, w, d, h, **kw):
    return dict(name=name, type='box', x=x, y=y, z=z, w=w, d=d, h=h, **kw)


def cyl(name, x, y, z, dia, h, **kw):
    return dict(name=name, type='cyl', x=x, y=y, z=z, w=dia, d=dia, h=h, **kw)


def hole(o):
    return {**o, 'hole': True, 'color': '#d0455f'}


# ---------- 1. корпус для платы ----------
# Стенка 2.4 мм = шесть проходов соплом 0.4. Корпус собран из дна и четырёх стенок,
# а не «коробка минус полость»: CSG вычитает отверстия после объединения тел,
# и полость срезала бы бобышки, стоящие внутри неё.
W, D, H, T = 80, 60, 25, 2.4
case = scene(
    box('дно', 0, 0, 0, W, D, T),
    box('стенка задняя', 0, D/2 - T/2, 0, W, T, H),
    box('стенка передняя', 0, -(D/2 - T/2), 0, W, T, H),
    box('стенка левая', -(W/2 - T/2), 0, 0, T, D - 2*T, H),
    box('стенка правая', W/2 - T/2, 0, 0, T, D - 2*T, H),
    *[box(f'бобышка {i+1}', sx*(W/2 - T - 5), sy*(D/2 - T - 5), T, 8, 8, 6)
      for i, (sx, sy) in enumerate([(-1,-1), (1,-1), (-1,1), (1,1)])],
    *[hole(cyl(f'под винт {i+1}', sx*(W/2 - T - 5), sy*(D/2 - T - 5), T + 1.5, 2.6, 8))
      for i, (sx, sy) in enumerate([(-1,-1), (1,-1), (-1,1), (1,1)])],
    hole(box('окно под разъём', W/2 - T/2, 0, T + 3, T + 4, 16, 9)),
)


# ---------- 2. L-кронштейн с ребром ----------
# Косынка держит угол: без неё полка отламывается по слою — это самое слабое место FDM.
brk = scene(
    box('основание', 0, 0, 0, 60, 40, 5),
    box('полка', -27.5, 0, 5, 5, 40, 45),
    box('ребро', -10, 0, 5, 30, 4, 30, rot=0),
    *[hole(cyl(f'отверстие {i+1}', x, y, -1, 5.5, 7))
      for i, (x, y) in enumerate([(5, -12), (5, 12), (22, -12), (22, 12)])],
    *[hole(cyl(f'в полке {i+1}', -27.5, y, 25, 5.5, 9, rx=90))
      for i, y in enumerate([-12, 12])],
)

# ---------- 3. хомут для трубы 25 мм ----------
clamp = scene(
    cyl('обойма', 0, 0, 0, 39, 14),
    hole(cyl('под трубу', 0, 0, -1, 25, 16)),
    box('ухо левое', -24, 0, 0, 16, 14, 14),
    box('ухо правое', 24, 0, 0, 16, 14, 14),
    hole(box('разрез', 0, 22, -1, 3, 30, 18)),
    hole(cyl('под болт левый', -27, 0, -1, 5.5, 18)),
    hole(cyl('под болт правый', 27, 0, -1, 5.5, 18)),
)

# ---------- 4. подставка под телефон ----------
# Наклон 65° — телефон не сползает, но и не заваливается; упор ловит нижнюю грань.
stand = scene(
    box('основание', 0, 0, 0, 80, 70, 6),
    box('спинка', 0, 22, 6, 80, 8, 60, rx=25),
    box('упор', 0, -22, 6, 80, 6, 12),
    hole(box('прорезь под кабель', 0, -22, 4, 22, 12, 12)),
)

# ---------- 5. шкив под подшипник 608 ----------
# 608: наружный 22, внутренний 8, ширина 7 — самый ходовой подшипник в самоделках.
pulley = scene(
    cyl('щека нижняя', 0, 0, 0, 40, 3),
    cyl('ручей', 0, 0, 3, 32, 8),
    cyl('щека верхняя', 0, 0, 11, 40, 3),
    hole(cyl('гнездо подшипника', 0, 0, 3.5, 22.2, 7)),
    hole(cyl('сквозное', 0, 0, -1, 9, 18)),
)

CASES = [('korpus-platy', 'Корпус для платы 80×60×25', case),
         ('kronshtein-L', 'L-кронштейн с ребром жёсткости', brk),
         ('khomut-25', 'Хомут для трубы 25 мм', clamp),
         ('podstavka-telefon', 'Подставка под телефон', stand),
         ('shkiv-608', 'Шкив под подшипник 608', pulley)]

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    bad = 0
    for slug, title, sc in CASES:
        problems = bridge.check_scene(sc['objects'])
        solids = sum(1 for o in sc['objects'] if not o['hole'])
        holes = sum(1 for o in sc['objects'] if o['hole'])
        print(f'{title:34} тел {solids:2} отверстий {holes:2}  ' +
              ('ок' if not problems else 'ПРОБЛЕМЫ:'))
        for p in problems:
            print('   ·', p)
        bad += len(problems)
        if '--write' in sys.argv and not problems:
            with open(os.path.join(OUT, slug + '.pen3d.json'), 'w') as f:
                json.dump(sc, f, ensure_ascii=False, indent=1)
    print('\nитого замечаний:', bad)
