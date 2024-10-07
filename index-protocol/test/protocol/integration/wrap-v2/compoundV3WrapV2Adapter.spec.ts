import "module-alias/register";
import { BigNumber } from "ethers";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ZERO, ZERO_BYTES } from "@utils/constants";
import { SystemFixture } from "@utils/fixtures";
import { CompoundV3WrapV2Adapter } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import { ether } from "@utils/index";
import {
  addSnapshotBeforeRestoreAfterEach,
  getAccounts,
  getSystemFixture,
  getRandomAddress,
  getWaffleExpect,
} from "@utils/test/index";
import { network } from "hardhat";
import { forkingConfig } from "../../../../hardhat.config";
import {
  IComet,
  IComet__factory,
} from "@typechain/index";

const expect = getWaffleExpect();

const tokenAddresses = {
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  cUSDCv3: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
};

describe("CompoundV3WrapV2Adapter", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;
  let compoundV3WrapAdapter: CompoundV3WrapV2Adapter;

  let comet: IComet;

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
    [
      owner,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    comet = IComet__factory.connect(tokenAddresses.cUSDCv3, owner.wallet);

    compoundV3WrapAdapter = await deployer.adapters.deployCompoundV3WrapV2Adapter(tokenAddresses.cUSDCv3);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#getSpenderAddress", async () => {
    async function subject(): Promise<any> {
      return compoundV3WrapAdapter.getSpenderAddress(tokenAddresses.usdc, tokenAddresses.cUSDCv3);
    }

    it("should return the correct spender address", async () => {
      const spender = await subject();
      expect(spender).to.eq(tokenAddresses.cUSDCv3);
    });
  });

  describe("#getWrapCallData", async () => {
    let subjectCToken: Address;
    let subjectUnderlyingToken: Address;
    let subjectQuantity: BigNumber;
    let subjectTo: Address;
    let subjectWrapData: string;

    beforeEach(async () => {
      subjectQuantity = ether(1);
      subjectUnderlyingToken = tokenAddresses.usdc;
      subjectCToken = tokenAddresses.cUSDCv3;
      subjectTo = await getRandomAddress();
      subjectWrapData = ZERO_BYTES;
    });

    async function subject(): Promise<any> {
      return compoundV3WrapAdapter.getWrapCallData(subjectUnderlyingToken, subjectCToken, subjectQuantity, subjectTo, subjectWrapData);
    }

    it("should return correct data)", async () => {
      const [targetAddress, ethValue, callData] = await subject();

      const expectedCalldata = comet.interface.encodeFunctionData("supply", [subjectUnderlyingToken, subjectQuantity]);

      expect(targetAddress).to.eq(tokenAddresses.cUSDCv3);
      expect(ethValue).to.eq(ZERO);
      expect(callData).to.eq(expectedCalldata);
    });
  });

  describe("#getUnwrapCallData", async () => {
    let subjectCToken: Address;
    let subjectUnderlyingToken: Address;
    let subjectQuantity: BigNumber;
    let subjectTo: Address;
    let subjectUnwrapData: string;

    beforeEach(async () => {
      subjectCToken = tokenAddresses.cUSDCv3;
      subjectUnderlyingToken = setup.dai.address;
      subjectQuantity = ether(1);
      subjectTo = await getRandomAddress();
      subjectUnwrapData = ZERO_BYTES;
    });

    async function subject(): Promise<any> {
      return compoundV3WrapAdapter.getUnwrapCallData(subjectUnderlyingToken, subjectCToken, subjectQuantity, subjectTo, subjectUnwrapData);
    }

    it("should return correct data", async () => {
      const [targetAddress, ethValue, callData] = await subject();

      const expectedCallData = comet.interface.encodeFunctionData("withdraw", [subjectUnderlyingToken, subjectQuantity]);

      expect(targetAddress).to.eq(tokenAddresses.cUSDCv3);
      expect(ethValue).to.eq(ZERO);
      expect(callData).to.eq(expectedCallData);
    });
  });
});
