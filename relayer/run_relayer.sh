#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d "venv" ]; then
    echo "Виртуальное окружение venv не найдено! Сначала выполните deploy_relayer.sh или создайте venv."
    exit 1
fi

source venv/bin/activate

python relayer.py 