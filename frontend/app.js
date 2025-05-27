// Подключение ethers.js через CDN
const ethersScript = document.createElement('script');
ethersScript.src = 'https://cdn.jsdelivr.net/npm/ethers@6.10.0/dist/ethers.umd.min.js';
document.head.appendChild(ethersScript);

let provider, signer, userAddress;
let l1Bridge, l2Bridge;
let l1Token, l2Token;
let l1Provider, l2Provider;

const L1_RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
const L2_RPC = 'https://scroll-sepolia-rpc.publicnode.com';

const addresses = {
  l1: {
    token: '0x_your_L1_Token_Address',
    bridge: '0x_your_L1_Bridge_Address'
  },
  l2: {
    token: '0x_your_L2_Token_Address',
    bridge: '0x_your_L2_Bridge_Address'
  }
};

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)"
];

const CHAIN_ID_L1 = '0x1a4'; // 11155111 (Sepolia)
const CHAIN_ID_L2 = '0x8274f'; // 534351 (Scroll)

function showStatus(msg, isError = false) {
  let el = document.getElementById('status-msg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'status-msg';
    el.style.margin = '16px 0';
    el.style.textAlign = 'center';
    el.style.color = isError ? '#ff6b6b' : '#3ee6c1';
    document.querySelector('.container').insertBefore(el, document.querySelector('.container').children[1]);
  }
  el.textContent = msg;
  el.style.color = isError ? '#ff6b6b' : '#3ee6c1';
}

async function updateL2Balance() {
  if (!signer) return;
  try {
    const l2UserProvider = new ethers.JsonRpcProvider(L2_RPC);
    const l2UserToken = new ethers.Contract(addresses.l2.token, ERC20_ABI, l2UserProvider);
    const bal = await l2UserToken.balanceOf(userAddress);
    document.getElementById('l2-balance').textContent = ethers.formatEther(bal);
  } catch (e) {
    document.getElementById('l2-balance').textContent = '-';
  }
}

async function updateL1Balance() {
  if (!signer) return;
  try {
    const l1UserProvider = new ethers.JsonRpcProvider(L1_RPC);
    const l1UserToken = new ethers.Contract(addresses.l1.token, ERC20_ABI, l1UserProvider);
    const bal = await l1UserToken.balanceOf(userAddress);
    document.getElementById('l1-balance').textContent = ethers.formatEther(bal);
  } catch (e) {
    document.getElementById('l1-balance').textContent = '-';
  }
}

function normalizeChainId(chainId) {
  return parseInt(chainId, 16);
}

async function ensureNetwork(chainIdHex) {
  if (!window.ethereum) return;
  const current = await window.ethereum.request({ method: 'eth_chainId' });
  if (normalizeChainId(current) !== normalizeChainId(chainIdHex)) {
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }]
      });
    } catch (err) {
      // Если ошибка 4902 — сеть не добавлена, пробуем добавить
      if (err.code === 4902) {
        // Пример для Scroll Sepolia
        if (chainIdHex === '0x8274f') {
          try {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: '0x8274f',
                chainName: 'Scroll Sepolia',
                rpcUrls: ['https://scroll-sepolia-rpc.publicnode.com'],
                nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                blockExplorerUrls: ['https://sepolia.scrollscan.dev']
              }]
            });
            // После добавления пробуем переключиться ещё раз
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: chainIdHex }]
            });
          } catch (addErr) {
            alert('Please add Scroll Sepolia network to MetaMask manually!');
            throw addErr;
          }
        }
      } else {
        alert('Please switch to the correct network in MetaMask!');
        throw err;
      }
    }
  }
}

