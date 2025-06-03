document.addEventListener('DOMContentLoaded', () => {
  const ethersScript = document.createElement('script');
  ethersScript.src = 'https://cdn.jsdelivr.net/npm/ethers@6.10.0/dist/ethers.umd.min.js';
  ethersScript.onload = initializeApp;
  document.head.appendChild(ethersScript);
});

let provider, signer, userAddress;
let l1TokenBridge, l2TokenBridge;
let l1EthBridge, l2EthBridge;
let l1Token, l2Token;
let l1Provider, l2Provider;

const L1_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const L2_RPC = 'https://sepolia-rpc.scroll.io';

const addresses = {
  token: {
    l1: {
      token: '0x728855754f79f4Ec7e5A97878b195Ac06D970aB0',
      bridge: '0x890309B7c5BE9E008385d422E9893f3279383a17'
    },
    l2: {
      token: '0x890309B7c5BE9E008385d422E9893f3279383a17',
      bridge: '0x728855754f79f4Ec7e5A97878b195Ac06D970aB0'
    }
  },
  eth: {
    l1: {
      bridge: '0xBdc08074e5797df283d2212A0088f37d22eC6b41' // Адрес L1LockBridge
    },
    l2: {
      bridge: '0x2c51eaEf3e08F8b7f74D802C65B2b45f775351E1' // Адрес L2LockBridge
    }
  }
};

const NETWORKS = {
  L1: {
    chainId: '0xaa36a7', // Ethereum Sepolia (11155111)
    name: 'Ethereum Sepolia',
    rpc: L1_RPC,
    explorer: 'https://sepolia.etherscan.io',
    symbol: 'ETH'
  },
  L2: {
    chainId: '0x8274f',
    name: 'Scroll Sepolia',
    rpc: L2_RPC,
    explorer: 'https://sepolia.scrollscan.dev',
    symbol: 'ETH'
  }
};

const BRIDGE_TYPE = {
  TOKEN: 'token',
  ETH: 'eth'
};

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

// Добавляем информацию о токене
const TOKEN_INFO = {
  symbol: 'SUT',
  name: 'sut_test_token_bonch',
  decimals: 18
};

// Основная функция инициализации
async function initializeApp() {
  try {
    await initializeProviders();
    await initializeContracts();
    initializeUI();
    initializeEventListeners();
    console.log('Application initialized successfully');
  } catch (error) {
    console.error('Failed to initialize application:', error);
    showStatus('Failed to initialize application: ' + error.message, true);
  }
}

// Инициализация провайдеров
async function initializeProviders() {
  l1Provider = new ethers.JsonRpcProvider(L1_RPC);
  l2Provider = new ethers.JsonRpcProvider(L2_RPC);
  
  if (window.ethereum) {
    provider = new ethers.BrowserProvider(window.ethereum);
    try {
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts.length > 0) {
        signer = await provider.getSigner();
        userAddress = await signer.getAddress();
        updateConnectButton();
      }
    } catch (error) {
      console.error('Error checking initial accounts:', error);
    }
  }
}

// Инициализация контрактов
async function initializeContracts() {
  try {
    // Инициализация токен контрактов
    l1Token = new ethers.Contract(addresses.token.l1.token, ERC20_ABI, l1Provider);
    l2Token = new ethers.Contract(addresses.token.l2.token, ERC20_ABI, l2Provider);

    // Загрузка ABI для мостов
    const [l1TokenBridgeAbi, l2TokenBridgeAbi, l1EthBridgeAbi, l2EthBridgeAbi] = await Promise.all([
      fetch('abi/L1TokenBridge.json').then(r => r.json()).then(j => j.abi),
      fetch('abi/L2TokenBridge.json').then(r => r.json()).then(j => j.abi),
      fetch('abi/L1LockBridge.json').then(r => r.json()).then(j => j.abi),
      fetch('abi/L2LockBridge.json').then(r => r.json()).then(j => j.abi)
    ]);

    // Инициализация контрактов мостов
    l1TokenBridge = new ethers.Contract(addresses.token.l1.bridge, l1TokenBridgeAbi, l1Provider);
    l2TokenBridge = new ethers.Contract(addresses.token.l2.bridge, l2TokenBridgeAbi, l2Provider);
    l1EthBridge = new ethers.Contract(addresses.eth.l1.bridge, l1EthBridgeAbi, l1Provider);
    l2EthBridge = new ethers.Contract(addresses.eth.l2.bridge, l2EthBridgeAbi, l2Provider);

  } catch (error) {
    console.error('Error initializing contracts:', error);
    throw error;
  }
}

