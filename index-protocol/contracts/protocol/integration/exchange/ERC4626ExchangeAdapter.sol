/*
    Copyright 2024 Index Cooperative

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

    SPDX-License-Identifier: Apache-2.0	
*/

pragma solidity 0.8.17;

import { IERC4626 } from "../../../interfaces/external/IERC4626.sol";

/**
 * @title ERC4626ExchangeAdapter
 * @author Index Cooperative
 *
 * Exchange adapter for ERC-4626 Vaults that returns data for wraps/unwraps of tokens.
 * 
 * This adapter is intended to handle both no-loss wrapping and unwrapping of assets and ones 
 * that may incur a loss in value due to fees or other factors. 
 */
contract ERC4626ExchangeAdapter {

    /* ============ State Variables ============ */

    IERC4626 public vault;

    /* ========= Constructor ========== */

    /**
     * Set ERC-4626 vault address
     * @param _vault           Address of the ERC-4626 vault
     */
    constructor(IERC4626 _vault) {
        vault = _vault;
    }

    function getTradeCalldata(
        address _sourceToken,
        address _destinationToken,
        address _destinationAddress,
        uint256 _sourceQuantity,
        uint256 /* _minDestinationQuantity  */,
        bytes memory /* _data */
    )
        external
        view
        returns (address, uint256, bytes memory)
    {
        if (_sourceToken == vault.asset()) {
            require(_destinationToken == address(vault), "Invalid destination token");

            bytes memory callData = abi.encodeWithSelector(
                IERC4626.deposit.selector, 
                _sourceQuantity, 
                _destinationAddress
            );

            return (address(vault), 0, callData);
        }
        else if (_sourceToken == address(vault)) {
            require(_destinationToken == vault.asset(), "Invalid destination token");

            bytes memory callData = abi.encodeWithSelector(
                IERC4626.redeem.selector, 
                _sourceQuantity, 
                _destinationAddress,
                _destinationAddress
            );

            return (address(vault), 0, callData);
        }
        else {
            revert("Invalid source token");
        }
    }

    function getSpender()
        external
        view
        returns (address)
    {
        return address(vault);
    }
}
