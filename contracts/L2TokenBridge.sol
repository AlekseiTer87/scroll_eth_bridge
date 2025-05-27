// SPDX-License-Identifier: MIT
pragma solidity ^0.8.16;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@scroll-tech/contracts/L1/gateways/IL1ERC20Gateway.sol";
import "@scroll-tech/contracts/L2/IL2ScrollMessenger.sol";
import "@scroll-tech/contracts/libraries/token/IScrollERC20Extension.sol";

contract L2TokenBridge is Ownable, ReentrancyGuard {
    // События
    event WithdrawERC20(
        address indexed l1Token,
        address indexed l2Token,
        address indexed from,
        address to,
        uint256 amount,
        bytes data
    );

    event FinalizeDepositERC20(
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
        require(!_initialized, "L2TokenBridge: already initialized");
        require(_router != address(0), "L2TokenBridge: zero router address");
        require(_messenger != address(0), "L2TokenBridge: zero messenger address");
        require(_counterpart != address(0), "L2TokenBridge: zero counterpart address");
        require(_l1Token != address(0), "L2TokenBridge: zero l1 token address");
        require(_l2Token != address(0), "L2TokenBridge: zero l2 token address");

        counterpart = _counterpart;
        router = _router;
        messenger = _messenger;
        l1Token = _l1Token;
        l2Token = _l2Token;
        
        _initialized = true;
    }

    // Возвращает адрес L1 токена для соответствующего L2 токена
    function getL1ERC20Address(address _l2Token) public view returns (address) {
        require(_l2Token == l2Token, "L2TokenBridge: invalid token");
        return l1Token;
    }

    // Публичный метод для отправки токенов через мост обратно на L1
    function bridgeToken(uint256 _amount, uint256 _gasLimit) external payable nonReentrant {
        require(_amount > 0, "L2TokenBridge: bridge zero amount");
        require(msg.value > 0, "L2TokenBridge: need ETH for fees"); // Проверка наличия ETH для комиссии
        
        // Упрощенный вызов без проверки на роутер
        _withdraw(msg.sender, msg.sender, _amount, _gasLimit, new bytes(0));
    }
    
    // Финализирует депозит токена с L1 на L2
    function finalizeDepositERC20(
        address _l1Token,
        address _l2Token,
        address _from,
        address _to,
        uint256 _amount,
        bytes calldata _data
    ) external {
        require(msg.sender == messenger, "L2TokenBridge: not from messenger");
        require(IL2ScrollMessenger(messenger).xDomainMessageSender() == counterpart, "L2TokenBridge: not from counterpart");
        require(_l1Token == l1Token, "L2TokenBridge: invalid l1 token");
        require(_l2Token == l2Token, "L2TokenBridge: invalid l2 token");
        
        // Минтим токены получателю
        IScrollERC20Extension(l2Token).mint(_to, _amount);
        
        emit FinalizeDepositERC20(_l1Token, _l2Token, _from, _to, _amount, _data);
    }

    // Внутренняя функция для вывода токена с L2 на L1
    function _withdraw(
        address _from,
        address _to,
        uint256 _amount,
        uint256 _gasLimit,
        bytes memory _data
    ) internal {
        // Сжигаем токены на L2
        IScrollERC20Extension(l2Token).burn(_from, _amount);

        // Генерируем сообщение для L1ERC20Gateway
        bytes memory _message = abi.encodeCall(
            IL1ERC20Gateway.finalizeWithdrawERC20,
            (l1Token, l2Token, _from, _to, _amount, _data)
        );

        // Отправляем сообщение в L2ScrollMessenger, передавая всю msg.value
        IL2ScrollMessenger(messenger).sendMessage{ value: msg.value }(
            counterpart,
            msg.value,
            _message,
            _gasLimit
        );

        emit WithdrawERC20(l1Token, l2Token, _from, _to, _amount, _data);
    }
} 