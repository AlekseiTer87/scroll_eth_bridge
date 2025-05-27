const fs = require("fs");
const axios = require("axios");
const { ethers } = require("hardhat");
// Загрузка хэша транзакции по умолчанию из конфига (переопределите с помощью env TX_HASH, если установлено)
const { TX_HASH: CONFIG_TX_HASH } = require("../claim.config");

async function main() {
  const [claimer] = await ethers.getSigners();
  console.log("Адрес претендента (L1):", claimer.address);

  // Используйте хэш транзакции L2 из конфига или переменной окружения
  const txHash = process.env.TX_HASH || CONFIG_TX_HASH;
  if (!txHash) {
    console.error("Пожалуйста, установите переменную окружения TX_HASH или обновите claim.config.js");
    process.exit(1);
  }
  console.log("Хэш транзакции L2:", txHash);

  // Загрузка адресов моста
  const addresses = JSON.parse(fs.readFileSync("addresses.json", "utf8"));
  const L1_BRIDGE_ADDRESS = addresses.l1.bridge;
  const L1_TOKEN_ADDRESS = addresses.l1.token;

  // Подключение к L1 TokenBridge и Scroll Messenger
  const l1Bridge = await ethers.getContractAt("L1TokenBridge", L1_BRIDGE_ADDRESS);
  const l1Token = await ethers.getContractAt("L1CustomToken", L1_TOKEN_ADDRESS);
  const messengerAddress = await l1Bridge.messenger();
  const messenger = await ethers.getContractAt("IL1ScrollMessenger", messengerAddress);
  
  // Проверка начального баланса токенов
  const initialBalance = await l1Token.balanceOf(claimer.address);
  console.log("Начальный баланс L1 токенов:", ethers.utils.formatEther(initialBalance));

  // Запрос доказательства и данных сообщения из Bridge History API
  const api = process.env.BRIDGE_HISTORY_API_URL || "http://bridge-history-api.scrollsdk";
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

  const receipt = await tx.wait();
  console.log("✅ Транзакция заявки отправлена. Хэш:", receipt.transactionHash);
  
  // Проверка конечного баланса токенов
  const finalBalance = await l1Token.balanceOf(claimer.address);
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
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error("Ошибка в скрипте заявки:", error);
    process.exit(1);
  }); 