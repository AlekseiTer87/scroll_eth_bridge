const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// URL для сети Sepolia
const L1_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

// ABI для контрактов
const L1CustomTokenABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)"
];

const L1TokenBridgeABI = [
  "function bridgeToken(uint256 amount, uint256 gasLimit) external payable"
];

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

// Функция для настройки конфигурации моста
async function getBridgeConfig(userPrivateKey) {
  // Загружаем адреса из файла
  const addressesPath = path.join(__dirname, "../../bridge_deployment/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.error("Файл bridge_deployment/addresses.json не найден! Сначала запустите deploy.js");
    process.exit(1);
  }

  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  
  // Создаем провайдер для L1
  const provider = new ethers.providers.JsonRpcProvider(L1_RPC_URL);
  
  // Создание кошелька с указанным приватным ключом
  const wallet = new ethers.Wallet(userPrivateKey, provider);
  
  return {
    addresses,
    wallet,
    L1_TOKEN_ADDRESS: addresses.token.l1.token,
    L1_BRIDGE_ADDRESS: addresses.token.l1.bridge
  };
}

// Основная функция
async function main() {
  // Получаем приватный ключ
  const privateKey = await getPrivateKey();
  
  // Получаем конфигурацию моста для проверки баланса
  const config = await getBridgeConfig(privateKey);
  const { wallet, L1_TOKEN_ADDRESS } = config;
  
  // Подключаемся к контракту токена для проверки баланса
  const l1Token = new ethers.Contract(L1_TOKEN_ADDRESS, L1CustomTokenABI, wallet);
  
  // Проверяем баланс токенов L1
  const balance = await l1Token.balanceOf(wallet.address);
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
  
  // Получаем полную конфигурацию моста
  const { L1_BRIDGE_ADDRESS } = config;
  
  console.log("Отправка токенов с аккаунта:", wallet.address);
  
  // Лимит газа для выполнения транзакции на L2
  const GAS_LIMIT = 1000000;

  // Одобряем мост на использование наших токенов
  console.log("Одобрение токенов для моста...");
  const approveTx = await l1Token.approve(L1_BRIDGE_ADDRESS, AMOUNT_TO_BRIDGE);
  await approveTx.wait();
  console.log("Токены одобрены для моста");

  // Вычисляем необходимое количество ETH для транзакции
  const ethRequired = ethers.utils.parseEther("0.01");

  // Подключаемся к контракту моста
  const l1Bridge = new ethers.Contract(L1_BRIDGE_ADDRESS, L1TokenBridgeABI, wallet);

  // Отправляем токены через мост
  console.log("Отправка токенов через мост...");
  const bridgeTx = await l1Bridge.bridgeToken(
    AMOUNT_TO_BRIDGE,
    GAS_LIMIT,
    { 
      value: ethRequired,
      gasLimit: GAS_LIMIT 
    }
  );
  
  await bridgeTx.wait();
  console.log("Токены отправлены через мост!");
  console.log("Хэш транзакции:", bridgeTx.hash);
  console.log("Токены будут доступны на L2 после подтверждения транзакции (обычно это занимает несколько минут)");
  
  // Подсказка по проверке баланса на L2
  console.log("\nДля проверки баланса на L2 запустите скрипт проверки баланса L2");
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
  getPrivateKey,
  getBridgeConfig
}; 