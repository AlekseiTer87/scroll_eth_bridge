const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// URL для сети Scroll Sepolia и Ethereum Sepolia
const L2_RPC_URL = "https://sepolia-rpc.scroll.io";
const L1_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

// Функция для получения приватного ключа
async function getPrivateKey() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question("Введите приватный ключ (начинается с 0x): ", (key) => {
      rl.close();
      if (!key.startsWith("0x")) {
        console.error("Приватный ключ должен начинаться с 0x");
        process.exit(1);
      }
      resolve(key);
    });
  });
}

// Функция для получения количества токенов
async function getTokenAmount() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question("Введите количество токенов для перевода: ", (amount) => {
      rl.close();
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        console.error("Пожалуйста, введите корректное положительное число");
        process.exit(1);
      }
      resolve(parsedAmount);
    });
  });
}

// ABI для контрактов
const L2CustomTokenABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)"
];

const L2TokenBridgeABI = [
  "function bridgeToken(uint256 amount, uint256 gasLimit) external payable"
];

// Функция для настройки конфигурации моста
async function getBridgeConfig(userPrivateKey) {
  // Загружаем адреса из файла
  const addressesPath = path.join(__dirname, "../../bridge_deployment/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.error("Файл bridge_deployment/addresses.json не найден! Сначала запустите deploy.js");
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  
  // Получаем провайдер из Hardhat
  const provider = ethers.provider;
  
  // Создание кошелька с указанным приватным ключом
  const wallet = new ethers.Wallet(userPrivateKey, provider);
  
  return {
    addresses,
    wallet,
    L2_TOKEN_ADDRESS: addresses.token.l2.token,
    L2_BRIDGE_ADDRESS: addresses.token.l2.bridge
  };
}

// Основная функция
async function main() {
  // Получаем приватный ключ
  const privateKey = await getPrivateKey();
  
  // Загрузка адресов из файла
  const addressesPath = path.join(__dirname, "../../bridge_deployment/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.error("Файл addresses.json не найден! Сначала запустите deploy.js");
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  
  const L2_TOKEN_ADDRESS = addresses.token.l2.token;
  const L2_BRIDGE_ADDRESS = addresses.token.l2.bridge;
  
  console.log("Адрес моста L2:", L2_BRIDGE_ADDRESS);
  console.log("Адрес токена L2:", L2_TOKEN_ADDRESS);
  
  // Настройка провайдеров
  const l2Provider = new ethers.providers.JsonRpcProvider(L2_RPC_URL);
  const l1Provider = new ethers.providers.JsonRpcProvider(L1_RPC_URL);
  
  // Создание кошелька
  const wallet = new ethers.Wallet(privateKey, l2Provider);
  console.log("Отправка токенов с аккаунта:", wallet.address);
  
  // Подключение к контрактам
  const l2Token = new ethers.Contract(L2_TOKEN_ADDRESS, L2CustomTokenABI, wallet);
  const l2Bridge = new ethers.Contract(L2_BRIDGE_ADDRESS, L2TokenBridgeABI, wallet);
  
  // Проверка баланса токенов на L2
  const balance = await l2Token.balanceOf(wallet.address);
  console.log("\nТекущий баланс токенов:", ethers.utils.formatEther(balance));
  
  // Получаем количество токенов
  const tokenAmount = await getTokenAmount();
  const AMOUNT_TO_BRIDGE = ethers.utils.parseEther(tokenAmount.toString());
  
  // Проверяем достаточность баланса
  if (balance.lt(AMOUNT_TO_BRIDGE)) {
    console.error("\nОшибка: Недостаточно токенов для перевода!");
    console.error(`Требуется: ${ethers.utils.formatEther(AMOUNT_TO_BRIDGE)} токенов`);
    console.error(`Доступно: ${ethers.utils.formatEther(balance)} токенов`);
    process.exit(1);
  }
  
  // Лимит газа для выполнения транзакции на L1
  const GAS_LIMIT = 1000000;
  
  console.log(`Отправка ${ethers.utils.formatEther(AMOUNT_TO_BRIDGE)} токенов с L2 на L1...`);
  
  // Одобряем мост на использование наших токенов
  console.log("Одобрение токенов для моста...");
  const approveTx = await l2Token.approve(L2_BRIDGE_ADDRESS, AMOUNT_TO_BRIDGE);
  await approveTx.wait();
  console.log("Токены одобрены для моста");
  
  // Расчет комиссии за переход между цепями: L1 gasPrice * gas limit
  const gasPriceL1 = await l1Provider.getGasPrice();
  const ethRequired = gasPriceL1.mul(GAS_LIMIT);
  console.log(`Комиссия за переход между цепями: ${ethers.utils.formatEther(ethRequired)} ETH (gasPrice: ${ethers.utils.formatUnits(gasPriceL1, "gwei")} gwei × gasLimit ${GAS_LIMIT})`);
  
  // Отправляем токены через мост
  console.log("Отправка токенов через мост...");
  const bridgeTx = await l2Bridge.bridgeToken(
    AMOUNT_TO_BRIDGE,
    GAS_LIMIT,
    { value: ethRequired, gasLimit: GAS_LIMIT }
  );
  
  await bridgeTx.wait();
  console.log("Токены отправлены через мост!");
  console.log("Хэш транзакции:", bridgeTx.hash);
  console.log("Токены будут доступны на L1 после подтверждения транзакции (обычно это занимает несколько минут)");
  console.log("Для получения токенов на L1 используйте скрипт claimL2ToL1.js с этим хэшем транзакции");
}

// Запуск скрипта с обработкой ошибок
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  getPrivateKey
}; 