// Обновляем UI
function initializeUI() {
  const connectBtn = document.getElementById('connect-btn');
  if (connectBtn) {
    connectBtn.onclick = connectWallet;
  }

  // Обновляем все упоминания токена
  document.querySelectorAll('.token-symbol').forEach(el => {
    el.textContent = TOKEN_INFO.symbol;
  });

  // Заменяем сетевой статус на информацию о балансах контрактов
  updateContractBalances();
  
  initializeTabs();
  initializeBridgeTypes();
  updateBalances();
  // Добавляю вызов updateSummary для обоих типов
  updateSummary('eth').then();
  updateSummary('token').then();
}

// Инициализация вкладок
function initializeTabs() {
  const tabDeposit = document.getElementById('tab-deposit');
  const tabWithdraw = document.getElementById('tab-withdraw');

  if (tabDeposit && tabWithdraw) {
    tabDeposit.onclick = () => switchTab('deposit');
    tabWithdraw.onclick = () => switchTab('withdraw');
    
    // Устанавливаем начальное состояние
    const currentTab = tabWithdraw.classList.contains('active') ? 'withdraw' : 'deposit';
    switchTab(currentTab);
  }
}

// Переключение вкладок
function switchTab(tab) {
  const depositTab = document.getElementById('tab-deposit');
  const withdrawTab = document.getElementById('tab-withdraw');
  const ethSection = document.getElementById('eth-bridge-section');
  const tokenSection = document.getElementById('token-bridge-section');

  if (!depositTab || !withdrawTab) {
    console.error('Tab buttons not found');
    return;
  }

  // Сброс значений инпутов при смене вкладки
  const ethAmountInput = document.getElementById('eth-amount');
  const tokenAmountInput = document.getElementById('token-amount');
  if (ethAmountInput) ethAmountInput.value = '';
  if (tokenAmountInput) tokenAmountInput.value = '';

  // Обновляем классы кнопок
  if (tab === 'deposit') {
    depositTab.classList.add('active');
    withdrawTab.classList.remove('active');
  } else {
    withdrawTab.classList.add('active');
    depositTab.classList.remove('active');
  }

  // Обновляем отображение форм
  const isEthActive = document.getElementById('type-eth')?.classList.contains('active');
  const isDeposit = tab === 'deposit';

  // Обновляем текст кнопок и видимость секций
  if (ethSection && tokenSection) {
    if (isEthActive) {
      ethSection.style.display = '';
      tokenSection.style.display = 'none';
      const submitBtn = document.getElementById('eth-submit-btn');
      if (submitBtn) {
        submitBtn.textContent = isDeposit ? 'Bridge ETH to Scroll' : 'Bridge ETH to Ethereum';
      }
    } else {
      ethSection.style.display = 'none';
      tokenSection.style.display = '';
      const submitBtn = document.getElementById('token-submit-btn');
      if (submitBtn) {
        const tokenSymbol = document.querySelector('.token-symbol')?.textContent || 'SUT';
        submitBtn.textContent = isDeposit ? `Bridge ${tokenSymbol} to Scroll` : `Bridge ${tokenSymbol} to Ethereum`;
      }
    }
  }
}

// Инициализация типов мостов
function initializeBridgeTypes() {
  const ethTypeBtn = document.getElementById('type-eth');
  const tokenTypeBtn = document.getElementById('type-token');
  
  if (ethTypeBtn && tokenTypeBtn) {
    ethTypeBtn.onclick = () => switchBridgeType(BRIDGE_TYPE.ETH);
    tokenTypeBtn.onclick = () => switchBridgeType(BRIDGE_TYPE.TOKEN);
  }
}

