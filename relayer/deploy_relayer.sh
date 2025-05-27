#!/bin/bash
set -e

# Папка скрипта
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. Создать venv, если не существует
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

# 2. Активировать venv
source venv/bin/activate

# 3. Обновить pip
pip install --upgrade pip

# 4. Установить зависимости
pip install -r requirements.txt

# 5. Создать .env, если не существует
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo ".env создан на основе .env.example. Проверьте приватный ключ и параметры!"
    else
        echo "ВНИМАНИЕ: .env.example не найден. Создайте .env вручную!"
    fi
fi

# 6. Запустить релеер
python relayer.py 