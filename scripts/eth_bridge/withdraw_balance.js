const { ethers } = require("hardhat");
const fs = require("fs");
const hardhatConfig = require("../../hardhat.config.js");

// Получение URL из конфигурации hardhat
const L1_RPC_URL = hardhatConfig.networks.l1_scrollsdk.url;
const L2_RPC_URL = hardhatConfig.networks.l2_scrollsdk.url;
const PRIVATE_KEY = hardhatConfig.networks.l1_scrollsdk.accounts[0];

// Настройки газа
const MAX_PRIORITY_FEE_PER_GAS = ethers.utils.parseUnits("2", "gwei");

async function getGasSettings(provider) {
    const feeData = await provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas 
        ? feeData.maxFeePerGas.mul(150).div(100) // увеличиваем на 50%
        : undefined;
    
    return {
        maxFeePerGas,
        maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS
    };
}

async function withdrawFromBridge(bridge, amount, wallet, chainName, gasSettings) {
    console.log(`\nВывод ${ethers.utils.formatEther(amount)} ETH из ${chainName} моста...`);
    
    try {
        const tx = await bridge.connect(wallet).withdrawBridgeBalance(
            amount,
            wallet.address,
            {
                ...gasSettings,
                gasLimit: 100000
            }
        );
        console.log(`Транзакция отправлена: ${tx.hash}`);
        await tx.wait();
        console.log(`Транзакция подтверждена`);
    } catch (error) {
        console.error(`Ошибка при выводе из ${chainName} моста:`, error.message);
        throw error;
    }
}

async function main() {
    const amountStr = process.env.AMOUNT;
    if (!amountStr) {
        console.error("Укажите сумму для вывода в ETH через переменную окружения AMOUNT!");
        console.log("Пример: AMOUNT=0.1 npx hardhat run lock_bridge_script/withdraw_balance.js --network l1_scrollsdk");
        process.exit(1);
    }

    const amountToWithdraw = ethers.utils.parseEther(amountStr);
    console.log(`Сумма для вывода: ${ethers.utils.formatEther(amountToWithdraw)} ETH`);

    // Загружаем адреса мостов
    const addresses = JSON.parse(fs.readFileSync("./lock_bridge_script/addresses.json"));

    // Настраиваем провайдеры и кошельки
    const l1Provider = new ethers.providers.JsonRpcProvider(L1_RPC_URL);
    const l2Provider = new ethers.providers.JsonRpcProvider(L2_RPC_URL);
    const l1Wallet = new ethers.Wallet(PRIVATE_KEY, l1Provider);
    const l2Wallet = new ethers.Wallet(PRIVATE_KEY, l2Provider);

    console.log("Адрес кошелька:", l1Wallet.address);

    // Получаем контракты мостов
    const L1Bridge = await ethers.getContractFactory("L1LockBridge");
    const L2Bridge = await ethers.getContractFactory("L2LockBridge");
    
    const l1Bridge = L1Bridge.attach(addresses.l1.bridge);
    const l2Bridge = L2Bridge.attach(addresses.l2.bridge);

    // Проверяем балансы мостов
    const l1Balance = await l1Provider.getBalance(addresses.l1.bridge);
    const l2Balance = await l2Provider.getBalance(addresses.l2.bridge);

    console.log("\n=== Текущие балансы мостов ===");
    console.log("L1 мост:", ethers.utils.formatEther(l1Balance), "ETH");
    console.log("L2 мост:", ethers.utils.formatEther(l2Balance), "ETH");

    // Проверяем достаточность средств
    if (l1Balance.lt(amountToWithdraw)) {
        console.log("\nНедостаточно средств на L1 мосту!");
        console.log("Запрошено:", ethers.utils.formatEther(amountToWithdraw), "ETH");
        console.log("Доступно:", ethers.utils.formatEther(l1Balance), "ETH");
    } else {
        const l1GasSettings = await getGasSettings(l1Provider);
        await withdrawFromBridge(l1Bridge, amountToWithdraw, l1Wallet, "L1", l1GasSettings);
    }

    if (l2Balance.lt(amountToWithdraw)) {
        console.log("\nНедостаточно средств на L2 мосту!");
        console.log("Запрошено:", ethers.utils.formatEther(amountToWithdraw), "ETH");
        console.log("Доступно:", ethers.utils.formatEther(l2Balance), "ETH");
    } else {
        const l2GasSettings = await getGasSettings(l2Provider);
        await withdrawFromBridge(l2Bridge, amountToWithdraw, l2Wallet, "L2", l2GasSettings);
    }

    // Проверяем новые балансы
    const newL1Balance = await l1Provider.getBalance(addresses.l1.bridge);
    const newL2Balance = await l2Provider.getBalance(addresses.l2.bridge);

    console.log("\n=== Новые балансы мостов ===");
    console.log("L1 мост:", ethers.utils.formatEther(newL1Balance), "ETH");
    console.log("L2 мост:", ethers.utils.formatEther(newL2Balance), "ETH");

    // Проверяем баланс кошелька
    const l1WalletBalance = await l1Wallet.getBalance();
    const l2WalletBalance = await l2Wallet.getBalance();

    console.log("\n=== Баланс вашего кошелька ===");
    console.log("L1:", ethers.utils.formatEther(l1WalletBalance), "ETH");
    console.log("L2:", ethers.utils.formatEther(l2WalletBalance), "ETH");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 