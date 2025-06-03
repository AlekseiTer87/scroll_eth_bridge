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

const L1LockBridgeABI = [
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

// Функция для получения хэша транзакции
async function getTransactionHash() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve) => {
    rl.question("Введите хэш транзакции L2: ", (hash) => {
      rl.close();
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
    L1_BRIDGE_ADDRESS: addresses.eth.l1.bridge
  };
}

async function main() {
  const txHash = await getTransactionHash();
  const privateKey = await getPrivateKey();

  // Настройка провайдера и кошелька
  const l1Provider = new ethers.providers.JsonRpcProvider(L1_RPC_URL);
  const wallet = new ethers.Wallet(privateKey, l1Provider);
  console.log("Адрес претендента (L1):", wallet.address);
  console.log("Хэш транзакции L2:", txHash);

  // Загрузка адресов моста из addresses.json в директории скрипта
  const addressesPath = path.join(__dirname, "../../bridge_deployment/addresses.json");
  let addresses;
  try {
    addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
  } catch (error) {
    console.error("Ошибка при чтении файла addresses.json:", error.message);
    process.exit(1);
  }
  const L1_BRIDGE_ADDRESS = addresses.eth.l1.bridge;
  console.log("Адрес моста L1:", L1_BRIDGE_ADDRESS);

  // Подключение к контракту моста
  const l1Bridge = new ethers.Contract(L1_BRIDGE_ADDRESS, L1LockBridgeABI, wallet);

  // Получение адреса messenger'а из контракта моста
  const messengerAddress = await l1Bridge.messenger();
  console.log("Адрес Scroll Messenger:", messengerAddress);
  const messenger = new ethers.Contract(messengerAddress, IL1ScrollMessengerABI, wallet);

  // Запрос доказательства и данных сообщения из Bridge History API
  const api = process.env.BRIDGE_HISTORY_API_URL || "https://sepolia-api-bridge-v2.scroll.io";
  console.log(`Запрос доказательства из Bridge History API (${api}/api/txsbyhashes)...`);
  let msgData;
  try {
    const response = await axios.post(
      `${api}/api/txsbyhashes`,
      { txs: [txHash] }
    );
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
  const from = claimInfo.from;
  const rawTo = claimInfo.to;
  const value = ethers.BigNumber.from(claimInfo.value);
  const messageNonce = parseInt(claimInfo.nonce, 10);
  const message = claimInfo.message;
  const proof = {
    batchIndex: parseInt(claimInfo.proof.batch_index, 10),
    merkleProof: claimInfo.proof.merkle_proof
  };
  console.log("Необработанные значения:");
  console.log("- from:", from);
  console.log("- to (raw recipient):", rawTo);
  console.log("- value:", value.toString(), "wei");
  console.log("- messageNonce:", messageNonce);
  console.log("- message length:", message ? message.length : 'undefined');
  console.log("- proof.batchIndex:", proof.batchIndex);
  console.log("- proof.merkleProof:", proof.merkleProof ? (proof.merkleProof.substring(0, 10) + '...') : 'undefined');
  console.log(`К получению на L1 (после всех комиссий): ${ethers.utils.formatEther(value)} ETH`);

  // Проверяем соответствие адресов
  if (rawTo.toLowerCase() !== L1_BRIDGE_ADDRESS.toLowerCase()) {
    console.error("ОШИБКА: Адрес получателя в сообщении не соответствует адресу L1 моста");
    console.error("Ожидается:", L1_BRIDGE_ADDRESS);
    console.error("Получено:", rawTo);
    process.exit(1);
  }

  // Передача доказательства в контракт messenger, чтобы он вызвал finalizeWithdrawETH
  console.log("Отправка транзакции relayMessageWithProof...");
  try {
    const tx = await messenger.relayMessageWithProof(
      from,                                 // оригинальный отправитель
      L1_BRIDGE_ADDRESS,                    // целевой контракт моста на L1
      value,                                // сумма для передачи
      messageNonce,                         // nonce сообщения
      message,                              // закодированный вызов finalizeWithdrawETH
      {                                     // proof struct
        batchIndex: proof.batchIndex,
        merkleProof: proof.merkleProof
      },
      { gasLimit: 3000000 }                // увеличенный gas limit
    );
    console.log("Транзакция отправлена. Хэш:", tx.hash);
    console.log("Ожидание подтверждения...");
    const receipt = await tx.wait();
    console.log("✅ Транзакция заявки подтверждена. Хэш:", receipt.transactionHash);
  } catch (error) {
    console.error("Ошибка при отправке транзакции:", error.message);
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
