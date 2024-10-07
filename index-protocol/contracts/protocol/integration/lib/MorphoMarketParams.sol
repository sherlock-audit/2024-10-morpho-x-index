// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.6.10;

import { MarketParams } from "../../../interfaces/external/morpho/IMorpho.sol";

/// @title MarketParamsLib
/// @author Morpho Labs
/// @notice Library to convert a market to its id.
library MorphoMarketParams {
    /// @notice The length of the data used to compute the id of a market.
    /// @dev The length is 5 * 32 because `MarketParams` has 5 variables of 32 bytes each.
    uint256 internal constant MARKET_PARAMS_BYTES_LENGTH = 5 * 32;

    /// @notice Returns the id of the market `marketParams`.
    function id(MarketParams memory marketParams) internal pure returns (bytes32 marketParamsId) {
        // @NOTE: I had to remove the  ("memory-safe") here because it is not supported in solditiy 0.6
        assembly {
            marketParamsId := keccak256(marketParams, MARKET_PARAMS_BYTES_LENGTH)
        }
    }
}