// Переключение типа моста
function switchBridgeType(type) {
  const ethSection = document.getElementById('eth-bridge-section');
  const tokenSection = document.getElementById('token-bridge-section');
  const ethTypeBtn = document.getElementById('type-eth');
  const tokenTypeBtn = document.getElementById('type-token');

  // Сброс значений инпутов при смене типа
  const ethAmountInput = document.getElementById('eth-amount');
  const tokenAmountInput = document.getElementById('token-amount');
  if (ethAmountInput) ethAmountInput.value = '';
  if (tokenAmountInput) tokenAmountInput.value = '';

  if (type === BRIDGE_TYPE.ETH) {
    if (ethSection) ethSection.style.display = '';
    if (tokenSection) tokenSection.style.display = 'none';
    ethTypeBtn?.classList.add('active');
    tokenTypeBtn?.classList.remove('active');
  } else {
    if (tokenSection) tokenSection.style.display = '';
    if (ethSection) ethSection.style.display = 'none';
    tokenTypeBtn?.classList.add('active');
    ethTypeBtn?.classList.remove('active');
  }
}

// Подключение кошелька
async function connectWallet() {
  if (!window.ethereum) {
    showStatus('Please install MetaMask!', true);
    return;
  }

  try {
    await window.ethereum.request({ method: 'eth_requestAccounts' });
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    updateConnectButton();
    await updateBalances();
    showStatus('Wallet connected successfully');
  } catch (error) {
    console.error('Error connecting wallet:', error);
    showStatus('Failed to connect wallet: ' + error.message, true);
  }
}

// Обновление кнопки подключения
function updateConnectButton() {
  const connectBtn = document.getElementById('connect-btn');
  if (connectBtn && userAddress) {
    connectBtn.textContent = userAddress.slice(0, 6) + '...' + userAddress.slice(-4);
    connectBtn.disabled = true;
  }
}

// Обновление балансов
async function updateBalances() {
  if (!userAddress) return;
  
  try {
    await Promise.all([
      updateTokenBalances(),
      updateEthBalances()
    ]);
  } catch (error) {
    console.error('Error updating balances:', error);
  }
}

// Обновление токен балансов
async function updateTokenBalances() {
  if (!userAddress) return;

  try {
    // Используем контракты токенов вместо мостов для проверки баланса
    const [l1Balance, l2Balance] = await Promise.all([
      l1Token.balanceOf(userAddress),
      l2Token.balanceOf(userAddress)
    ]);

    const l1BalanceEl = document.getElementById('l1-token-balance');
    const l2BalanceEl = document.getElementById('l2-token-balance');

    if (l1BalanceEl) l1BalanceEl.textContent = ethers.formatEther(l1Balance);
    if (l2BalanceEl) l2BalanceEl.textContent = ethers.formatEther(l2Balance);
  } catch (error) {
    console.error('Error updating token balances:', error);
    // Устанавливаем прочерки в случае ошибки
    const l1BalanceEl = document.getElementById('l1-token-balance');
    const l2BalanceEl = document.getElementById('l2-token-balance');
    if (l1BalanceEl) l1BalanceEl.textContent = '-';
    if (l2BalanceEl) l2BalanceEl.textContent = '-';
  }
}

// Обновление ETH балансов
async function updateEthBalances() {
  if (!userAddress) return;

  try {
    const [l1Balance, l2Balance] = await Promise.all([
      l1Provider.getBalance(userAddress),
      l2Provider.getBalance(userAddress)
    ]);

    const l1BalanceEl = document.getElementById('l1-eth-balance');
    const l2BalanceEl = document.getElementById('l2-eth-balance');

    if (l1BalanceEl) l1BalanceEl.textContent = ethers.formatEther(l1Balance);
    if (l2BalanceEl) l2BalanceEl.textContent = ethers.formatEther(l2Balance);
  } catch (error) {
    console.error('Error updating ETH balances:', error);
  }
}

// Обновляем функцию для отображения информации о балансах контрактов
async function updateContractBalances() {
  try {
    const l1Balance = await l1Provider.getBalance(addresses.eth.l1.bridge);
    const l2Balance = await l2Provider.getBalance(addresses.eth.l2.bridge);

    const networkStatus = document.querySelector('.network-status');
    if (networkStatus) {
      networkStatus.outerHTML = `
        <div class="warning-message">
          Баланс контрактов для эфира:<br>
          L1 Bridge: ${ethers.formatEther(l1Balance)} ETH | L2 Bridge: ${ethers.formatEther(l2Balance)} ETH<br>
          <span style="font-size:0.95em; color:#fff; opacity:0.85;">Если вы попытаетесь перевести эфира больше, чем есть в мостах, вам ничего не придет.</span>
        </div>
      `;
    }
  } catch (error) {
    console.error('Error updating contract balances:', error);
    const networkStatus = document.querySelector('.network-status');
    if (networkStatus) {
      networkStatus.outerHTML = `
        <div class="warning-message">
          Ошибка загрузки балансов мостов
        </div>
      `;
    }
  }
}

