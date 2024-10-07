// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity ^0.6.10;
import { SafeMath } from "@openzeppelin/contracts/math/SafeMath.sol";


/// @title MathLib
/// @author Morpho Labs
/// @notice Library to manage fixed-point arithmetic.
library MorphoMathLib {
    using SafeMath for uint256;

    uint256 constant WAD = 1e18;

    /// @dev Returns (`x` * `y`) / `WAD` rounded down.
    function wMulDown(uint256 x, uint256 y) internal pure returns (uint256) {
        return mulDivDown(x, y, WAD);
    }

    /// @dev Returns (`x` * `WAD`) / `y` rounded down.
    function wDivDown(uint256 x, uint256 y) internal pure returns (uint256) {
        return mulDivDown(x, WAD, y);
    }

    /// @dev Returns (`x` * `WAD`) / `y` rounded up.
    function wDivUp(uint256 x, uint256 y) internal pure returns (uint256) {
        return mulDivUp(x, WAD, y);
    }


    /// @dev Returns (`x` * `y`) / `d` rounded down.
    function mulDivDown(uint256 x, uint256 y, uint256 d) internal pure returns (uint256) {
        return (x.mul(y)).div(d);
    }

    /// @dev Returns (`x` * `y`) / `d` rounded up.
    function mulDivUp(uint256 x, uint256 y, uint256 d) internal pure returns (uint256) {
        return x.mul(y).add(d.sub(1)).div(d);
    }

    /// @dev Returns the sum of the first three non-zero terms of a Taylor expansion of e^(nx) - 1, to approximate a
    /// continuous compound interest rate.
    function wTaylorCompounded(uint256 x, uint256 n) internal pure returns (uint256) {
        uint256 firstTerm = x.mul(n);
        uint256 secondTerm = mulDivDown(firstTerm, firstTerm, WAD.mul(2));
        uint256 thirdTerm = mulDivDown(secondTerm, firstTerm, WAD.mul(3));

        return firstTerm.add(secondTerm).add(thirdTerm);
    }
}

