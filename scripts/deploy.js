const { ethers } = require("hardhat");
const fs = require("fs");
const hardhatConfig = require("../hardhat.config.js");

// Адреса из локальной конфигурации Scroll
const L1_GATEWAY_ROUTER_PROXY_ADDR = "0x13FBE0D0e5552b8c9c4AE9e2435F38f37355998a";
const L2_GATEWAY_ROUTER_PROXY_ADDR = "0x9aD3c5617eCAa556d6E166787A97081907171230";
const L1_SCROLL_MESSENGER_PROXY_ADDR = "0x50c7d3e7f7c656493D1D76aaa1a836CedfCBB16A";
const L2_SCROLL_MESSENGER_PROXY_ADDR = "0xBa50f5340FB9F3Bd074bD638c9BE13eCB36E603d";

// Получение URL и приватного ключа из конфигурации hardhat
const L1_RPC_URL = hardhatConfig.networks.l1_scrollsdk.url;
const L2_RPC_URL = hardhatConfig.networks.l2_scrollsdk.url;
const PRIVATE_KEY = hardhatConfig.networks.l1_scrollsdk.accounts[0]; // Берем первый ключ из массива

console.log("Использую конфигурацию из hardhat.config.js:");
console.log("L1 RPC URL:", L1_RPC_URL);
console.log("L2 RPC URL:", L2_RPC_URL);

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Деплой с аккаунта:", deployer.address);

  const initialBalance = await deployer.getBalance();
  console.log("Начальный баланс:", ethers.utils.formatEther(initialBalance), "ETH");

  // Деплой L1 токена
  console.log("Деплой L1 токена...");
  const L1CustomToken = await ethers.getContractFactory("L1CustomToken");
  const l1Token = await L1CustomToken.deploy();
  await l1Token.deployed();
  console.log("L1 токен развернут по адресу:", l1Token.address);

  // Деплой L1 моста
  console.log("Деплой L1 моста...");
  const L1TokenBridge = await ethers.getContractFactory("L1TokenBridge");
  const l1Bridge = await L1TokenBridge.deploy();
  await l1Bridge.deployed();
  console.log("L1 мост развернут по адресу:", l1Bridge.address);

  // Переключаемся на L2 провайдер для деплоя L2 контрактов
  const l2Provider = new ethers.providers.JsonRpcProvider(L2_RPC_URL);
  const l2Wallet = new ethers.Wallet(PRIVATE_KEY, l2Provider);
  
  console.log("Переключение на L2 сеть...");
  console.log("L2 адрес кошелька:", l2Wallet.address);
  
  // Деплой L2 моста
  console.log("Деплой L2 моста...");
  const L2TokenBridge = await ethers.getContractFactory("L2TokenBridge", l2Wallet);
  const l2Bridge = await L2TokenBridge.deploy();
  await l2Bridge.deployed();
  console.log("L2 мост развернут по адресу:", l2Bridge.address);
  
  // Деплой L2 токена с указанием L2 моста и L1 токена
  console.log("Деплой L2 токена...");
  const L2CustomToken = await ethers.getContractFactory("L2CustomToken", l2Wallet);
  const l2Token = await L2CustomToken.deploy(l2Bridge.address, l1Token.address);
  await l2Token.deployed();
  console.log("L2 токен развернут по адресу:", l2Token.address);

  // Инициализация L1 моста
  console.log("Инициализация L1 моста...");
  await l1Bridge.initialize(
    l2Bridge.address,                  // counterpart
    L1_GATEWAY_ROUTER_PROXY_ADDR,      // router
    L1_SCROLL_MESSENGER_PROXY_ADDR,    // messenger
    l1Token.address,                   // l1 token
    l2Token.address                    // l2 token
  );
  console.log("L1 мост инициализирован");

  // Инициализация L2 моста
  console.log("Инициализация L2 моста...");
  const initTx = await l2Bridge.initialize(
    l1Bridge.address,                  // counterpart
    L2_GATEWAY_ROUTER_PROXY_ADDR,      // router
    L2_SCROLL_MESSENGER_PROXY_ADDR,    // messenger
    l1Token.address,                   // l1 token
    l2Token.address                    // l2 token
  );
  await initTx.wait();
  console.log("L2 мост инициализирован");

  // Создаем файл с адресами контрактов для использования в скриптах перевода токенов
  const addresses = {
    l1: {
      token: l1Token.address,
      bridge: l1Bridge.address
    },
    l2: {
      token: l2Token.address,
      bridge: l2Bridge.address
    }
  };
  fs.writeFileSync("addresses.json", JSON.stringify(addresses, null, 2));
  console.log("Адреса контрактов сохранены в файле addresses.json");

  console.log("--------- Деплой завершен ---------");
  console.log("L1 токен:", l1Token.address);
  console.log("L1 мост:", l1Bridge.address);
  console.log("L2 токен:", l2Token.address);
  console.log("L2 мост:", l2Bridge.address);

  console.log("\nТеперь вы можете:");
  console.log("1. Отправить токены с L1 на L2:");
  console.log(`   npm run bridgel1tol2`);
  console.log("2. Отправить токены с L2 на L1:");
  console.log(`   npm run bridgel2tol1`);
  console.log("3. Получить токены после перевода с L2 на L1:");
  console.log(`   npm run claiml2tol1`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 