if (window.ethereum) {
  window.ethereum.on('chainChanged', () => {
    window.location.reload();
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  await new Promise(r => { ethersScript.onload = r; });
  const l1BridgeAbi = (await fetch('abi/L1TokenBridge.json')).json().then(j => j.abi);
  const l2BridgeAbi = (await fetch('abi/L2TokenBridge.json')).json().then(j => j.abi);
  l1Provider = new ethers.JsonRpcProvider(L1_RPC);
  l2Provider = new ethers.JsonRpcProvider(L2_RPC);
  l1Bridge = new ethers.Contract(addresses.l1.bridge, await l1BridgeAbi, l1Provider);
  l2Bridge = new ethers.Contract(addresses.l2.bridge, await l2BridgeAbi, l2Provider);

  const connectBtn = document.getElementById('connect-btn');
  const depositForm = document.getElementById('deposit-form');
  const withdrawForm = document.getElementById('withdraw-form');
  const l2BalanceSpan = document.getElementById('l2-balance');
  const maxBtn = document.getElementById('max-btn');
  const withdrawAmountInput = document.getElementById('withdraw-amount');
  const summaryAmount = document.getElementById('summary-amount');
  const ethFee = document.getElementById('eth-fee');
  const scrollFee = document.getElementById('scroll-fee');
  const summaryTotal = document.getElementById('summary-total');

  // --- Tabs logic ---
  const tabDeposit = document.getElementById('tab-deposit');
  const tabWithdraw = document.getElementById('tab-withdraw');
  const depositSection = document.getElementById('deposit-section');
  const withdrawSection = document.getElementById('withdraw-section');

  tabDeposit.onclick = () => {
    tabDeposit.classList.add('active');
    tabWithdraw.classList.remove('active');
    depositSection.style.display = '';
    withdrawSection.style.display = 'none';
  };
  tabWithdraw.onclick = () => {
    tabWithdraw.classList.add('active');
    tabDeposit.classList.remove('active');
    withdrawSection.style.display = '';
    depositSection.style.display = 'none';
  };

  const maxDepositBtn = document.getElementById('max-deposit-btn');
  const depositAmountInput = document.getElementById('deposit-amount');
  const depositSummaryAmount = document.getElementById('deposit-summary-amount');
  const depositEthFee = document.getElementById('deposit-eth-fee');
  const depositScrollFee = document.getElementById('deposit-scroll-fee');
  const depositSummaryTotal = document.getElementById('deposit-summary-total');

  connectBtn.onclick = async () => {
    if (window.ethereum) {
      provider = new ethers.BrowserProvider(window.ethereum);
      await provider.send('eth_requestAccounts', []);
      signer = await provider.getSigner();
      userAddress = await signer.getAddress();
      connectBtn.textContent = userAddress.slice(0, 6) + '...' + userAddress.slice(-4);
      connectBtn.disabled = true;
      await updateL1Balance();
      await updateL2Balance();
      showStatus('Wallet connected');
    } else {
      alert('Please install MetaMask or another EIP-1193 wallet!');
    }
  };

  async function updateDepositSummary() {
    const amount = depositAmountInput.value;
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      depositSummaryAmount.textContent = '-';
      depositEthFee.textContent = '-';
      depositScrollFee.textContent = '-';
      depositSummaryTotal.textContent = '-';
      return;
    }
    depositSummaryAmount.textContent = amount;
    // Для депозита комиссия фиксированная (0.01 ETH)
    const ethRequired = ethers.parseEther('0.01');
    depositEthFee.textContent = ethers.formatEther(ethRequired);
    depositScrollFee.textContent = '0';
    depositSummaryTotal.textContent = (Number(amount) + Number(ethers.formatEther(ethRequired))).toFixed(6);
  }
  depositAmountInput.addEventListener('input', updateDepositSummary);

  maxDepositBtn.onclick = async () => {
    if (!signer) return;
    try {
      const l1UserToken = new ethers.Contract(addresses.l1.token, ERC20_ABI, signer);
      const bal = await l1UserToken.balanceOf(userAddress);
      depositAmountInput.value = ethers.formatEther(bal);
      await updateDepositSummary();
    } catch {}
  };

  depositForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!signer) return showStatus('Connect wallet first', true);
    await ensureNetwork(CHAIN_ID_L1);
    const amount = depositAmountInput.value;
    if (!amount || isNaN(amount) || Number(amount) <= 0) return showStatus('Enter valid amount', true);
    try {
      showStatus('Approving tokens...');
      const l1UserToken = new ethers.Contract(addresses.l1.token, ERC20_ABI, signer);
      const decimals = 18;
      const value = ethers.parseUnits(amount, decimals);
      const approveTx = await l1UserToken.approve(addresses.l1.bridge, value);
      await approveTx.wait();
      showStatus('Tokens approved. Sending to bridge...');
      const l1UserBridge = new ethers.Contract(addresses.l1.bridge, await l1BridgeAbi, signer);
      const GAS_LIMIT = 1000000;
      const ethRequired = ethers.parseEther('0.01');
      const tx = await l1UserBridge.bridgeToken(value, GAS_LIMIT, { value: ethRequired, gasLimit: GAS_LIMIT });
      showStatus('Transaction sent: ' + tx.hash);
      await tx.wait();
      showStatus('Deposit successful!');
      await updateL1Balance();
      await updateL2Balance();
    } catch (err) {
      showStatus('Error: ' + (err.info?.error?.message || err.message), true);
    }
  };

  async function updateWithdrawSummary() {
    const amount = withdrawAmountInput.value;
    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      summaryAmount.textContent = '-';
      ethFee.textContent = '-';
      scrollFee.textContent = '-';
      summaryTotal.textContent = '-';
      return;
    }
    summaryAmount.textContent = amount;
    // Получаем комиссию L1
    try {
      const GAS_LIMIT = 1000000n;
      const l1FeeData = await l1Provider.getFeeData();
      const l1GasPrice = l1FeeData.gasPrice;
      const ethRequired = l1GasPrice * GAS_LIMIT;
      ethFee.textContent = ethers.formatEther(ethRequired);
      scrollFee.textContent = '0';
      summaryTotal.textContent = (parseFloat(amount) + parseFloat(ethers.formatEther(ethRequired))).toFixed(6);
    } catch {
      ethFee.textContent = '-';
      summaryTotal.textContent = '-';
    }
  }

  withdrawAmountInput.addEventListener('input', updateWithdrawSummary);

  withdrawForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!signer) return showStatus('Connect wallet first', true);
    await ensureNetwork(CHAIN_ID_L2);
    const amount = withdrawAmountInput.value;
    if (!amount || isNaN(amount) || Number(amount) <= 0) return showStatus('Enter valid amount', true);
    try {
      showStatus('Approving tokens...');
      const l2UserToken = new ethers.Contract(addresses.l2.token, ERC20_ABI, signer);
      const decimals = 18;
      const value = ethers.parseUnits(amount, decimals);
      const approveTx = await l2UserToken.approve(addresses.l2.bridge, value);
      await approveTx.wait();
      showStatus('Tokens approved. Sending to bridge...');
      const l2UserBridge = new ethers.Contract(addresses.l2.bridge, await l2BridgeAbi, signer);
      const GAS_LIMIT = 1000000n;
      const l1FeeData = await l1Provider.getFeeData();
      const l1GasPrice = l1FeeData.gasPrice;
      const ethRequired = l1GasPrice * GAS_LIMIT;
      const tx = await l2UserBridge.bridgeToken(value, GAS_LIMIT, { value: ethRequired, gasLimit: Number(GAS_LIMIT) });
      showStatus('Transaction sent: ' + tx.hash);
      await tx.wait();
      showStatus('Withdraw successful!');
      await updateL2Balance();
    } catch (err) {
      showStatus('Error: ' + (err.info?.error?.message || err.message), true);
    }
  };

  maxBtn.onclick = async () => {
    if (!signer) return;
    try {
      const l2UserToken = new ethers.Contract(addresses.l2.token, ERC20_ABI, signer);
      const bal = await l2UserToken.balanceOf(userAddress);
      document.getElementById('withdraw-amount').value = ethers.formatEther(bal);
      await updateWithdrawSummary();
    } catch {}
  };
}); 