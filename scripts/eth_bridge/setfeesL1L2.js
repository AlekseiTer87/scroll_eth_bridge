const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// RPC URLs (можно заменить на свои)
const L1_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const L2_RPC_URL = "https://sepolia-rpc.scroll.io";

// ABI для setFees
const LockBridgeABI = [
  "function setFees(uint256 fixedFee, uint256 percentFeeBps, uint256 gasMarkupBps) external"
];

// Получение приватного ключа
async function getPrivateKey() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
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

// Получение новых комиссий
async function getFees() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  function ask(q) { return new Promise(res => rl.question(q, res)); }
  const fixedFee = await ask("Введите фиксированную комиссию (ETH, например 0.002): ");
  const percentFeeBps = await ask("Введите процентную комиссию (bps, например 20 для 0.2%): ");
  const gasMarkupBps = await ask("Введите наценку на газ (bps, например 2000 для 20%): ");
  rl.close();
  return {
    fixedFee: ethers.utils.parseEther(fixedFee),
    percentFeeBps: parseInt(percentFeeBps),
    gasMarkupBps: parseInt(gasMarkupBps)
  };
}

async function main() {
  const privateKey = await getPrivateKey();
  const { fixedFee, percentFeeBps, gasMarkupBps } = await getFees();

  // Загружаем адреса мостов
  const addressesPath = path.join(__dirname, "../../bridge_deployment/addresses.json");
  if (!fs.existsSync(addressesPath)) {
    console.error("Файл bridge_deployment/addresses.json не найден!");
    process.exit(1);
  }
  const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf8"));

  // Настраиваем провайдеры и кошелек
  const l1Provider = new ethers.providers.JsonRpcProvider(L1_RPC_URL);
  const l2Provider = new ethers.providers.JsonRpcProvider(L2_RPC_URL);
  const l1Wallet = new ethers.Wallet(privateKey, l1Provider);
  const l2Wallet = new ethers.Wallet(privateKey, l2Provider);

  // Получаем контракты мостов
  const l1Bridge = new ethers.Contract(addresses.eth.l1.bridge, LockBridgeABI, l1Wallet);
  const l2Bridge = new ethers.Contract(addresses.eth.l2.bridge, LockBridgeABI, l2Wallet);

  // Устанавливаем комиссии на L1
  console.log("\nУстановка комиссий на L1...");
  const tx1 = await l1Bridge.setFees(fixedFee, percentFeeBps, gasMarkupBps);
  console.log("Транзакция отправлена (L1):", tx1.hash);
  await tx1.wait();
  console.log("Комиссии на L1 установлены!");

  // Устанавливаем комиссии на L2
  console.log("\nУстановка комиссий на L2...");
  const tx2 = await l2Bridge.setFees(fixedFee, percentFeeBps, gasMarkupBps);
  console.log("Транзакция отправлена (L2):", tx2.hash);
  await tx2.wait();
  console.log("Комиссии на L2 установлены!");

  console.log("\nГотово!");
}

main().catch(e => { console.error(e); process.exit(1); });
