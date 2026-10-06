VENV := .venv
PY   := $(VENV)/bin/python
PIP  := $(PY) -m pip
STAMP := $(VENV)/.deps-installed

.DEFAULT_GOAL := help
.PHONY: help venv run lan check check-slicer check-db check-i18n check-hinge examples vendor clean build-web

help:            ## показать этот список
	@grep -hE '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sort | awk -F':.*## ' '{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

venv: $(STAMP)   ## создать окружение и поставить зависимости
# отметка о доставленных зависимостях: по самому python сравнивать нельзя —
# он старше requirements.txt, и make сносил бы рабочее окружение на каждый вызов
# pip зовём модулем: у консольных скриптов venv абсолютный путь в shebang,
# и после переноса каталога проекта .venv/bin/pip перестаёт запускаться
$(STAMP): requirements.txt
	@test -x $(PY) || python3 -m venv $(VENV)
	$(PIP) install -q -r requirements.txt
	@touch $@

run: venv        ## запустить редактор на http://127.0.0.1:8765
	$(PY) bridge.py

lan: venv        ## то же, но слушать всю локальную сеть (без авторизации!)
	$(PY) bridge.py --lan

check: check-db check-slicer check-i18n check-hinge check-params check-templates check-preflight check-fillet check-material check-parts  ## прогнать все проверки

check-db: venv   ## база: запись, чтение, удаление на временном файле
	$(PY) db.py

check-slicer: venv  ## слайсер: прогнать тестовый куб и шаблоны крепежа
	$(PY) bridge.py --selfcheck

check-i18n:      ## словарь переводов: перевод перевода не должен меняться
	node web/js/i18n.test.mjs

check-hinge:     ## петля: ребро не должно уезжать при повороте
	node web/js/hinge.test.mjs

check-params:    ## параметры: формулы тел пересчитываются, мусор не исполняется
	node web/js/params.test.mjs
	node web/js/fit.test.mjs

check-material: venv  ## печать под нужный пластик: деталь под TPU не режется под PLA
	$(PY) bridge.py --check-material

check-parts:      ## детали и коннекторы: список по деталям, имена, осиротевшие коннекторы
	node web/js/parts.test.mjs

check-fillet:     ## скругление рёбер: сетка замкнута, объём срезан ровно на четверти
	node web/js/fillet.test.mjs

check-preflight:  ## проверка перед печатью: ловит висящие тела, тонкие стенки, нависания
	node web/js/preflight.test.mjs

check-templates: venv  ## шаблоны вкладки «Шаблоны»: собираются и проходят check_scene
	node web/js/templates.test.mjs .templates.json && $(PY) examples/build.py --check-json .templates.json; s=$$?; rm -f .templates.json; exit $$s

examples: venv   ## пересобрать примеры в examples/ и проверить их печатаемость
	$(PY) examples/build.py --write
	node web/js/templates.test.mjs .templates.json examples/chekhol-iphone-16e.pen3d.json && $(PY) examples/build.py --check-json .templates.json; s=$$?; rm -f .templates.json; exit $$s

vendor:          ## перекачать библиотеки в web/vendor по списку .sources
	@cd web/vendor && while read -r p; do \
		[ -z "$$p" ] && continue; \
		mkdir -p "$$(dirname "$$p")"; \
		curl -sfL "https://cdn.jsdelivr.net/npm/$$p" -o "$$p" || echo "не скачался: $$p"; \
	done < .sources
	@echo "файлов в vendor: $$(find web/vendor -name '*.js' | wc -l | tr -d ' ')"

build-web:       ## пересобрать Solid-куски (web/solid/*) в web/js/*-solid.js — нужен Node, только для разработки
	@cd web && npm install --silent && npm run build
	@echo "собрано — результат закоммитить, make run сам Node не трогает"

clean:           ## удалить окружение и кэш питона (база usta.db остаётся)
	rm -rf $(VENV) __pycache__ .pytest_cache
	find . -name '*.pyc' -delete