// Функция для перемещения блока статуса под предупреждающую надпись
function ensureStatusBelowWarning() {
  const warning = document.querySelector('.warning-message');
  const status = document.getElementById('status-container');
  if (warning && status && warning.nextSibling !== status) {
    warning.parentNode.insertBefore(status, warning.nextSibling);
  }
}

// Модифицирую showStatus, чтобы всегда вызывать ensureStatusBelowWarning
function showStatus(message, isError = false) {
  const statusContainer = document.getElementById('status-container');
  if (!statusContainer) return;

  const statusEl = document.getElementById('status-msg') || document.createElement('div');
  statusEl.id = 'status-msg';
  statusEl.textContent = message;
  statusEl.className = isError ? 'error' : 'success';
  
  if (!statusEl.parentElement) {
    statusContainer.appendChild(statusEl);
  }
  ensureStatusBelowWarning();
}

// Инициализация слушателей событий
function initializeEventListeners() {
  if (window.ethereum) {
    window.ethereum.on('chainChanged', () => window.location.reload());
    window.ethereum.on('accountsChanged', () => window.location.reload());
  }

  // Инициализация форм
  initializeFormHandlers();
}

// Инициализация обработчиков форм
function initializeFormHandlers() {
  const ethForm = document.getElementById('eth-form');
  const tokenForm = document.getElementById('token-form');

  if (ethForm) {
    ethForm.onsubmit = async (e) => {
      e.preventDefault();
      const isDeposit = document.getElementById('tab-deposit')?.classList.contains('active');
      if (isDeposit) {
        await handleDeposit(e);
      } else {
        await handleWithdraw(e);
      }
    };
  }

  if (tokenForm) {
    tokenForm.onsubmit = async (e) => {
      e.preventDefault();
      const isDeposit = document.getElementById('tab-deposit')?.classList.contains('active');
      if (isDeposit) {
        await handleDeposit(e);
      } else {
        await handleWithdraw(e);
      }
    };
  }

  // Инициализация инпутов и кнопок Max
  initializeInputHandlers();
}

// Инициализация обработчиков инпутов
function initializeInputHandlers() {
  // ETH
  const ethAmountInput = document.getElementById('eth-amount');
  const ethMaxBtn = document.getElementById('eth-max-btn');
  if (ethAmountInput) {
    ethAmountInput.oninput = () => { updateSummary('eth').then(); };
  }
  if (ethMaxBtn) {
    ethMaxBtn.onclick = () => setMaxAmount('eth');
  }
  // TOKEN
  const tokenAmountInput = document.getElementById('token-amount');
  const tokenMaxBtn = document.getElementById('token-max-btn');
  if (tokenAmountInput) {
    tokenAmountInput.oninput = () => { updateSummary('token').then(); };
  }
  if (tokenMaxBtn) {
    tokenMaxBtn.onclick = () => setMaxAmount('token');
  }
}

