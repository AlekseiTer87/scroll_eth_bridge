// SPDX-License-Identifier: MIT
pragma solidity =0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@scroll-tech/contracts/L2/gateways/IL2ERC20Gateway.sol";
import "@scroll-tech/contracts/L1/IL1ScrollMessenger.sol";

contract L1TokenBridge is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // События
    event DepositERC20(
        address indexed l1Token,
        address indexed l2Token,
        address indexed from,
        address to,
        uint256 amount,
        bytes data
    );

    event FinalizeWithdrawERC20(
        address indexed l1Token,
        address indexed l2Token,
        address indexed from,
        address to,
        uint256 amount,
        bytes data
    );

    // Адреса токенов L1 и L2
    address public l1Token;
    address public l2Token;
    
    // Адреса системных контрактов Scroll
    address public counterpart;
    address public router;
    address public messenger;
    
    // Инициализация 
    bool private _initialized;
    
    constructor() {}

    // Инициализация моста (вызывается один раз после деплоя)
    function initialize(
        address _counterpart, 
        address _router, 
        address _messenger,
        address _l1Token,
        address _l2Token
    ) external onlyOwner {
        require(!_initialized, "L1TokenBridge: already initialized");
        require(_router != address(0), "L1TokenBridge: zero router address");
        require(_messenger != address(0), "L1TokenBridge: zero messenger address");
        require(_counterpart != address(0), "L1TokenBridge: zero counterpart address");
        require(_l1Token != address(0), "L1TokenBridge: zero l1 token address");
        require(_l2Token != address(0), "L1TokenBridge: zero l2 token address");

        counterpart = _counterpart;
        router = _router;
        messenger = _messenger;
        l1Token = _l1Token;
        l2Token = _l2Token;
        
        _initialized = true;
    }

    // Возвращает адрес L2 токена для соответствующего L1 токена
    function getL2ERC20Address(address _l1Token) public view returns (address) {
        require(_l1Token == l1Token, "L1TokenBridge: invalid token");
        return l2Token;
    }

    // Публичный метод для отправки токенов через мост
    function bridgeToken(uint256 _amount, uint256 _gasLimit) external payable nonReentrant {
        require(msg.value > 0, "L1TokenBridge: need ETH for fees");
        require(_amount > 0, "L1TokenBridge: bridge zero amount");
        _deposit(msg.sender, _amount, _gasLimit);
    }

    // Финализирует вывод токена с L2 на L1
    function finalizeWithdrawERC20(
        address _l1Token,
        address _l2Token,
        address _from,
        address _to,
        uint256 _amount,
        bytes calldata _data
    ) external payable {
        require(msg.sender == messenger, "L1TokenBridge: not from messenger");
        require(IL1ScrollMessenger(messenger).xDomainMessageSender() == counterpart, "L1TokenBridge: not from counterpart");
        require(_l1Token == l1Token, "L1TokenBridge: invalid l1 token");
        require(_l2Token == l2Token, "L1TokenBridge: invalid l2 token");
        
        // Отправляем токены получателю
        IERC20(_l1Token).safeTransfer(_to, _amount);
        
        emit FinalizeWithdrawERC20(_l1Token, _l2Token, _from, _to, _amount, _data);
    }

    // Внутренняя функция для депозита токена с L1 на L2
    function _deposit(
        address _to,
        uint256 _amount,
        uint256 _gasLimit
    ) internal {
        // 1. Перевод токена на контракт моста
        IERC20(l1Token).safeTransferFrom(msg.sender, address(this), _amount);

        // 2. Генерация сообщения для L2CustomERC20Gateway
        bytes memory _message = abi.encodeCall(
            IL2ERC20Gateway.finalizeDepositERC20,
            (l1Token, l2Token, msg.sender, _to, _amount, new bytes(0))
        );

        // 3. Отправка сообщения в L1ScrollMessenger
        IL1ScrollMessenger(messenger).sendMessage{ value: msg.value }(counterpart, 0, _message, _gasLimit, msg.sender);

        emit DepositERC20(l1Token, l2Token, msg.sender, _to, _amount, new bytes(0));
    }
} 