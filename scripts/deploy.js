const { ethers } = require("hardhat");
const fs = require("fs");
const hardhatConfig = require("../hardhat.config.js");

// Адреса системных контрактов Scroll
const L1_GATEWAY_ROUTER_PROXY_ADDR = "0x13FBE0D0e5552b8c9c4AE9e2435F38f37355998a";
const L2_GATEWAY_ROUTER_PROXY_ADDR = "0x9aD3c5617eCAa556d6E166787A97081907171230";
const L1_SCROLL_MESSENGER_PROXY_ADDR = "0x50c7d3e7f7c656493D1D76aaa1a836CedfCBB16A";
const L2_SCROLL_MESSENGER_PROXY_ADDR = "0xBa50f5340FB9F3Bd074bD638c9BE13eCB36E603d";

// Получение URL и приватного ключа из конфигурации hardhat
const L1_RPC_URL = hardhatConfig.networks.l1_scrollsdk.url;
const L2_RPC_URL = hardhatConfig.networks.l2_scrollsdk.url;
const PRIVATE_KEY = hardhatConfig.networks.l1_scrollsdk.accounts[0];

// Начальный баланс для ETH мостов 
const INITIAL_BRIDGE_BALANCE = ethers.utils.parseEther("0.001");

// Настройки газа
const GAS_MULTIPLIER = 1.5;
const MAX_FEE_PER_GAS_MULTIPLIER = 1.5;
const MAX_PRIORITY_FEE_PER_GAS = ethers.utils.parseUnits("2", "gwei");

// Вспомогательные функции
async function getGasSettings(provider) {
    const feeData = await provider.getFeeData();
    const maxFeePerGas = feeData.maxFeePerGas 
        ? feeData.maxFeePerGas.mul(Math.floor(MAX_FEE_PER_GAS_MULTIPLIER * 100)).div(100)
        : undefined;
    
    return {
        maxFeePerGas,
        maxPriorityFeePerGas: MAX_PRIORITY_FEE_PER_GAS
    };
}

async function sendTransactionWithRetry(tx, description) {
    console.log(`Отправка транзакции: ${description}...`);
    const response = await tx;
    console.log(`Ожидание подтверждения: ${description}...`);
    await response.wait();
    console.log(`Транзакция выполнена: ${description}`);
    return response;
}