// Обновляем обработчик withdraw
async function handleWithdraw(e) {
  e.preventDefault();
  if (!signer) {
    showStatus('Please connect your wallet first', true);
    return;
  }

  const isEthActive = document.getElementById('type-eth')?.classList.contains('active');
  const amount = isEthActive ? 
    document.getElementById('eth-amount')?.value : 
    document.getElementById('token-amount')?.value;

  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    showStatus('Please enter a valid amount', true);
    return;
  }

  try {
    await checkAndSwitchNetwork(NETWORKS.L2.chainId);
    
    const amountWei = ethers.parseEther(amount);
    
    if (isEthActive) {
      // ETH withdraw
      const bridge = new ethers.Contract(addresses.eth.l2.bridge, await getL2EthBridgeABI(), signer);
      const gasLimit = 1000000n;
      const l1FeeData = await l1Provider.getFeeData();
      const l1GasPrice = l1FeeData.gasPrice || 0n;
      
      const tx = await bridge.bridgeETH(gasLimit, l1GasPrice, {
        value: amountWei,
        gasLimit: 300000
      });

      showStatus(`Transaction sent: ${tx.hash}`);
      await tx.wait();
      showStatus('Withdrawal initiated successfully!');
    } else {
      // Token withdraw
      const tokenContract = new ethers.Contract(addresses.token.l2.token, ERC20_ABI, signer);
      const bridge = new ethers.Contract(addresses.token.l2.bridge, await getL2TokenBridgeABI(), signer);
      
      showStatus('Approving tokens...');
      console.log('TOKEN APPROVE', { amount, amountWei: amountWei.toString(), activeTab: isEthActive ? 'ETH' : 'TOKEN' });
      const approveTx = await tokenContract.approve(addresses.token.l2.bridge, amountWei);
      await approveTx.wait();
      
      showStatus('Sending tokens to bridge...');
      console.log('TOKEN WITHDRAW', { amount, amountWei: amountWei.toString(), activeTab: isEthActive ? 'ETH' : 'TOKEN' });
      let fee = ethers.parseEther('0.001');
      try {
        const fixedFee = await bridge.fixedFee();
        const percentFeeBps = await bridge.percentFeeBps();
        fee = fixedFee + (amountWei * percentFeeBps / 10000n);
      } catch (e) {
        console.warn('Не удалось получить комиссию с контракта, используется 0.001 ETH');
      }
      const tx = await bridge.bridgeToken(amountWei, 1000000, { value: fee });
      showStatus(`Transaction sent: ${tx.hash}`);
      await tx.wait();
      showStatus('Withdrawal initiated successfully!');
    }

    await updateBalances();
    await updateContractBalances();
  } catch (error) {
    console.error('Withdrawal error:', error);
    showStatus('Withdrawal failed: ' + error.message, true);
  }
}

// Функция для проверки и переключения сети
async function checkAndSwitchNetwork(targetChainId) {
  if (!window.ethereum) throw new Error('MetaMask is not installed');

  const currentChainId = await window.ethereum.request({ method: 'eth_chainId' });
  console.log('currentChainId:', currentChainId, 'targetChainId:', targetChainId);
  if (parseInt(currentChainId, 16) !== parseInt(targetChainId, 16)) {
    // Определяем имя сети для пользователя
    let networkName = 'the correct network';
    if (targetChainId === NETWORKS.L1.chainId) networkName = NETWORKS.L1.name;
    if (targetChainId === NETWORKS.L2.chainId) networkName = NETWORKS.L2.name;
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: targetChainId }],
      });
    } catch (error) {
      throw new Error(`Please switch to ${networkName} in your wallet!`);
    }
  }
}

// Получение ABI для мостов
async function getL2EthBridgeABI() {
  try {
    const response = await fetch('abi/L2LockBridge.json');
    const data = await response.json();
    return data.abi;
  } catch (error) {
    console.error('Error loading L2 ETH Bridge ABI:', error);
    throw error;
  }
}

async function getL2TokenBridgeABI() {
  try {
    const response = await fetch('abi/L2TokenBridge.json');
    const data = await response.json();
    return data.abi;
  } catch (error) {
    console.error('Error loading L2 Token Bridge ABI:', error);
    throw error;
  }
}

