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

import { IERC20Metadata } from "../../../interfaces/external/IERC20Metadata.sol";
import { IERC4626 } from "../../../interfaces/external/IERC4626.sol";

/**
 * @title ERC4626Oracle
 * @author Index Cooperative
 *
 * Oracle built to retrieve the assets per one share of the ERC-4626 vault
 * 
 * @dev WARNING: ERC-4626 vaults using this oracle must be evaluated for potential 
 * read-only reentrancy vulnerabilities in the convertToAssets function. Vaults 
 * found to have this vulnerability should not use this oracle.
 */
contract ERC4626Oracle {
    IERC4626 public immutable vault;
    uint256 public immutable underlyingFullUnit;
    uint256 public immutable vaultFullUnit;
    string public dataDescription;

    /*
     * @param  _vault               The address of the ERC-4626 vault
     * @param  _dataDescription     Human readable description of oracle
     */
    constructor(
        IERC4626 _vault,
        string memory _dataDescription
    ) {
        vaultFullUnit = 10 ** _vault.decimals();

        IERC20Metadata underlyingAsset = IERC20Metadata(_vault.asset());
        underlyingFullUnit = 10 ** underlyingAsset.decimals();

        vault = _vault;
        dataDescription = _dataDescription;
    }

    /**
     * Returns the assets per one share of the vault normalized to 18 decimals
     */
    function read() external view returns (uint256) {
        uint256 assetsPerShare = vault.convertToAssets(vaultFullUnit);
        return assetsPerShare * 1e18 / underlyingFullUnit;
    }
}
