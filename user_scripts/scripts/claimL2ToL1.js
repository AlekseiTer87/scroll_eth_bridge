const fs = require("fs");
const axios = require("axios");
const { ethers } = require("ethers");
const readline = require("readline");
const path = require("path");

// URL для сети Ethereum Sepolia
const L1_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

// Интерфейсы контрактов
const IL1ScrollMessengerABI = [
  "function relayMessageWithProof(address _sender, address _target, uint256 _value, uint256 _messageNonce, bytes memory _message, tuple(uint256 batchIndex, bytes merkleProof) memory _proof) external payable",
  "function xDomainMessageSender() external view returns (address)"
];

const L1TokenBridgeABI = [
  "function messenger() external view returns (address)"
];

const L1TokenABI = [
  "function balanceOf(address account) external view returns (uint256)"
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

// Функция для получения хэша транзакции
async function getTransactionHash() {
  // Проверяем, есть ли файл с последней транзакцией
  const txDataPath = path.join(__dirname, "..", "last_tx.json");
  let lastTxHash = "";
  
  if (fs.existsSync(txDataPath)) {
    try {
      const txData = JSON.parse(fs.readFileSync(txDataPath, "utf8"));
      lastTxHash = txData.TX_HASH || "";
      if (lastTxHash) {
        console.log(`Найден хэш последней транзакции: ${lastTxHash}`);
      }
    } catch (error) {
      console.log("Не удалось прочитать файл с последней транзакцией");
    }
  }
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    const prompt = lastTxHash 
      ? `Введите хэш транзакции L2 (или нажмите Enter для использования ${lastTxHash}): `
      : "Введите хэш транзакции L2: ";
    
    rl.question(prompt, (hash) => {
      rl.close();
      // Если пользователь просто нажал Enter и у нас есть последний хэш
      if (!hash && lastTxHash) {
        hash = lastTxHash;
      }
      
      if (!hash.startsWith("0x") || hash.length !== 66) {
        console.error("Хэш транзакции должен начинаться с 0x и иметь длину 66 символов");
        process.exit(1);
      }
      resolve(hash);
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
    L1_TOKEN_ADDRESS: addresses.token.l1.token,
    L1_BRIDGE_ADDRESS: addresses.token.l1.bridge
  };
}

async function main() {
  // Получение хэша транзакции и приватного ключа
  const txHash = await getTransactionHash();
  const privateKey = await getPrivateKey();
  
  // Настройка провайдера и кошелька
  const l1Provider = new ethers.providers.JsonRpcProvider(L1_RPC_URL);
  const wallet = new ethers.Wallet(privateKey, l1Provider);
  console.log("Адрес претендента (L1):", wallet.address);
  console.log("Хэш транзакции L2:", txHash);

  // Загрузка адресов моста из addresses.json
  const addressesPath = path.join(__dirname, "../../bridge_deployment/addresses.json");
  let addresses;
  try {
    addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  } catch (error) {
    console.error("Ошибка при чтении файла addresses.json:", error.message);
    process.exit(1);
  }
  
  const L1_BRIDGE_ADDRESS = addresses.token.l1.bridge;
  const L1_TOKEN_ADDRESS = addresses.token.l1.token;
  
  console.log("Адрес моста L1:", L1_BRIDGE_ADDRESS);
  console.log("Адрес токена L1:", L1_TOKEN_ADDRESS);

  // Подключение к контрактам
  const l1Bridge = new ethers.Contract(L1_BRIDGE_ADDRESS, L1TokenBridgeABI, wallet);
  const l1Token = new ethers.Contract(L1_TOKEN_ADDRESS, L1TokenABI, wallet);
  
  // Получение адреса messenger'а из контракта моста
  const messengerAddress = await l1Bridge.messenger();
  console.log("Адрес Scroll Messenger:", messengerAddress);
  const messenger = new ethers.Contract(messengerAddress, IL1ScrollMessengerABI, wallet);
  
  // Проверка начального баланса токенов
  const initialBalance = await l1Token.balanceOf(wallet.address);
  console.log("Начальный баланс L1 токенов:", ethers.utils.formatEther(initialBalance));

  // Запрос доказательства и данных сообщения из Bridge History API
  const api = process.env.BRIDGE_HISTORY_API_URL || "https://sepolia-api-bridge-v2.scroll.io";
  console.log(`Запрос доказательства из Bridge History API (${api}/api/txsbyhashes)...`);
  
  let msgData;
  try {
    const response = await axios.post(
      `${api}/api/txsbyhashes`,
      { txs: [txHash] }
    );
    // Проверка на ошибки уровня API
    if (response.data.errcode !== 0) {
      console.error("Ошибка Bridge History API:", response.data.errmsg);
      process.exit(1);
    }
    const items = response.data.data.results;
    if (!items || items.length === 0) {
      console.error("Bridge History API не вернул данные для этого хэша");
      process.exit(1);
    }
    msgData = items[0];
  } catch (error) {
    console.error("Не удалось получить доказательство из /api/txsbyhashes:", error.message);
    process.exit(1);
  }

  // Парсинг данных заявки из ответа API
  const claimInfo = msgData.claim_info;
  if (!claimInfo || !claimInfo.claimable) {
    console.error("Транзакция не может быть заявлена еще");
    process.exit(1);
  }

  // Оригинальный отправитель на L2 и необработанный получатель (пользователь) из данных заявки
  const from = claimInfo.from;
  const rawTo = claimInfo.to;
  const value = ethers.BigNumber.from(claimInfo.value);
  const messageNonce = parseInt(claimInfo.nonce, 10);
  const message = claimInfo.message;
  
  // Построение структуры доказательства для relayMessageWithProof
  const proof = {
    batchIndex: parseInt(claimInfo.proof.batch_index, 10),
    merkleProof: claimInfo.proof.merkle_proof
  };
  
  // Отладочные значения для проверки, что ничего не undefined
  console.log("Необработанные значения:");
  console.log("- from:", from);
  console.log("- to (raw recipient):", rawTo);
  console.log("- value:", value.toString(), "wei");
  console.log("- messageNonce:", messageNonce);
  console.log("- message length:", message ? message.length : 'undefined');
  console.log("- proof.batchIndex:", proof.batchIndex);
  console.log("- proof.merkleProof:", proof.merkleProof ? (proof.merkleProof.substring(0, 10) + '...') : 'undefined');

  // Передача доказательства в контракт L1 bridge, чтобы он вызывал finalizeWithdrawERC20
  console.log("Отправка транзакции relayMessageWithProof...");
  try {
    const tx = await messenger.relayMessageWithProof(
      from,                                 // оригинальный отправитель
      L1_BRIDGE_ADDRESS,                    // целевой контракт моста на L1
      value,                                // сумма для передачи
      messageNonce,                         // nonce сообщения
      message,                              // закодированный вызов finalizeWithdraw
      {                                     // proof struct
        batchIndex: proof.batchIndex,
        merkleProof: proof.merkleProof
      },
      { gasLimit: 2000000 }
    );

    console.log("Транзакция отправлена. Хэш:", tx.hash);
    console.log("Ожидание подтверждения...");
    
    const receipt = await tx.wait();
    console.log("✅ Транзакция заявки подтверждена. Хэш:", receipt.transactionHash);
    
    // Проверка конечного баланса токенов
    const finalBalance = await l1Token.balanceOf(wallet.address);
    console.log("Конечный баланс L1 токенов:", ethers.utils.formatEther(finalBalance));
    const balanceDiff = finalBalance.sub(initialBalance);
    console.log("Изменение баланса:", ethers.utils.formatEther(balanceDiff));
    
    if (balanceDiff.isZero()) {
      console.log("⚠️ Предупреждение: Токены не были получены. Проверка статуса транзакции...");
      
      // Проверка статуса транзакции и журналов
      console.log("Статус транзакции:", receipt.status ? "Успех (1)" : "Неудача (0)");
      console.log("Использовано газа:", receipt.gasUsed.toString());
      if (receipt.logs && receipt.logs.length > 0) {
        console.log(`Транзакция выпустила ${receipt.logs.length} событий/журналов`);
      } else {
        console.log("Транзакция не выпустила никаких событий");
      }
    } else {
      console.log("Ваши токены должны теперь быть доступны на L1.");
    }
  } catch (error) {
    console.error("Ошибка при отправке транзакции:", error.message);
    
    // Дополнительная информация об ошибке для помощи в отладке
    if (error.reason) {
      console.error("Причина ошибки:", error.reason);
    }
    
    if (error.code) {
      console.error("Код ошибки:", error.code);
    }
    
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Ошибка в скрипте заявки:", error);
    process.exit(1);
  }); 