// Функция для обработки депозита
async function handleDeposit(e) {
  e.preventDefault();
  if (!signer) {
    showStatus('Please connect your wallet first', true);
    return;
  }

  const isEthActive = document.getElementById('type-eth')?.classList.contains('active');
  const amount = isEthActive ? 
    document.getElementById('eth-amount')?.value : 
    document.getElementById('token-amount')?.value;

  if (!amount || isNaN(amount) || Number(amount) <= 0) {
    showStatus('Please enter a valid amount', true);
    return;
  }

  try {
    await checkAndSwitchNetwork(NETWORKS.L1.chainId);
    
    const amountWei = ethers.parseEther(amount);

    if (isEthActive) {
      // ETH deposit
      const bridge = new ethers.Contract(addresses.eth.l1.bridge, await getL1EthBridgeABI(), signer);
      const gasLimit = 1000000n;
      const feeData = await l1Provider.getFeeData();
      const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits("1", "gwei");
      
      const tx = await bridge.bridgeETH(
        gasLimit,
        gasPrice,
        {
          value: amountWei,
          gasLimit: 300000
        }
      );
      showStatus(`Transaction sent: ${tx.hash}`);
      await tx.wait();
      showStatus('Deposit completed successfully!');
    } else {
      // Token deposit
      const tokenContract = new ethers.Contract(addresses.token.l1.token, ERC20_ABI, signer);
      const bridge = new ethers.Contract(addresses.token.l1.bridge, await getL1TokenBridgeABI(), signer);
      
      // Проверяем текущий allowance
      const currentAllowance = await tokenContract.allowance(userAddress, addresses.token.l1.bridge);
      
      // Если текущий allowance меньше требуемой суммы, делаем approve
      if (currentAllowance < amountWei) {
        showStatus('Approving tokens...');
        console.log('TOKEN APPROVE', { 
          amount, 
          amountWei: amountWei.toString(), 
          currentAllowance: currentAllowance.toString(),
          activeTab: isEthActive ? 'ETH' : 'TOKEN' 
        });
        const approveTx = await tokenContract.approve(addresses.token.l1.bridge, amountWei);
        await approveTx.wait();
      }
      
      showStatus('Sending tokens to bridge...');
      console.log('TOKEN DEPOSIT', { amount, amountWei: amountWei.toString(), activeTab: isEthActive ? 'ETH' : 'TOKEN' });
      let fee = ethers.parseEther('0.001');
      try {
        const fixedFee = await bridge.fixedFee();
        const percentFeeBps = await bridge.percentFeeBps();
        fee = fixedFee + (amountWei * percentFeeBps / 10000n);
      } catch (e) {
        console.warn('Не удалось получить комиссию с контракта, используется 0.001 ETH');
      }
      const tx = await bridge.bridgeToken(amountWei, 1000000, { value: fee });
      showStatus(`Transaction sent: ${tx.hash}`);
      await tx.wait();
      showStatus('Deposit completed successfully!');
    }

    await updateBalances();
    await updateContractBalances();
  } catch (error) {
    console.error('Deposit error:', error);
    showStatus(error.message || 'Failed to process deposit', true);
  }
}

// Функция для получения ABI L1 мостов
async function getL1EthBridgeABI() {
  try {
    const response = await fetch('abi/L1LockBridge.json');
    const data = await response.json();
    return data.abi;
  } catch (error) {
    console.error('Error loading L1 ETH Bridge ABI:', error);
    throw error;
  }
}

async function getL1TokenBridgeABI() {
  try {
    const response = await fetch('abi/L1TokenBridge.json');
    const data = await response.json();
    return data.abi;
  } catch (error) {
    console.error('Error loading L1 Token Bridge ABI:', error);
    throw error;
  }
}

// Функции для работы с максимальными значениями
async function setMaxAmount(type) {
  if (!userAddress) {
    showStatus('Please connect your wallet first', true);
    return;
  }

  try {
    const isEthActive = (type === 'eth');
    const isDeposit = document.getElementById('tab-deposit')?.classList.contains('active');
    let balance;
    if (isEthActive) {
      balance = await (isDeposit ? l1Provider : l2Provider).getBalance(userAddress);
      // Оставляем небольшой запас на газ для ETH
      const gasReserve = ethers.parseEther('0.01');
      if (balance > gasReserve) {
        balance = balance - gasReserve;
      } else {
        balance = 0n;
      }
    } else {
      const token = isDeposit ? l1Token : l2Token;
      balance = await token.balanceOf(userAddress);
    }
    // Находим правильный input в зависимости от типа
    const input = isEthActive ? 
      document.getElementById('eth-amount') : 
      document.getElementById('token-amount');
    if (input && balance > 0n) {
      input.value = ethers.formatEther(balance);
      input.dispatchEvent(new Event('input'));
      console.log('Max amount set:', input.value);
    }
  } catch (error) {
    console.error('Error setting max amount:', error);
    showStatus('Failed to set maximum amount: ' + error.message, true);
  }
}

