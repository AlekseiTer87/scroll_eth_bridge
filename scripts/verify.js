const { ethers } = require("hardhat");
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const hardhatConfig = require('../hardhat.config.js');

// Загрузка адресов контрактов
const addressesFile = require('../bridge_deployment/addresses.json');

// Адреса контрактов для верификации
const contractAddresses = {
    eth: {
        l1: {
            bridge: addressesFile.eth.l1.bridge
        },
        l2: {
            bridge: addressesFile.eth.l2.bridge
        }
    },
    token: {
        l1: {
            token: addressesFile.token.l1.token,
            bridge: addressesFile.token.l1.bridge
        },
        l2: {
            token: addressesFile.token.l2.token,
            bridge: addressesFile.token.l2.bridge
        }
    }
};

// Вывод адресов для проверки
console.log("Адреса для верификации:");
console.log("\nETH мосты:");
console.log("L1 ETH мост:", contractAddresses.eth.l1.bridge);
console.log("L2 ETH мост:", contractAddresses.eth.l2.bridge);
console.log("\nТокен мосты:");
console.log("L1 токен:", contractAddresses.token.l1.token);
console.log("L1 токен мост:", contractAddresses.token.l1.bridge);
console.log("L2 токен:", contractAddresses.token.l2.token);
console.log("L2 токен мост:", contractAddresses.token.l2.bridge);

/**
 * Выполнение команды верификации с выводом результата
 */
function executeVerify(cmd) {
    console.log(`\n> Выполнение: ${cmd}`);
    try {
        const result = execSync(cmd, { encoding: 'utf8' });
        console.log("✅ Успешно:", result);
        return true;
    } catch (error) {
        console.error("❌ Ошибка:", error.message);
        return false;
    }
}

/**
 * Верификация L1 контрактов на Ethereum Sepolia
 */
async function verifyL1Contracts() {
    console.log("\n=== Верификация L1 контрактов на Ethereum Sepolia ===");
    
    // Верификация L1 ETH моста
    console.log(`\nВерификация L1LockBridge по адресу ${contractAddresses.eth.l1.bridge}...`);
    executeVerify(`npx hardhat verify --network l1_scrollsdk ${contractAddresses.eth.l1.bridge}`);
    
    // Верификация L1 токена
    console.log(`\nВерификация L1CustomToken по адресу ${contractAddresses.token.l1.token}...`);
    executeVerify(`npx hardhat verify --network l1_scrollsdk ${contractAddresses.token.l1.token}`);
    
    // Верификация L1 токен моста
    console.log(`\nВерификация L1TokenBridge по адресу ${contractAddresses.token.l1.bridge}...`);
    executeVerify(`npx hardhat verify --network l1_scrollsdk ${contractAddresses.token.l1.bridge}`);
}

/**
 * Верификация L2 контрактов на Scroll Sepolia
 */
async function verifyL2Contracts() {
    console.log("\n=== Верификация L2 контрактов на Scroll Sepolia ===");
    
    // Верификация L2 ETH моста
    console.log(`\nВерификация L2LockBridge по адресу ${contractAddresses.eth.l2.bridge}...`);
    executeVerify(`npx hardhat verify --network l2_scrollsdk ${contractAddresses.eth.l2.bridge}`);
    
    // Верификация L2 токен моста
    console.log(`\nВерификация L2TokenBridge по адресу ${contractAddresses.token.l2.bridge}...`);
    executeVerify(`npx hardhat verify --network l2_scrollsdk ${contractAddresses.token.l2.bridge}`);
    
    // Верификация L2 токена
    console.log(`\nВерификация L2CustomToken по адресу ${contractAddresses.token.l2.token}...`);
    executeVerify(`npx hardhat verify --network l2_scrollsdk ${contractAddresses.token.l2.token} "${contractAddresses.token.l2.bridge}" "${contractAddresses.token.l1.token}"`);
}

async function main() {
    console.log("Начало процесса верификации контрактов...");
    
    // Верификация контрактов L1 (Ethereum Sepolia)
    await verifyL1Contracts();
    
    // Верификация контрактов L2 (Scroll Sepolia)
    await verifyL2Contracts();
    
    console.log("\n✨ Процесс верификации завершен");
}

// Запуск скрипта верификации
main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error("Ошибка в процессе верификации:", error);
        process.exit(1);
    }); 