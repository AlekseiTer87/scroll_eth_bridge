const { ethers } = require("hardhat");
const fs = require("fs");

// Загрузка адресов из файла
if (!fs.existsSync("addresses.json")) {
  console.error("addresses.json файл не найден! Запустите deploy.js сначала");
  process.exit(1);
}

const addresses = JSON.parse(fs.readFileSync("addresses.json", "utf8"));
const L2_TOKEN_ADDRESS = addresses.l2.token;
const L2_BRIDGE_ADDRESS = addresses.l2.bridge;

// Количество токенов для передачи (например, 10 токенов с 18 десятичными знаками)
const AMOUNT_TO_BRIDGE = ethers.utils.parseEther("10000");

// Лимит газа для транзакции на L1
const GAS_LIMIT = 1000000;

// L1 RPC URL для расчета комиссии (переопределите через env L1_RPC_URL)
const L1_RPC_URL = process.env.L1_RPC_URL || "http://l1-devnet.scrollsdk";
const l1Provider = new ethers.providers.JsonRpcProvider(L1_RPC_URL);

async function main() {
  const [sender] = await ethers.getSigners();
  console.log("Отправляем токены из L2 в L1 от аккаунта:", sender.address);

  // Подключение к контрактам
  const l2Token = await ethers.getContractAt("L2CustomToken", L2_TOKEN_ADDRESS);
  const l2Bridge = await ethers.getContractAt("L2TokenBridge", L2_BRIDGE_ADDRESS);

  // Проверка баланса токенов на L2
  const balance = await l2Token.balanceOf(sender.address);
  console.log("Баланс L2 токенов:", ethers.utils.formatEther(balance));

  // Если пользователь не имеет достаточного количества токенов, выйдите с ошибкой
  if (balance.lt(AMOUNT_TO_BRIDGE)) {
    console.error("Недостаточно токенов на L2. Сначала запустите bridge-l1-to-l2.");
    process.exit(1);
  }

  console.log(`Отправляем ${ethers.utils.formatEther(AMOUNT_TO_BRIDGE)} токенов из L2 в L1...`);

  // Расчет комиссии за переход между цепями: L1 gasPrice * gas limit
  const gasPriceL1 = await l1Provider.getGasPrice();
  const ethRequired = gasPriceL1.mul(GAS_LIMIT);
  console.log(`Комиссия за переход между цепями: ${ethers.utils.formatEther(ethRequired)} ETH (gasPrice: ${ethers.utils.formatUnits(gasPriceL1, "gwei")} gwei × gasLimit ${GAS_LIMIT})`);

  console.log("Отправляем токены через мост...");
  const bridgeTx = await l2Bridge.bridgeToken(
    AMOUNT_TO_BRIDGE,
    GAS_LIMIT,
    { value: ethRequired, gasLimit: GAS_LIMIT }
  );

  await bridgeTx.wait();
  console.log("Токены отправлены через мост!");
  console.log("Хэш транзакции:", bridgeTx.hash);
  console.log("Токены будут доступны на L1 после подтверждения транзакции (обычно это занимает несколько минут)");

  // Подсказка по проверке баланса на L1
  console.log("\nДля проверки баланса на L1 запустите:");
  console.log("npx hardhat run scripts/checkL1Balance.js --network l1_scrollsdk");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });