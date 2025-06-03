const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ABI для контракта моста
const L1LockBridgeABI = [
  "function bridgeETH(uint256 gasLimit, uint256 gasPrice) external payable",
  "function counterpart() external view returns (address)",
  "function router() external view returns (address)",
  "function messenger() external view returns (address)"
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

// Функция для получения количества ETH
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
    L1_BRIDGE_ADDRESS: addresses.eth.l1.bridge
  };
}

// Основная функция
async function main() {
  try {
    // Получаем приватный ключ
    const privateKey = await getPrivateKey();
    
    // Получаем конфигурацию моста
    const config = await getBridgeConfig(privateKey);
    const { wallet, L1_BRIDGE_ADDRESS } = config;
    
    // Проверяем баланс ETH
    const balance = await wallet.getBalance();
    console.log("\nТекущий баланс ETH:", ethers.utils.formatEther(balance));
    
    // Получаем количество ETH для перевода
    const ethAmount = await getETHAmount();
    const AMOUNT_TO_BRIDGE = ethers.utils.parseEther(ethAmount.toString());
    
    // Проверяем достаточность баланса
    if (balance.lt(AMOUNT_TO_BRIDGE)) {
      console.error("\nОшибка: Недостаточно ETH для перевода!");
      console.error(`Требуется: ${ethers.utils.formatEther(AMOUNT_TO_BRIDGE)} ETH`);
      console.error(`Доступно: ${ethers.utils.formatEther(balance)} ETH`);
      process.exit(1);
    }
    
    console.log("Отправка ETH с аккаунта:", wallet.address);
    
    // Лимит газа для выполнения транзакции на L2
    const GAS_LIMIT = 1000000;
    // Получаем актуальную цену газа
    const gasPrice = await wallet.getGasPrice();
    // Подключаемся к контракту моста
    const l1Bridge = new ethers.Contract(L1_BRIDGE_ADDRESS, L1LockBridgeABI, wallet);

    // Проверяем инициализацию контракта
    const counterpart = await l1Bridge.counterpart();
    const router = await l1Bridge.router();
    const messenger = await l1Bridge.messenger();

    console.log("\nПроверка инициализации контракта:");
    console.log("- Counterpart:", counterpart);
    console.log("- Router:", router);
    console.log("- Messenger:", messenger);

    if (counterpart === ethers.constants.AddressZero || 
        router === ethers.constants.AddressZero || 
        messenger === ethers.constants.AddressZero) {
      console.error("\nОшибка: Контракт не инициализирован!");
      console.error("Сначала запустите скрипт инициализации контракта");
      process.exit(1);
    }

    // Проверяем баланс контракта
    const bridgeBalance = await ethers.provider.getBalance(L1_BRIDGE_ADDRESS);
    console.log("\nБаланс контракта моста:", ethers.utils.formatEther(bridgeBalance));

    if (bridgeBalance.lt(AMOUNT_TO_BRIDGE)) {
      console.error("\nОшибка: Недостаточно ETH в контракте моста!");
      console.error(`Требуется: ${ethers.utils.formatEther(AMOUNT_TO_BRIDGE)} ETH`);
      console.error(`Доступно: ${ethers.utils.formatEther(bridgeBalance)} ETH`);
      console.error("Сначала пополните баланс контракта моста");
      process.exit(1);
    }

    // Рассчитываем комиссию (1 gwei * gasLimit)
    const fee = ethers.utils.parseUnits("1", "gwei").mul(GAS_LIMIT);
    console.log("\nРасчет комиссии:");
    console.log("- Лимит газа:", GAS_LIMIT);
    console.log("- Комиссия за газ:", ethers.utils.formatEther(fee), "ETH");
    console.log("- Итоговая сумма с комиссией:", ethers.utils.formatEther(AMOUNT_TO_BRIDGE.add(fee)), "ETH");

    // Проверяем, что сумма с комиссией не превышает баланс
    if (balance.lt(AMOUNT_TO_BRIDGE.add(fee))) {
      console.error("\nОшибка: Недостаточно ETH для комиссии!");
      console.error(`Требуется: ${ethers.utils.formatEther(AMOUNT_TO_BRIDGE.add(fee))} ETH (включая комиссию)`);
      console.error(`Доступно: ${ethers.utils.formatEther(balance)} ETH`);
      process.exit(1);
    }

    // Отправляем ETH через мост
    console.log("\nОтправка ETH через мост...");
    console.log("Параметры транзакции:");
    console.log("- Адрес контракта:", L1_BRIDGE_ADDRESS);
    console.log("- Количество ETH:", ethers.utils.formatEther(AMOUNT_TO_BRIDGE));
    console.log("- Лимит газа:", GAS_LIMIT);
    console.log("- Цена газа:", ethers.utils.formatUnits(gasPrice, "gwei"), "gwei");

    const bridgeTx = await l1Bridge.bridgeETH(
      GAS_LIMIT,
      gasPrice,
      {
        value: AMOUNT_TO_BRIDGE,
        gasLimit: GAS_LIMIT
      }
    );
    
    console.log("\nТранзакция отправлена! Ожидание подтверждения...");
    console.log("Хэш транзакции:", bridgeTx.hash);
    
    const receipt = await bridgeTx.wait();
    
    if (receipt.status === 0) {
      console.error("\nОшибка: Транзакция не выполнена!");
      console.error("Проверьте логи транзакции для получения дополнительной информации");
      process.exit(1);
    }
    
    console.log("\nETH успешно отправлен через мост!");
    console.log("Хэш транзакции:", bridgeTx.hash);
    console.log("ETH будет доступен на L2 после подтверждения транзакции (обычно это занимает несколько минут)");
    
    // Подсказка по проверке баланса на L2
    console.log("\nДля проверки баланса на L2 запустите скрипт проверки баланса L2");
  } catch (error) {
    console.error("\nПроизошла ошибка при выполнении транзакции:");
    if (error.reason) {
      console.error("Причина:", error.reason);
    }
    if (error.transactionHash) {
      console.error("Хэш транзакции:", error.transactionHash);
    }
    console.error("Полная ошибка:", error);
    process.exit(1);
  }
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