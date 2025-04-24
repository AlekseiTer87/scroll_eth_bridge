// SPDX-License-Identifier: MIT
pragma solidity ^0.8.16;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@scroll-tech/contracts/libraries/token/IScrollERC20Extension.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Добавляем интерфейс IL2StandardERC20 для лучшей совместимости с Scroll
interface IL2StandardERC20 {
    function l1Token() external view returns (address);
    function mint(address account, uint256 amount) external;
    function burn(address account, uint256 amount) external;
}

contract L2CustomToken is ERC20, IScrollERC20Extension, Ownable {
    // Адрес моста (gateway) и адрес соответствующего L1 токена
    address private _gateway;
    address private _counterpart;

    constructor(address gateway_, address counterpart_) ERC20("maybe this last try l2", "maybe2") {
        _gateway = gateway_;
        _counterpart = counterpart_;
    }

    // Возвращает адрес шлюза
    function gateway() public view override returns (address) {
        return _gateway;
    }

    // Возвращает адрес соответствующего токена на L1
    function counterpart() external view override returns (address) {
        return _counterpart;
    }
    
    // Псевдоним для counterpart() для совместимости с IL2StandardERC20
    function l1Token() external view returns (address) {
        return _counterpart;
    }

    // Устанавливает новый адрес шлюза (только владелец)
    function setGateway(address newGateway) external onlyOwner {
        require(newGateway != address(0), "L2CustomToken: zero gateway address");
        _gateway = newGateway;
    }

    // Устанавливает новый адрес соответствующего токена (только владелец)
    function setCounterpart(address newCounterpart) external onlyOwner { 
        require(newCounterpart != address(0), "L2CustomToken: zero counterpart address");
        _counterpart = newCounterpart;
    }

    // Реализация transferAndCall для IScrollERC20Extension
    function transferAndCall(address receiver, uint256 amount, bytes calldata data) 
        external 
        override 
        returns (bool success) 
    {
        transfer(receiver, amount);
        return true;
    }

    // Эмиссия токенов (только для шлюза)
    function mint(address to, uint256 amount) external override onlyGateway {
        _mint(to, amount);
    }

    // Сжигание токенов (только для шлюза)
    function burn(address from, uint256 amount) external override onlyGateway {
        _burn(from, amount);
    }

    // Модификатор, ограничивающий вызов только для шлюза
    modifier onlyGateway() {
        require(gateway() == _msgSender(), "L2CustomToken: caller is not the gateway");
        _;
    }
} 