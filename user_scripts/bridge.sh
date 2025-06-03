#!/bin/bash

# Цвета для вывода
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Функция для очистки экрана и вывода заголовка
show_header() {
    clear
    echo -e "${BLUE}=== Scroll Bridge Operations ===${NC}\n"
}

# Функция для отображения меню
show_menu() {
    echo "Выберите операцию:"
    echo -e "${GREEN}1.${NC} Отправить ETH из L1 в L2"
    echo -e "${GREEN}2.${NC} Отправить ETH из L2 в L1"
    echo -e "${GREEN}3.${NC} Получить ETH в L1 (claim)"
    echo -e "${GREEN}4.${NC} Отправить токены из L1 в L2"
    echo -e "${GREEN}5.${NC} Отправить токены из L2 в L1"
    echo -e "${GREEN}6.${NC} Получить токены в L1 (claim)"
    echo -e "${GREEN}0.${NC} Выход"
    echo
    read -p "Ваш выбор (0-6): " choice
}

# Функция для запуска скрипта с обработкой ошибок
run_script() {
    local script=$1
    echo -e "\n${BLUE}Запуск $script...${NC}\n"
    npx hardhat run scripts/$script --network l1_scrollsdk
    
    if [ $? -eq 0 ]; then
        echo -e "\n${GREEN}Операция успешно завершена!${NC}"
    else
        echo -e "\n${RED}Произошла ошибка при выполнении операции.${NC}"
    fi
    
    echo -e "\nНажмите Enter, чтобы продолжить..."
    read
}

# Основной цикл программы
while true; do
    show_header
    show_menu

    case $choice in
        1)
            run_script "bridgeL1ToL2ETH.js"
            ;;
        2)
            run_script "bridgeL2ToL1ETH.js"
            ;;
        3)
            run_script "claimL2ToL1ETH.js"
            ;;
        4)
            run_script "bridgeL1ToL2.js"
            ;;
        5)
            run_script "bridgeL2ToL1.js"
            ;;
        6)
            run_script "claimL2ToL1.js"
            ;;
        0)
            echo -e "\n${BLUE}До свидания!${NC}"
            exit 0
            ;;
        *)
            echo -e "\nНеверный выбор. Пожалуйста, выберите число от 0 до 6."
            echo "Нажмите Enter, чтобы продолжить..."
            read
            ;;
    esac
done 