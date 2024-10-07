import "module-alias/register";
import { BigNumber } from "ethers";
import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, ONE, ZERO_BYTES } from "@utils/constants";
import { AaveV3WrapV2Adapter, SetToken, WrapModuleV2 } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
  preciseMul,
  usdc,
} from "@utils/index";
import {
  getAccounts,
  getWaffleExpect,
  getSystemFixture,
  addSnapshotBeforeRestoreAfterEach,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";
import {
  IERC20,
  IERC20__factory,
} from "@typechain/index";
import { network } from "hardhat";
import { forkingConfig } from "../../../hardhat.config";
import { impersonateAccount } from "@utils/test/testingUtils";

const expect = getWaffleExpect();

const contractAddresses = {
  aaveV3Pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2",
};

const tokenAddresses = {
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  aEthUSDC: "0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c",
};

const whales = {
  usdc: "0xf584F8728B874a6a5c7A8d4d387C9aae9172D621",
};

describe("AaveV3WrapModule [ @forked-mainnet ]", () => {
  let owner: Account;
  let deployer: DeployHelper;

  let setV2Setup: SystemFixture;

  let aaveV3WrapAdapter: AaveV3WrapV2Adapter;
  let wrapModule: WrapModuleV2;

  let underlyingToken: IERC20;
  let wrappedToken: IERC20;

  const aaveV3WrapAdapterIntegrationName: string = "AAVE_V3_WRAPPER";

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

    // System setup
    deployer = new DeployHelper(owner.wallet);
    setV2Setup = getSystemFixture(owner.address);
    await setV2Setup.initialize();

    underlyingToken = IERC20__factory.connect(tokenAddresses.usdc, owner.wallet);
    wrappedToken = IERC20__factory.connect(tokenAddresses.aEthUSDC, owner.wallet);

    // WrapModule setup
    wrapModule = await deployer.modules.deployWrapModuleV2(setV2Setup.controller.address, setV2Setup.weth.address);
    await setV2Setup.controller.addModule(wrapModule.address);

    // AaveV3WrapAdapter setup
    aaveV3WrapAdapter = await deployer.adapters.deployAaveV3WrapV2Adapter(contractAddresses.aaveV3Pool);
    await setV2Setup.integrationRegistry.addIntegration(wrapModule.address, aaveV3WrapAdapterIntegrationName, aaveV3WrapAdapter.address);
  });

  addSnapshotBeforeRestoreAfterEach();

  context("when a SetToken has been deployed and issued", async () => {
    let setToken: SetToken;
    let setTokensIssued: BigNumber;

    before(async () => {
      setToken = await setV2Setup.createSetToken(
        [tokenAddresses.usdc],
        [usdc(1)],
        [setV2Setup.issuanceModule.address, wrapModule.address]
      );

      // Initialize modules
      await setV2Setup.issuanceModule.initialize(setToken.address, ADDRESS_ZERO);
      await wrapModule.initialize(setToken.address);

      // Issue some Sets
      setTokensIssued = ether(10);
      const underlyingRequired = setTokensIssued;

      const usdcWhale = await impersonateAccount(whales.usdc);
      await underlyingToken.connect(usdcWhale).approve(setV2Setup.issuanceModule.address, underlyingRequired);
      await setV2Setup.issuanceModule.connect(usdcWhale).issue(setToken.address, setTokensIssued, owner.address);
    });

    describe("#wrap", async () => {
      let subjectSetToken: Address;
      let subjectUnderlyingToken: Address;
      let subjectWrappedToken: Address;
      let subjectUnderlyingUnits: BigNumber;
      let subjectIntegrationName: string;
      let subjectWrapData: string;
      let subjectCaller: Account;

      beforeEach(async () => {
        subjectSetToken = setToken.address;
        subjectUnderlyingToken = underlyingToken.address;
        subjectWrappedToken = wrappedToken.address;
        subjectUnderlyingUnits = usdc(1);
        subjectIntegrationName = aaveV3WrapAdapterIntegrationName;
        subjectWrapData = ZERO_BYTES;
        subjectCaller = owner;
      });

      async function subject(): Promise<any> {
        return wrapModule.connect(subjectCaller.wallet).wrap(
          subjectSetToken,
          subjectUnderlyingToken,
          subjectWrappedToken,
          subjectUnderlyingUnits,
          subjectIntegrationName,
          subjectWrapData
        );
      }

      it("should reduce the underlying quantity and mint the wrapped asset to the SetToken", async () => {
        const previousUnderlyingBalance = await underlyingToken.balanceOf(setToken.address);
        const previousWrappedBalance = await wrappedToken.balanceOf(setToken.address);

        await subject();

        const underlyingBalance = await underlyingToken.balanceOf(setToken.address);
        const wrappedBalance = await wrappedToken.balanceOf(setToken.address);

        const delta = preciseMul(setTokensIssued, subjectUnderlyingUnits);

        const expectedUnderlyingBalance = previousUnderlyingBalance.sub(delta);
        expect(underlyingBalance).to.eq(expectedUnderlyingBalance);

        const expectedWrappedBalance = previousWrappedBalance.add(delta);
        expect(wrappedBalance).to.eq(expectedWrappedBalance);
      });
    });

    describe("#unwrap", () => {
      let subjectSetToken: Address;
      let subjectUnderlyingToken: Address;
      let subjectWrappedToken: Address;
      let subjectWrappedTokenUnits: BigNumber;
      let subjectIntegrationName: string;
      let subjectUnwrapData: string;
      let subjectCaller: Account;

      let wrappedQuantity: BigNumber;

      beforeEach(async () => {
        subjectSetToken = setToken.address;
        subjectUnderlyingToken = underlyingToken.address;
        subjectWrappedToken = wrappedToken.address;
        subjectWrappedTokenUnits = usdc(0.5);
        subjectIntegrationName = aaveV3WrapAdapterIntegrationName;
        subjectUnwrapData = ZERO_BYTES;
        subjectCaller = owner;

        wrappedQuantity = usdc(1);

        await wrapModule.wrap(
          subjectSetToken,
          subjectUnderlyingToken,
          subjectWrappedToken,
          wrappedQuantity,
          subjectIntegrationName,
          ZERO_BYTES
        );
      });

      async function subject(): Promise<any> {
        return wrapModule.connect(subjectCaller.wallet).unwrap(
          subjectSetToken,
          subjectUnderlyingToken,
          subjectWrappedToken,
          subjectWrappedTokenUnits,
          subjectIntegrationName,
          subjectUnwrapData,
          {
            gasLimit: 5000000,
          }
        );
      }

      it("should burn the wrapped asset to the SetToken and increase the underlying quantity", async () => {
        const previousUnderlyingBalance = await underlyingToken.balanceOf(setToken.address);
        const previousWrappedBalance = await wrappedToken.balanceOf(setToken.address);

        await subject();

        const underlyingBalance = await underlyingToken.balanceOf(setToken.address);
        const wrappedBalance = await wrappedToken.balanceOf(setToken.address);

        const delta = preciseMul(setTokensIssued, wrappedQuantity.sub(subjectWrappedTokenUnits));

        const expectedUnderlyingBalance = previousUnderlyingBalance.add(delta);
        expect(underlyingBalance).to.eq(expectedUnderlyingBalance);

        const expectedWrappedBalance = previousWrappedBalance.sub(delta).sub(ONE); // 1 wei rounding loss
        expect(wrappedBalance).to.eq(expectedWrappedBalance);
      });
    });
  });
});
