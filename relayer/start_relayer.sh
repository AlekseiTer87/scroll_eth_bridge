#!/bin/bash
set -e

# Папка скрипта
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Функция проверки зависимостей
check_dependencies() {
    local missing_deps=0
    
    echo "Проверка зависимостей..."
    
    # Читаем requirements.txt и проверяем каждую зависимость
    while IFS= read -r line || [[ -n "$line" ]]; do
        # Пропускаем пустые строки и комментарии
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
        
        # Извлекаем имя пакета и версию
        if [[ "$line" =~ ^([^=><]+)(==|>=|<=|>|<)?(.+)?$ ]]; then
            package="${BASH_REMATCH[1]}"
            operator="${BASH_REMATCH[2]}"
            version="${BASH_REMATCH[3]}"
            
            if ! pip freeze | grep -i "^${package}==" > /dev/null; then
                echo "❌ Отсутствует пакет: ${package}"
                missing_deps=1
            else
                installed_version=$(pip freeze | grep -i "^${package}==" | cut -d'=' -f3)
                if [[ -n "$operator" && -n "$version" ]]; then
                    echo "✓ Установлен ${package}==${installed_version} (требуется ${operator}${version})"
                else
                    echo "✓ Установлен ${package}==${installed_version}"
                fi
            fi
        fi
    done < requirements.txt
    
    return $missing_deps
}

# Создаем виртуальное окружение, если его нет
if [ ! -d "venv" ]; then
    echo "Создаем виртуальное окружение..."
    python3 -m venv venv
fi

# Активируем виртуальное окружение
source venv/bin/activate

# Обновляем pip и устанавливаем setuptools
echo "Обновляем pip и базовые зависимости..."
pip install --upgrade pip setuptools wheel

# Проверяем зависимости и устанавливаем их при необходимости
if ! check_dependencies; then
    echo "Устанавливаем недостающие зависимости..."
    pip install -r requirements.txt
    # Проверяем еще раз после установки
    if ! check_dependencies; then
        echo "❌ Ошибка: Не удалось установить все зависимости"
        exit 1
    fi
fi

# Создаем .env если его нет
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp .env.example .env
        echo ".env создан на основе .env.example. Проверьте приватный ключ и параметры!"
    else
        echo "ВНИМАНИЕ: .env.example не найден. Создайте .env вручную!"
    fi
fi

# Проверяем наличие .env файла
if [ ! -f ".env" ]; then
    echo "❌ Ошибка: Файл .env не найден"
    echo "Создайте файл .env со следующими параметрами:"
    echo "L1_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com"
    echo "L2_RPC_URL=https://sepolia-rpc.scroll.io/"
    echo "BRIDGE_HISTORY_API=https://sepolia-api-bridge-v2.scroll.io"
    echo "RELAYER_PRIVATE_KEY=ваш_приватный_ключ"
    exit 1
fi

# Проверяем содержимое .env файла
required_vars=("L1_RPC_URL" "L2_RPC_URL" "BRIDGE_HISTORY_API" "RELAYER_PRIVATE_KEY")
missing_vars=0

echo "Проверка переменных окружения..."
for var in "${required_vars[@]}"; do
    if ! grep -q "^${var}=" .env; then
        echo "❌ Отсутствует переменная: ${var}"
        missing_vars=1
    else
        echo "✓ Переменная ${var} настроена"
    fi
done

if [ $missing_vars -eq 1 ]; then
    echo "❌ Ошибка: Не все необходимые переменные настроены в .env"
    exit 1
fi

# Запускаем релеер
echo "✓ Все проверки пройдены"
echo "Запускаем релеер..."
python relayer.py 