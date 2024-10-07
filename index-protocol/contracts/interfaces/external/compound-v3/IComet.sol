// SPDX-License-Identifier: Apache License, Version 2.0
pragma solidity 0.6.10;

interface IComet {
  function supply(address asset, uint amount) external;
  function withdraw(address asset, uint amount) external;
}