// Заменяю updateSummary на асинхронную версию с расчетом комиссий
async function updateSummary(type) {
  const amountInput = document.getElementById(`${type}-amount`);
  const amount = amountInput?.value || '0';
  const summaryAmount = document.getElementById(`${type}-summary-amount`);
  const networkFee = document.getElementById(`${type}-network-fee`);
  const bridgeFee = document.getElementById(`${type}-bridge-fee`);
  const total = document.getElementById(`${type}-total`);
  const totalReceived = document.getElementById(`${type}-total-received`);
  // Для токенов
  const totalSut = document.getElementById('token-total-sut');
  const totalEth = document.getElementById('token-total-eth');

  if (summaryAmount) summaryAmount.textContent = amount;

  let bridgeFeeValue = 0;
  let networkFeeValue = 0.001; // fallback
  let crossChainFeeValue = 0;
  let totalValue = 0;
  const num = Number(amount);

  if (!isNaN(num) && num > 0) {
    if (type === 'eth') {
      const isDeposit = document.getElementById('tab-deposit')?.classList.contains('active');
      let bridge;
      try {
        if (isDeposit) {
          bridge = new ethers.Contract(addresses.eth.l1.bridge, [
            "function fixedFee() view returns (uint256)",
            "function percentFeeBps() view returns (uint256)",
            "function gasMarkupBps() view returns (uint256)",
            "function estimateInternalGasCost(uint256 gasLimit, uint256 gasPrice) view returns (uint256)",
            "function calculateTotalFee(uint256 amount, uint256 gasLimit, uint256 gasPrice) view returns (uint256)"
          ], l1Provider);
        } else {
          bridge = new ethers.Contract(addresses.eth.l2.bridge, [
            "function fixedFee() view returns (uint256)",
            "function percentFeeBps() view returns (uint256)",
            "function gasMarkupBps() view returns (uint256)",
            "function estimateInternalGasCost(uint256 gasLimit, uint256 gasPrice) view returns (uint256)",
            "function calculateTotalFee(uint256 amount, uint256 gasLimit, uint256 gasPrice) view returns (uint256)"
          ], l2Provider);
        }

        const amountWei = ethers.parseEther(amount);
        const gasLimit = 1000000n;
        const provider = isDeposit ? l1Provider : l2Provider;
        const feeData = await provider.getFeeData();
        const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits("1", "gwei");
        
        // Получаем комиссии из контракта
        const totalFee = await bridge.calculateTotalFee(amountWei, gasLimit, gasPrice);
        bridgeFeeValue = Number(ethers.formatEther(totalFee));
        
        // Кросс-чейн комиссия (gasLimit * 1 gwei)
        crossChainFeeValue = Number(ethers.formatEther(gasLimit * 1000000000n));
        
        // Сетевая комиссия для текущей транзакции
        const txGasLimit = 300000n;
        networkFeeValue = Number(ethers.formatEther(txGasLimit * gasPrice));

        // Общая сумма к оплате
        totalValue = num + bridgeFeeValue + crossChainFeeValue + networkFeeValue;
        
        // Сумма, которую получит пользователь на другой стороне
        const receivedAmount = num - bridgeFeeValue - crossChainFeeValue;
        
        if (networkFee) networkFee.textContent = networkFeeValue.toFixed(6);
        if (bridgeFee) bridgeFee.textContent = (bridgeFeeValue + crossChainFeeValue).toFixed(6);
        if (total) total.textContent = totalValue.toFixed(6);
        if (totalReceived) totalReceived.textContent = receivedAmount.toFixed(6);
        
      } catch (e) {
        console.warn('Error calculating fees:', e);
        if (networkFee) networkFee.textContent = networkFeeValue.toFixed(6);
        if (bridgeFee) bridgeFee.textContent = '0.001';
        if (total) total.textContent = (num + 0.001).toFixed(6);
        if (totalReceived) totalReceived.textContent = (num - 0.001).toFixed(6);
      }
    } else {
      // Для токенов оставляем текущую логику
      bridgeFeeValue = 0;
      try {
        const isDeposit = document.getElementById('tab-deposit')?.classList.contains('active');
        const provider = isDeposit ? l1Provider : l2Provider;
        const feeData = await provider.getFeeData();
        let gasPriceWei = 0n;
        if (feeData.gasPrice && feeData.gasPrice > 0n) gasPriceWei = feeData.gasPrice;
        if (feeData.maxFeePerGas && feeData.maxFeePerGas > gasPriceWei) gasPriceWei = feeData.maxFeePerGas;
        if (feeData.maxPriorityFeePerGas && feeData.maxPriorityFeePerGas > gasPriceWei) gasPriceWei = feeData.maxPriorityFeePerGas;
        const gasLimit = 120000n;
        if (gasPriceWei > 0n && gasPriceWei >= 1000000000n) {
          networkFeeValue = Number(ethers.formatEther(gasPriceWei * gasLimit));
          if (networkFeeValue < 0.00001) {
            networkFeeValue = 0.001;
          }
        }
      } catch (e) {
        networkFeeValue = 0.001;
      }
      
      if (networkFee) networkFee.textContent = networkFeeValue.toFixed(6);
      if (bridgeFee) bridgeFee.textContent = bridgeFeeValue.toFixed(6);
      if (totalSut) totalSut.textContent = num.toFixed(6);
      if (totalEth) totalEth.textContent = networkFeeValue.toFixed(6);
      if (total) total.textContent = '-';
    }
  } else {
    // Если amount невалидный — сбрасываем
    if (networkFee) networkFee.textContent = '-';
    if (bridgeFee) bridgeFee.textContent = '-';
    if (total) total.textContent = '-';
    if (totalReceived) totalReceived.textContent = '-';
    if (totalSut) totalSut.textContent = '-';
    if (totalEth) totalEth.textContent = '-';
  }
}

