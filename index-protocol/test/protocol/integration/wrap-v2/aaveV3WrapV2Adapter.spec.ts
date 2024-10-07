import "module-alias/register";
import { BigNumber } from "ethers";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ZERO, ZERO_BYTES } from "@utils/constants";
import { AaveV3WrapV2Adapter } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import { ether } from "@utils/index";
import {
  addSnapshotBeforeRestoreAfterEach,
  getAccounts,
  getRandomAddress,
  getSystemFixture,
  getWaffleExpect,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";
import {
  IERC20,
  IERC20__factory,
  IPool,
  IPool__factory,
} from "@typechain/index";
import { network } from "hardhat";
import { forkingConfig } from "../../../../hardhat.config";

const expect = getWaffleExpect();

const contractAddresses = {
  aaveV3Pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
};

const tokenAddresses = {
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  aEthUSDC: "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c",
  aEthWETH: "0x4d5F47FA6A74757f35C14fD3a6Ef8E3C9BC514E8",
};

describe("AaveV3WrapAdapter", () => {

  let owner: Account;
  let deployer: DeployHelper;

  let setV2Setup: SystemFixture;

  let aaveV3WrapAdapter: AaveV3WrapV2Adapter;

  let underlyingToken: IERC20;
  let wrappedToken: IERC20;

  let aaveLendingPool: IPool;

  const blockNumber = 20420724;
  before(async () => {
    const forking = {
      jsonRpcUrl: forkingConfig.url,
      blockNumber,
    };
    await network.provider.request({
      method: "hardhat_reset",
      params: [
        {
          forking,
        },
      ],
    });
  });
  after(async () => {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  });

  before(async () => {
    [ owner ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);

    setV2Setup = getSystemFixture(owner.address);

    await setV2Setup.initialize();

    underlyingToken = IERC20__factory.connect(tokenAddresses.usdc, owner.wallet);
    wrappedToken = IERC20__factory.connect(tokenAddresses.aEthUSDC, owner.wallet);

    aaveLendingPool = IPool__factory.connect(contractAddresses.aaveV3Pool, owner.wallet);

    aaveV3WrapAdapter = await deployer.adapters.deployAaveV3WrapV2Adapter(contractAddresses.aaveV3Pool);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#constructor", async () => {
    let subjectPool: Address;

    beforeEach(async () => {
      subjectPool = contractAddresses.aaveV3Pool;
    });

    async function subject(): Promise<AaveV3WrapV2Adapter> {
      return deployer.adapters.deployAaveV3WrapV2Adapter(subjectPool);
    }

    it("should have the correct Pool address", async () => {
      const deployedAaveV3WrapAdapter = await subject();

      expect(await deployedAaveV3WrapAdapter.pool()).to.eq(subjectPool);
    });
  });

  describe("#getSpenderAddress", async () => {
    async function subject(): Promise<any> {
      return aaveV3WrapAdapter.getSpenderAddress(underlyingToken.address, wrappedToken.address);
    }

    it("should return the correct spender address", async () => {
      const spender = await subject();

      expect(spender).to.eq(contractAddresses.aaveV3Pool);
    });
  });

  describe("#getWrapCallData", async () => {
    let subjectUnderlyingToken: Address;
    let subjectWrappedToken: Address;
    let subjectUnderlyingUnits: BigNumber;
    let subjectTo: Address;
    let subjectWrapData: string;

    beforeEach(async () => {
      subjectUnderlyingToken = underlyingToken.address;
      subjectWrappedToken = wrappedToken.address;
      subjectUnderlyingUnits = ether(2);
      subjectTo = await getRandomAddress();
      subjectWrapData = ZERO_BYTES;
    });

    async function subject(): Promise<[string, BigNumber, string]> {
      return aaveV3WrapAdapter.getWrapCallData(subjectUnderlyingToken, subjectWrappedToken, subjectUnderlyingUnits, subjectTo, subjectWrapData);
    }

    it("should return correct data for valid pair", async () => {
      const [targetAddress, ethValue, callData] = await subject();

      const expectedCallData = aaveLendingPool.interface.encodeFunctionData(
        "deposit",
        [subjectUnderlyingToken, subjectUnderlyingUnits, subjectTo, 0]
      );

      expect(targetAddress).to.eq(aaveLendingPool.address);
      expect(ethValue).to.eq(ZERO);
      expect(callData).to.eq(expectedCallData);
    });

    describe("when invalid wrapped token / underlying token pair", () => {
      beforeEach(async () => {
        subjectUnderlyingToken = underlyingToken.address;
        subjectWrappedToken = tokenAddresses.aEthWETH;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid token pair");
      });
    });
  });

  describe("#getUnwrapCallData", async () => {
    let subjectUnderlyingToken: Address;
    let subjectWrappedToken: Address;
    let subjectWrappedTokenUnits: BigNumber;
    let subjectTo: Address;
    let subjectUnwrapData: string;

    beforeEach(async () => {
      subjectUnderlyingToken = underlyingToken.address;
      subjectWrappedToken = wrappedToken.address;
      subjectWrappedTokenUnits = ether(2);
      subjectTo = await getRandomAddress();
      subjectUnwrapData = ZERO_BYTES;
    });

    async function subject(): Promise<[string, BigNumber, string]> {
      return aaveV3WrapAdapter.getUnwrapCallData(subjectUnderlyingToken, subjectWrappedToken, subjectWrappedTokenUnits, subjectTo, subjectUnwrapData);
    }

    it("should return correct data for valid pair", async () => {
      const [targetAddress, ethValue, callData] = await subject();

      const expectedCallData = aaveLendingPool.interface.encodeFunctionData(
        "withdraw",
        [subjectUnderlyingToken, subjectWrappedTokenUnits, subjectTo]
      );

      expect(targetAddress).to.eq(aaveLendingPool.address);
      expect(ethValue).to.eq(ZERO);
      expect(callData).to.eq(expectedCallData);
    });

    describe("when invalid wrapped token / underlying token pair", () => {
      beforeEach(async () => {
        subjectUnderlyingToken = underlyingToken.address;
        subjectWrappedToken = tokenAddresses.aEthWETH;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid token pair");
      });
    });
  });
});