async function checkContractBalance(contract, description) {
    const balance = await ethers.provider.getBalance(contract.address);
    console.log(`${description}: ${ethers.utils.formatEther(balance)} ETH`);
    return balance;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log("Использую конфигурацию из hardhat.config.js:");
    console.log("L1 RPC URL:", L1_RPC_URL);
    console.log("L2 RPC URL:", L2_RPC_URL);

    const l1Provider = new ethers.providers.JsonRpcProvider(L1_RPC_URL);
    const l2Provider = new ethers.providers.JsonRpcProvider(L2_RPC_URL);
    const l1Wallet = new ethers.Wallet(PRIVATE_KEY, l1Provider);
    const l2Wallet = new ethers.Wallet(PRIVATE_KEY, l2Provider);

    console.log("\n=== Деплой мостов для нативного ETH ===");

    // Проверяем балансы на обеих сетях
    const l1Balance = await l1Wallet.getBalance();
    const l2Balance = await l2Wallet.getBalance();

    console.log("\n=== Начальные балансы ===");
    console.log("L1 баланс:", ethers.utils.formatEther(l1Balance), "ETH");
    console.log("L2 баланс:", ethers.utils.formatEther(l2Balance), "ETH");

    // Проверяем достаточность средств
    const requiredL1Balance = INITIAL_BRIDGE_BALANCE.add(ethers.utils.parseEther("0.1"));
    const requiredL2Balance = INITIAL_BRIDGE_BALANCE.add(ethers.utils.parseEther("0.1"));

    if (l1Balance.lt(requiredL1Balance)) {
        throw new Error(`Недостаточно ETH на L1. Нужно минимум ${ethers.utils.formatEther(requiredL1Balance)} ETH`);
    }

    if (l2Balance.lt(requiredL2Balance)) {
        throw new Error(`Недостаточно ETH на L2. Нужно минимум ${ethers.utils.formatEther(requiredL2Balance)} ETH`);
    }

    // Получаем настройки газа для L1
    const l1GasSettings = await getGasSettings(l1Provider);
    
    // Деплой L1 ETH моста
    console.log("\nДеплой L1 ETH моста...");
    const L1LockBridge = await ethers.getContractFactory("L1LockBridge");
    const l1EthBridge = await L1LockBridge.deploy(l1GasSettings);
    await l1EthBridge.deployed();
    console.log("L1 ETH мост развернут по адресу:", l1EthBridge.address);

    // Ждем синхронизации
    console.log("\nОжидание синхронизации сетей (10 секунд)...");
    await sleep(10000);

    // Получаем настройки газа для L2
    const l2GasSettings = await getGasSettings(l2Provider);
    
    // Деплой L2 ETH моста
    console.log("\nДеплой L2 ETH моста...");
    const L2LockBridge = await ethers.getContractFactory("L2LockBridge", l2Wallet);
    const l2EthBridge = await L2LockBridge.deploy(l2GasSettings);
    await l2EthBridge.deployed();
    console.log("L2 ETH мост развернут по адресу:", l2EthBridge.address);

    // Инициализация ETH мостов
    console.log("\nИнициализация L1 ETH моста...");
    await sendTransactionWithRetry(
        l1EthBridge.initialize(
            l2EthBridge.address,
            L1_GATEWAY_ROUTER_PROXY_ADDR,
            L1_SCROLL_MESSENGER_PROXY_ADDR,
            {
                ...l1GasSettings,
                gasLimit: 1000000
            }
        ),
        "Инициализация L1 ETH моста"
    );

    console.log("\nИнициализация L2 ETH моста...");
    await sendTransactionWithRetry(
        l2EthBridge.initialize(
            l1EthBridge.address,
            L2_GATEWAY_ROUTER_PROXY_ADDR,
            L2_SCROLL_MESSENGER_PROXY_ADDR,
            {
                ...l2GasSettings,
                gasLimit: 1000000
            }
        ),
        "Инициализация L2 ETH моста"
    );

    // Добавление начальных балансов в ETH мосты
    console.log("\nДобавление начального баланса в L1 ETH мост...");
    await sendTransactionWithRetry(
        l1EthBridge.addBridgeBalance({
            ...l1GasSettings,
            value: INITIAL_BRIDGE_BALANCE,
            gasLimit: 100000
        }),
        "Добавление начального баланса в L1 ETH мост"
    );

    console.log("\nДобавление начального баланса в L2 ETH мост...");
    await sendTransactionWithRetry(
        l2EthBridge.connect(l2Wallet).addBridgeBalance({
            ...l2GasSettings,
            value: INITIAL_BRIDGE_BALANCE,
            gasLimit: 100000
        }),
        "Добавление начального баланса в L2 ETH мост"
    );

    console.log("\n=== Деплой мостов для токенов ===");

    // Деплой L1 токена
    console.log("\nДеплой L1 токена...");
    const L1CustomToken = await ethers.getContractFactory("L1CustomToken");
    const l1Token = await L1CustomToken.deploy();
    await l1Token.deployed();
    console.log("L1 токен развернут по адресу:", l1Token.address);

    // Деплой L1 токен моста
    console.log("\nДеплой L1 токен моста...");
    const L1TokenBridge = await ethers.getContractFactory("L1TokenBridge");
    const l1TokenBridge = await L1TokenBridge.deploy();
    await l1TokenBridge.deployed();
    console.log("L1 токен мост развернут по адресу:", l1TokenBridge.address);

    // Деплой L2 токен моста
    console.log("\nДеплой L2 токен моста...");
    const L2TokenBridge = await ethers.getContractFactory("L2TokenBridge", l2Wallet);
    const l2TokenBridge = await L2TokenBridge.deploy();
    await l2TokenBridge.deployed();
    console.log("L2 токен мост развернут по адресу:", l2TokenBridge.address);

    // Деплой L2 токена
    console.log("\nДеплой L2 токена...");
    const L2CustomToken = await ethers.getContractFactory("L2CustomToken", l2Wallet);
    const l2Token = await L2CustomToken.deploy(l2TokenBridge.address, l1Token.address);
    await l2Token.deployed();
    console.log("L2 токен развернут по адресу:", l2Token.address);

    // Инициализация токен мостов
    console.log("\nИнициализация L1 токен моста...");
    await sendTransactionWithRetry(
        l1TokenBridge.initialize(
            l2TokenBridge.address,
            L1_GATEWAY_ROUTER_PROXY_ADDR,
            L1_SCROLL_MESSENGER_PROXY_ADDR,
            l1Token.address,
            l2Token.address
        ),
        "Инициализация L1 токен моста"
    );

    console.log("\nИнициализация L2 токен моста...");
    await sendTransactionWithRetry(
        l2TokenBridge.initialize(
            l1TokenBridge.address,
            L2_GATEWAY_ROUTER_PROXY_ADDR,
            L2_SCROLL_MESSENGER_PROXY_ADDR,
            l1Token.address,
            l2Token.address
        ),
        "Инициализация L2 токен моста"
    );

    // Сохранение адресов
    const addresses = {
        eth: {
            l1: {
                bridge: l1EthBridge.address,
                router: L1_GATEWAY_ROUTER_PROXY_ADDR,
                messenger: L1_SCROLL_MESSENGER_PROXY_ADDR
            },
            l2: {
                bridge: l2EthBridge.address,
                router: L2_GATEWAY_ROUTER_PROXY_ADDR,
                messenger: L2_SCROLL_MESSENGER_PROXY_ADDR
            }
        },
        token: {
            l1: {
                token: l1Token.address,
                bridge: l1TokenBridge.address
            },
            l2: {
                token: l2Token.address,
                bridge: l2TokenBridge.address
            }
        }
    };

    // Создаем директорию если её нет
    if (!fs.existsSync("./bridge_deployment")) {
        fs.mkdirSync("./bridge_deployment");
    }

    fs.writeFileSync(
        "./bridge_deployment/addresses.json",
        JSON.stringify(addresses, null, 2)
    );

    console.log("\n--------- Деплой завершен ---------");
    console.log("\nМосты для ETH:");
    console.log("L1 ETH мост:", l1EthBridge.address);
    console.log("L2 ETH мост:", l2EthBridge.address);
    console.log("Начальный баланс каждого ETH моста:", ethers.utils.formatEther(INITIAL_BRIDGE_BALANCE), "ETH");

    console.log("\nМосты для токенов:");
    console.log("L1 токен:", l1Token.address);
    console.log("L1 токен мост:", l1TokenBridge.address);
    console.log("L2 токен:", l2Token.address);
    console.log("L2 токен мост:", l2TokenBridge.address);

    console.log("\nАдреса контрактов сохранены в файле bridge_deployment/addresses.json");

    // Проверяем финальные балансы
    const finalL1Balance = await l1Wallet.getBalance();
    const finalL2Balance = await l2Wallet.getBalance();
    
    console.log("\n=== Финальные балансы кошелька ===");
    console.log("L1:", ethers.utils.formatEther(finalL1Balance), "ETH");
    console.log("L2:", ethers.utils.formatEther(finalL2Balance), "ETH");
    console.log("Потрачено на L1:", ethers.utils.formatEther(l1Balance.sub(finalL1Balance)), "ETH");
    console.log("Потрачено на L2:", ethers.utils.formatEther(l2Balance.sub(finalL2Balance)), "ETH");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    }); 
