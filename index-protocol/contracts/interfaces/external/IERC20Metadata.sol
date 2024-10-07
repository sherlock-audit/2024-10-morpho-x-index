// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.17;

interface IERC20Metadata {
    function name() external view returns (string memory);

    function symbol() external view returns (string memory);

    function decimals() external view returns (uint8);
}
