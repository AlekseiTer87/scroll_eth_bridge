#!/bin/bash

# Проверка наличия Python
if ! command -v python3 &> /dev/null; then
    echo "Python3 не установлен. Пожалуйста, установите Python3."
    exit 1
fi

# Проверка наличия pip
if ! command -v pip3 &> /dev/null; then
    echo "pip3 не установлен. Пожалуйста, установите pip3."
    exit 1
fi

# Создание и активация виртуального окружения
echo "Создание виртуального окружения..."
python3 -m venv venv
source venv/bin/activate

# Установка зависимостей
echo "Установка зависимостей..."
pip install -r requirements.txt

# Запуск бота
echo "Запуск бота..."
python3 bridge_bot.py 