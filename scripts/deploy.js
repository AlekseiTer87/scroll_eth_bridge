const { ethers } = require("hardhat");

// Адреса из локальной конфигурации Scroll
const L1_GATEWAY_ROUTER_PROXY_ADDR = "0xd94Ef24103c73ea4D86cDA8572482dC367De480C";
const L2_GATEWAY_ROUTER_PROXY_ADDR = "0xeaef6972b6D15E7A1f1FBD4a177d9DcDd1ACe5e9";
const L1_SCROLL_MESSENGER_PROXY_ADDR = "0xEd07bbda5D53AA599E693602E45c2d985026eD1c";
const L2_SCROLL_MESSENGER_PROXY_ADDR = "0xd7d858a4960f962E5f5F2ef62349bF83e54bea01";

// RPC URL для локальных сетей
const L1_RPC_URL = "http://l1-devnet.scrollsdk";
const L2_RPC_URL = "http://l2-rpc.scrollsdk";

// Приватный ключ из документации
const PRIVATE_KEY = "0xd44828b92f6c5ed72250325882bed43206da13121d75f89b5007dc1c26c3cc8d";

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
  const fs = require("fs");
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
  console.log("1. Установить approval для L1 токенов:");
  console.log(`   npx hardhat run scripts/approve.js --network l1_scrollsdk`);
  console.log("2. Отправить токены с L1 на L2:");
  console.log(`   npx hardhat run scripts/bridgeL1ToL2.js --network l1_scrollsdk`);
  console.log("3. Отправить токены с L2 на L1:");
  console.log(`   npx hardhat run scripts/bridgeL2ToL1.js --network l2_scrollsdk`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 