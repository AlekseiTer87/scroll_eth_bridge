// SPDX-License-Identifier: MIT
pragma solidity ^0.8.16;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract L1CustomToken is ERC20, Ownable {
    constructor() ERC20("sut_test_token_bonch_l1", "sut1") {
        _mint(msg.sender, 1_000_000 ether);
    }

    // Функция для эмиссии дополнительных токенов
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
} 