// SPDX-License-Identifier: MIT
pragma solidity ^0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@scroll-tech/contracts/L2/gateways/IL2ETHGateway.sol";
import "@scroll-tech/contracts/L1/IL1ScrollMessenger.sol";

contract L1LockBridge is Ownable, ReentrancyGuard {
    // События
    event ETHLocked(
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes data
    );

    event ETHUnlocked(
        address indexed from,
        address indexed to,
        uint256 amount,
        bytes data
    );

    event BridgeBalanceWithdrawn(
        address indexed to,
        uint256 amount
    );

    // Адреса системных контрактов Scroll
    address public counterpart;
    address public router;
    address public messenger;
    
    // Флаг инициализации
    bool private _initialized;
    
    uint256 public fixedFee = 0.001 ether; // фиксированная комиссия
    uint256 public percentFeeBps = 10; // 0.1% (BPS = basis points, 1% = 100 BPS)
    uint256 public gasMarkupBps = 1000; // 10% markup

    constructor() {}

    // Получение ETH
    receive() external payable {}
    fallback() external payable {}

    function initialize(
        address _counterpart, 
        address _router, 
        address _messenger
    ) external onlyOwner {
        require(!_initialized, "L1LockBridge: already initialized");
        require(_router != address(0), "L1LockBridge: zero router address");
        require(_messenger != address(0), "L1LockBridge: zero messenger address");
        require(_counterpart != address(0), "L1LockBridge: zero counterpart address");

        counterpart = _counterpart;
        router = _router;
        messenger = _messenger;
        
        _initialized = true;
    }

    function setFees(uint256 _fixedFee, uint256 _percentFeeBps, uint256 _gasMarkupBps) external onlyOwner {
        fixedFee = _fixedFee;
        percentFeeBps = _percentFeeBps;
        gasMarkupBps = _gasMarkupBps;
    }

    function estimateInternalGasCost(uint256 gasLimit, uint256 gasPrice) public view returns (uint256) {
        uint256 baseCost = gasLimit * gasPrice;
        uint256 markup = (baseCost * gasMarkupBps) / 10000;
        return baseCost + markup;
    }

    function calculateTotalFee(uint256 amount, uint256 gasLimit, uint256 gasPrice) public view returns (uint256) {
        uint256 percentFee = (amount * percentFeeBps) / 10000;
        uint256 gasCompensation = estimateInternalGasCost(gasLimit, gasPrice);
        return fixedFee + percentFee + gasCompensation;
    }

    // Перевод ETH из L1 в L2
    function bridgeETH(uint256 _gasLimit, uint256 _gasPrice) external payable nonReentrant {
        uint256 totalFee = calculateTotalFee(msg.value, _gasLimit, _gasPrice);
        uint256 crossChainFee = _calculateFee(_gasLimit);
        require(msg.value > totalFee + crossChainFee, "L1LockBridge: amount less than total fee");
        uint256 amount = msg.value - totalFee - crossChainFee;

        // Блокируем ETH на контракте (amount)
        // Формируем сообщение для L2
        bytes memory message = abi.encodeCall(
            IL2ETHGateway.finalizeDepositETH,
            (msg.sender, msg.sender, amount, new bytes(0))
        );

        // Отправляем только fee в мессенджер
        IL1ScrollMessenger(messenger).sendMessage{value: crossChainFee}(
            counterpart,
            0,
            message,
            _gasLimit,
            msg.sender
        );

        emit ETHLocked(msg.sender, msg.sender, amount, new bytes(0));
    }

    // Добавление ETH в мост без инициации перевода
    function addBridgeBalance() external payable nonReentrant {
        require(msg.value > 0, "L1LockBridge: zero amount");
    }

    // Административная функция для вывода ETH для ребалансировки
    function withdrawBridgeBalance(uint256 _amount, address payable _to) external onlyOwner nonReentrant {
        require(_amount > 0, "L1LockBridge: zero amount");
        require(_to != address(0), "L1LockBridge: zero address");
        require(_amount <= address(this).balance, "L1LockBridge: insufficient balance");
        
        (bool success, ) = _to.call{value: _amount}("");
        require(success, "L1LockBridge: ETH transfer failed");
        
        emit BridgeBalanceWithdrawn(_to, _amount);
    }

    // Вывод (unlock) — только по сообщению от мессенджера
    function finalizeWithdrawETH(
        address _from,
        address payable _to,
        uint256 _amount,
        bytes calldata _data
    ) external payable {
        require(msg.sender == messenger, "L1LockBridge: not from messenger");
        require(IL1ScrollMessenger(messenger).xDomainMessageSender() == counterpart, "L1LockBridge: not from counterpart");
        require(address(this).balance >= _amount, "L1LockBridge: insufficient balance");
        
        (bool success, ) = _to.call{value: _amount}("");
        require(success, "L1LockBridge: ETH transfer failed");
        
        emit ETHUnlocked(_from, _to, _amount, _data);
    }

    // Внутренняя функция для расчета комиссии
    function _calculateFee(uint256 _gasLimit) internal pure returns (uint256) {
        // Здесь можно добавить более сложную логику расчета комиссии
        return _gasLimit * 1 gwei;
    }
} 