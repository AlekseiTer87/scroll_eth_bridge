const { ethers } = require("hardhat");
const fs = require("fs");

// Загружаем адреса из файла
if (!fs.existsSync("addresses.json")) {
  console.error("Файл addresses.json не найден! Сначала запустите deploy.js");
  process.exit(1);
}

const addresses = JSON.parse(fs.readFileSync("addresses.json", "utf8"));
const L1_TOKEN_ADDRESS = addresses.l1.token;
const L1_BRIDGE_ADDRESS = addresses.l1.bridge;

// Количество токенов для перевода (например, 10 токенов с 18 десятичными знаками)
const AMOUNT_TO_BRIDGE = ethers.utils.parseEther("5555");

// Лимит газа для выполнения транзакции на L2
const GAS_LIMIT = 1000000;

async function main() {
  const [sender] = await ethers.getSigners();
  console.log("Отправка токенов с аккаунта:", sender.address);

  // Подключаемся к контрактам
  const l1Token = await ethers.getContractAt("L1CustomToken", L1_TOKEN_ADDRESS);
  const l1Bridge = await ethers.getContractAt("L1TokenBridge", L1_BRIDGE_ADDRESS);

  // Проверяем баланс токенов L1
  const balance = await l1Token.balanceOf(sender.address);
  console.log("Баланс L1 токенов:", ethers.utils.formatEther(balance));

  // Если у пользователя нет токенов, минтим их
  if (balance.lt(AMOUNT_TO_BRIDGE)) {
    console.log("Недостаточно токенов, минтим новые...");
    const mintTx = await l1Token.mint(sender.address, AMOUNT_TO_BRIDGE);
    await mintTx.wait();
    console.log("Токены созданы, новый баланс:", ethers.utils.formatEther(await l1Token.balanceOf(sender.address)));
  }

  console.log(`Отправка ${ethers.utils.formatEther(AMOUNT_TO_BRIDGE)} токенов с L1 на L2...`);

  // Одобряем мост на использование наших токенов
  console.log("Одобрение токенов для моста...");
  const approveTx = await l1Token.approve(L1_BRIDGE_ADDRESS, AMOUNT_TO_BRIDGE);
  await approveTx.wait();
  console.log("Токены одобрены для моста");

  // Вычисляем необходимое количество ETH для транзакции
  // Для локального тестирования используем 0.01 ETH
  const ethRequired = ethers.utils.parseEther("0.01");

  // Отправляем токены через мост, используя нашу новую функцию bridgeToken
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
  console.log("\nДля проверки баланса на L2 запустите:");
  console.log("npx hardhat run scripts/checkL2Balance.js --network l2_scrollsdk");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 