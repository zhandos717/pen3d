VENV := .venv
PY   := $(VENV)/bin/python
PIP  := $(PY) -m pip
STAMP := $(VENV)/.deps-installed

.DEFAULT_GOAL := help
.PHONY: help venv run lan check check-slicer check-db examples clean

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

check: check-db check-slicer  ## прогнать все проверки

check-db: venv   ## база: запись, чтение, удаление на временном файле
	$(PY) db.py

check-slicer: venv  ## слайсер: прогнать тестовый куб и шаблоны крепежа
	$(PY) bridge.py --selfcheck

examples: venv   ## пересобрать примеры в examples/ и проверить их печатаемость
	$(PY) examples/build.py --write

clean:           ## удалить окружение и кэш питона (база pen3d.db остаётся)
	rm -rf $(VENV) __pycache__ .pytest_cache
	find . -name '*.pyc' -delete
