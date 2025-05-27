const { ethers } = require("hardhat");
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const addressesFile = require('../addresses.json');
const hardhatConfig = require('../hardhat.config.js');

// Адреса контрактов для верификации
const contractAddresses = {
  l1: {
    token: addressesFile.l1.token,
    bridge: addressesFile.l1.bridge
  },
  l2: {
    token: addressesFile.l2.token,
    bridge: addressesFile.l2.bridge
  }
};

// Вывод адресов для проверки
console.log("Адреса для верификации:");
console.log("L1 Токен:", contractAddresses.l1.token);
console.log("L1 Мост:", contractAddresses.l1.bridge);
console.log("L2 Токен:", contractAddresses.l2.token);
console.log("L2 Мост:", contractAddresses.l2.bridge);

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
  
  // Верификация L1 токена
  console.log(`Верификация L1CustomToken по адресу ${contractAddresses.l1.token}...`);
  executeVerify(`npx hardhat verify --network l1_scrollsdk ${contractAddresses.l1.token}`);
  
  // Верификация L1 моста
  console.log(`\nВерификация L1TokenBridge по адресу ${contractAddresses.l1.bridge}...`);
  executeVerify(`npx hardhat verify --network l1_scrollsdk ${contractAddresses.l1.bridge}`);
}

/**
 * Верификация L2 контрактов на Scroll Sepolia
 */
async function verifyL2Contracts() {
  console.log("\n=== Верификация L2 контрактов на Scroll Sepolia ===");
  
  // Верификация L2 токена
  console.log(`Верификация L2CustomToken по адресу ${contractAddresses.l2.token}...`);
  executeVerify(`npx hardhat verify --network l2_scrollsdk ${contractAddresses.l2.token} "${contractAddresses.l2.bridge}" "${contractAddresses.l1.token}"`);
  
  // Верификация L2 моста
  console.log(`\nВерификация L2TokenBridge по адресу ${contractAddresses.l2.bridge}...`);
  executeVerify(`npx hardhat verify --network l2_scrollsdk ${contractAddresses.l2.bridge}`);
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