// Функция для обновления статуса транзакции
async function updateTransactionStatus(txHash, isL1) {
  try {
    const provider = isL1 ? l1Provider : l2Provider;
    const receipt = await provider.getTransactionReceipt(txHash);
    
    if (receipt) {
      const explorer = isL1 ? NETWORKS.L1.explorer : NETWORKS.L2.explorer;
      const status = receipt.status === 1 ? 'успешно завершена' : 'не удалась';
      showStatus(`Транзакция ${status}. Hash: <a href="${explorer}/tx/${txHash}" target="_blank">${txHash}</a>`);
      await updateBalances();
      await updateContractBalances();
    } else {
      showStatus(`Ожидание подтверждения транзакции... Hash: ${txHash}`);
      setTimeout(() => updateTransactionStatus(txHash, isL1), 5000);
    }
  } catch (error) {
    console.error('Error updating transaction status:', error);
    showStatus('Ошибка при проверке статуса транзакции: ' + error.message, true);
  }
}

// Функция для форматирования больших чисел
function formatNumber(num) {
  if (typeof num !== 'number' && typeof num !== 'string') return '0';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6
  }).format(num);
}

// Функция для проверки и обработки ошибок сети
async function handleNetworkError(error) {
  console.error('Network error:', error);
  if (error.code === 4902) {
    showStatus('Сеть не добавлена в MetaMask. Пожалуйста, добавьте сеть вручную.', true);
  } else if (error.code === -32002) {
    showStatus('Ожидание подтверждения в MetaMask...', true);
  } else {
    showStatus(error.message || 'Произошла ошибка сети', true);
  }
}

// Функция для валидации ввода
function validateInput(input, type) {
  const value = input.value.trim();
  if (value === '') return true;
  
  const num = Number(value);
  if (isNaN(num) || num < 0) {
    showStatus('Пожалуйста, введите корректное положительное число', true);
    return false;
  }
  
  return true;
}

// Обработчик изменения сети
async function handleNetworkChange(chainId) {
  try {
    const newChainId = parseInt(chainId, 16).toString(16);
    console.log('Network changed to:', newChainId);
    
    // Обновляем провайдер и подпись
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    userAddress = await signer.getAddress();
    
    // Обновляем UI
    updateConnectButton();
    await updateBalances();
    await updateContractBalances();
    
    // Проверяем, находимся ли мы в поддерживаемой сети
    const isL1 = newChainId === NETWORKS.L1.chainId;
    const isL2 = newChainId === NETWORKS.L2.chainId;
    
    if (!isL1 && !isL2) {
      showStatus('Пожалуйста, переключитесь на поддерживаемую сеть (Sepolia или Scroll Sepolia)', true);
    }
  } catch (error) {
    console.error('Error handling network change:', error);
    showStatus('Ошибка при обработке смены сети: ' + error.message, true);
  }
}

// Инициализация слушателей событий сети
function initializeNetworkListeners() {
  if (window.ethereum) {
    window.ethereum.on('chainChanged', handleNetworkChange);
    window.ethereum.on('accountsChanged', async (accounts) => {
      if (accounts.length > 0) {
        userAddress = accounts[0];
        signer = await provider.getSigner();
        updateConnectButton();
        await updateBalances();
        await updateContractBalances();
      } else {
        userAddress = null;
        signer = null;
        updateConnectButton();
      }
    });
  }
}

// Вызываем инициализацию сетевых слушателей при загрузке
initializeNetworkListeners(); 