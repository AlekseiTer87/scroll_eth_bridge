const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// RPC URLs
const L2_RPC_URL = "https://sepolia-rpc.scroll.io";
const L1_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

// ABI для L2LockBridge
const L2LockBridgeABI = [
  "function bridgeETH(uint256 gasLimit, uint256 gasPrice) external payable"
];

// Получение приватного ключа
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

// Получение количества ETH
async function getETHAmount() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question("Введите количество ETH для перевода: ", (amount) => {
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
  
  // Получаем провайдер из Hardhat
  const provider = ethers.provider;
  
  // Создание кошелька с указанным приватным ключом
  const wallet = new ethers.Wallet(userPrivateKey, provider);
  
  return {
    addresses,
    wallet,
    L2_BRIDGE_ADDRESS: addresses.eth.l2.bridge
  };
}

async function main() {
  // Получаем приватный ключ
  const privateKey = await getPrivateKey();

  // Загружаем адреса мостов
  const addressesPath = path.join(__dirname, "../../bridge_deployment/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.error("Файл addresses.json не найден! Сначала запустите deploy.js");
    process.exit(1);
  }
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  const L2_BRIDGE_ADDRESS = addresses.eth.l2.bridge;

  // Настройка провайдеров
  const l2Provider = new ethers.providers.JsonRpcProvider(L2_RPC_URL);
  const l1Provider = new ethers.providers.JsonRpcProvider(L1_RPC_URL);

  // Создание кошелька
  const wallet = new ethers.Wallet(privateKey, l2Provider);
  console.log("Отправка ETH с аккаунта:", wallet.address);

  // Проверка баланса ETH на L2
  const balance = await wallet.getBalance();
  console.log("\nТекущий баланс ETH на L2:", ethers.utils.formatEther(balance));

  // Получаем количество ETH для перевода
  const ethAmount = await getETHAmount();
  const AMOUNT_TO_BRIDGE = ethers.utils.parseEther(ethAmount.toString());

  if (balance.lt(AMOUNT_TO_BRIDGE)) {
    console.error("\nОшибка: Недостаточно ETH для перевода!");
    console.error(`Требуется: ${ethers.utils.formatEther(AMOUNT_TO_BRIDGE)} ETH`);
    console.error(`Доступно: ${ethers.utils.formatEther(balance)} ETH`);
    process.exit(1);
  }

  // Лимит газа для выполнения транзакции на L1
  const GAS_LIMIT = 1000000;
  // Получаем актуальную цену газа
  const gasPrice = await l2Provider.getGasPrice();

  // Расчет комиссии (fee) для кроссчейн-сообщения
  const fee = gasPrice.mul(GAS_LIMIT);
  console.log(`\nКомиссия за кроссчейн-сообщение: ${ethers.utils.formatEther(fee)} ETH (gasPrice: ${ethers.utils.formatUnits(gasPrice, "gwei")} gwei × gasLimit ${GAS_LIMIT})`);
  console.log(`Итого будет отправлено: ${ethers.utils.formatEther(AMOUNT_TO_BRIDGE.add(fee))} ETH`);

  if (balance.lt(AMOUNT_TO_BRIDGE.add(fee))) {
    console.error("\nОшибка: Недостаточно ETH для суммы + комиссии!");
    process.exit(1);
  }

  // Подключение к мосту
  const l2Bridge = new ethers.Contract(L2_BRIDGE_ADDRESS, L2LockBridgeABI, wallet);

  // Отправляем ETH через мост
  console.log("\nОтправка ETH через мост...");
  console.log("Параметры транзакции:");
  console.log("- Адрес контракта:", L2_BRIDGE_ADDRESS);
  console.log("- Количество ETH:", ethers.utils.formatEther(AMOUNT_TO_BRIDGE));
  console.log("- Лимит газа:", GAS_LIMIT);
  console.log("- Цена газа:", ethers.utils.formatUnits(gasPrice, "gwei"), "gwei");

  const bridgeTx = await l2Bridge.bridgeETH(
    GAS_LIMIT,
    gasPrice,
    { value: AMOUNT_TO_BRIDGE, gasLimit: GAS_LIMIT }
  );

  console.log("Транзакция отправлена! Ожидание подтверждения...");
  const receipt = await bridgeTx.wait();
  if (receipt.status === 0) {
    console.error("Ошибка: Транзакция не выполнена!");
    process.exit(1);
  }
  console.log("ETH отправлен через мост!");
  console.log("Хэш транзакции:", bridgeTx.hash);
  console.log("ETH будет доступен на L1 после подтверждения и клейма (claim).");
  console.log("Для получения ETH на L1 используйте скрипт claimL2ToL1ETH.js с этим хэшем транзакции.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });