const { ethers } = require("hardhat");
const fs = require("fs");

// Загружаем адреса из файла
if (!fs.existsSync("addresses.json")) {
  console.error("Файл addresses.json не найден! Сначала запустите deploy.js");
  process.exit(1);
}

const addresses = JSON.parse(fs.readFileSync("addresses.json", "utf8"));
const L1_TOKEN_ADDRESS = addresses.l1.token;

async function main() {
  const [account] = await ethers.getSigners();
  console.log("Проверка баланса для аккаунта:", account.address);

  // Получаем баланс ETH
  const ethBalance = await account.getBalance();
  console.log("Баланс ETH (L1):", ethers.utils.formatEther(ethBalance), "ETH");

  // Подключаемся к контракту токена
  const l1Token = await ethers.getContractAt("L1CustomToken", L1_TOKEN_ADDRESS);
  
  // Проверяем баланс токенов
  const tokenBalance = await l1Token.balanceOf(account.address);
  console.log("Баланс токенов (L1):", ethers.utils.formatEther(tokenBalance));
  
  // Проверяем общее предложение токенов
  const totalSupply = await l1Token.totalSupply();
  console.log("Общее предложение токенов:", ethers.utils.formatEther(totalSupply));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 