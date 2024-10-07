// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

import { BurnMintERC677 } from "@chainlink/contracts-ccip/src/v0.8/shared/token/ERC677/BurnMintERC677.sol";

contract BridgedSetToken is BurnMintERC677 {
    constructor(
        string memory _name,
        string memory _symbol
    ) BurnMintERC677(
        _name,
        _symbol,
        18,
        0
    ) {}
}
