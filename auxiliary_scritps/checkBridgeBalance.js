const fs = require("fs");
const { ethers } = require("hardhat");

async function main() {
  // Получение signers в обоих сетях
  const [l1Signer] = await ethers.getSigners();
  console.log("Проверка балансов для:", l1Signer.address);
  
  // Загрузка адресов
  const addresses = JSON.parse(fs.readFileSync("addresses.json", "utf8"));
  console.log("L1 Bridge:", addresses.l1.bridge);
  console.log("L1 Token:", addresses.l1.token);
  console.log("L2 Bridge:", addresses.l2.bridge);
  console.log("L2 Token:", addresses.l2.token);
  
  // Подключение к контрактам L1
  const l1Token = await ethers.getContractAt("L1CustomToken", addresses.l1.token);
  
  // Проверка балансов L1
  const userBalanceL1 = await l1Token.balanceOf(l1Signer.address);
  const bridgeBalanceL1 = await l1Token.balanceOf(addresses.l1.bridge);
  
  console.log("\n=== Балансы L1 токенов ===");
  console.log(`Ваш баланс L1: ${ethers.utils.formatEther(userBalanceL1)}`);
  console.log(`Баланс L1 Bridge: ${ethers.utils.formatEther(bridgeBalanceL1)}`);
  
  // Подключение к сети L2
  const l2Provider = new ethers.providers.JsonRpcProvider("http://l2-rpc.scrollsdk");
  const l2Wallet = new ethers.Wallet("0xd44828b92f6c5ed72250325882bed43206da13121d75f89b5007dc1c26c3cc8d", l2Provider);
  
  // Подключение к контрактам L2
  const l2Token = new ethers.Contract(
    addresses.l2.token,
    [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)"
    ],
    l2Wallet
  );
  
  // Проверка балансов L2
  const userBalanceL2 = await l2Token.balanceOf(l1Signer.address);
  const bridgeBalanceL2 = await l2Token.balanceOf(addresses.l2.bridge);
  
  console.log("\n=== Балансы L2 токенов ===");
  console.log(`Ваш баланс L2: ${ethers.utils.formatEther(userBalanceL2)}`);
  console.log(`Баланс L2 Bridge: ${ethers.utils.formatEther(bridgeBalanceL2)}`);
  
  // Проверка на ожидающие сообщения
  const amount = ethers.utils.parseEther("99123");
  console.log("\n=== Сумма токенов ===");
  console.log(`Сумма, которая была передана: ${ethers.utils.formatEther(amount)}`);
  
  // Сумма ETH, отправленная в сообщении, была только комиссией ETH
  const fee = ethers.utils.parseEther("0.001003111356");
  console.log(`Сумма ETH, отправленная в сообщении: ${ethers.utils.formatEther(fee)}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  }); 