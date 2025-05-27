const { ethers } = require("hardhat");
const fs = require("fs");

// Загружаем адреса из файла
if (!fs.existsSync("addresses.json")) {
  console.error("Файл addresses.json не найден! Сначала запустите deploy.js");
  process.exit(1);
}

const addresses = JSON.parse(fs.readFileSync("addresses.json", "utf8"));
const L1_TOKEN_ADDRESS = addresses.l1.token;

// Количество токенов для минтинга (например, 100 токенов с 18 десятичными знаками)
const MINT_AMOUNT = ethers.utils.parseEther("100");

async function main() {
  const [account] = await ethers.getSigners();
  console.log("Минтинг токенов для аккаунта:", account.address);

  // Подключаемся к контракту токена
  const l1Token = await ethers.getContractAt("L1CustomToken", L1_TOKEN_ADDRESS);
  
  // Проверяем текущий баланс
  const initialBalance = await l1Token.balanceOf(account.address);
  console.log("Текущий баланс:", ethers.utils.formatEther(initialBalance));

  // Минтим токены
  console.log(`Минтинг ${ethers.utils.formatEther(MINT_AMOUNT)} токенов...`);
  const mintTx = await l1Token.mint(account.address, MINT_AMOUNT);
  await mintTx.wait();
  
  // Проверяем новый баланс
  const newBalance = await l1Token.balanceOf(account.address);
  console.log("Новый баланс:", ethers.utils.formatEther(newBalance));
  
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