import "module-alias/register";
import { BigNumber } from "ethers";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ADDRESS_ZERO, MAX_UINT_256, ONE, TWO, ZERO, ZERO_BYTES } from "@utils/constants";
import { SetToken, WrapModuleV2 } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
  preciseMul,
  usdc
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

const tokenAddresses = {
  usdc: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  cUSDCv3: "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
  weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  cWETHv3: "0xA17581A9E3356d9A858b789D68B4d866e593aE94",
};

const whales = {
  usdc: "0xf584F8728B874a6a5c7A8d4d387C9aae9172D621",
  fantom: "0x431e81E5dfB5A24541b5Ff8762bDEF3f32F96354",
};

describe("CompoundV3WrapModule [ @forked-mainnet ]", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let wrapModule: WrapModuleV2;

  let usdc_erc20: IERC20;
  let cUSDCv3: IERC20;
  let weth_erc20: IERC20;
  let cWETHv3: IERC20;

  const usdcCompoundV3WrapAdapterIntegrationName: string = "COMPOUND_V3_USDC_WRAPPER";
  const wethCompoundV3WrapAdapterIntegrationName: string = "COMPOUND_V3_WETH_WRAPPER";

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

    // System setup
    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    // Token setup
    usdc_erc20 = IERC20__factory.connect(tokenAddresses.usdc, owner.wallet);
    cUSDCv3 = IERC20__factory.connect(tokenAddresses.cUSDCv3, owner.wallet);
    weth_erc20 = IERC20__factory.connect(tokenAddresses.weth, owner.wallet);
    cWETHv3 = IERC20__factory.connect(tokenAddresses.cWETHv3, owner.wallet);

    // WrapModule setup
    wrapModule = await deployer.modules.deployWrapModuleV2(setup.controller.address, setup.weth.address);
    await setup.controller.addModule(wrapModule.address);

    // CompoundV3WrapAdapter setup
    const usdcCompoundV3WrapAdapter = await deployer.adapters.deployCompoundV3WrapV2Adapter(tokenAddresses.cUSDCv3);
    await setup.integrationRegistry.addIntegration(wrapModule.address, usdcCompoundV3WrapAdapterIntegrationName, usdcCompoundV3WrapAdapter.address);

    const wethCompoundV3WrapAdapter = await deployer.adapters.deployCompoundV3WrapV2Adapter(tokenAddresses.cWETHv3);
    await setup.integrationRegistry.addIntegration(wrapModule.address, wethCompoundV3WrapAdapterIntegrationName, wethCompoundV3WrapAdapter.address);
  });

  addSnapshotBeforeRestoreAfterEach();

  context("when a SetToken has been deployed and issued", async () => {
    let setToken: SetToken;
    let setTokensIssued: BigNumber;

    beforeEach(async () => {
      setToken = await setup.createSetToken(
        [tokenAddresses.usdc, tokenAddresses.weth],
        [usdc(100), ether(1)],
        [setup.issuanceModule.address, wrapModule.address]
      );

      // Initialize modules
      await setup.issuanceModule.initialize(setToken.address, ADDRESS_ZERO);
      await wrapModule.initialize(setToken.address);

      // Issue some Sets
      setTokensIssued = ether(10);

      const usdcWhale = await impersonateAccount(whales.usdc);
      await usdc_erc20.connect(usdcWhale).transfer(owner.address, usdc(10000));

      const wethWhale = await impersonateAccount(whales.fantom);
      await weth_erc20.connect(wethWhale).transfer(owner.address, ether(100));

      await usdc_erc20.connect(owner.wallet).approve(setup.issuanceModule.address, MAX_UINT_256);
      await weth_erc20.connect(owner.wallet).approve(setup.issuanceModule.address, MAX_UINT_256);
      await setup.issuanceModule.connect(owner.wallet).issue(setToken.address, setTokensIssued, owner.address);
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
        subjectUnderlyingToken = tokenAddresses.usdc;
        subjectWrappedToken = tokenAddresses.cUSDCv3;
        subjectUnderlyingUnits = usdc(100);
        subjectIntegrationName = usdcCompoundV3WrapAdapterIntegrationName;
        subjectCaller = owner;
        subjectWrapData = ZERO_BYTES;
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
        const previousUnderlyingBalance = await usdc_erc20.balanceOf(setToken.address);
        const previousWrappedBalance = await cUSDCv3.balanceOf(setToken.address);

        await subject();

        const underlyingBalance = await usdc_erc20.balanceOf(setToken.address);
        const wrappedBalance = await cUSDCv3.balanceOf(setToken.address);

        const delta = preciseMul(setTokensIssued, subjectUnderlyingUnits);

        const expectedUnderlyingBalance = previousUnderlyingBalance.sub(delta);
        expect(underlyingBalance).to.eq(expectedUnderlyingBalance);

        const expectedWrappedBalance = previousWrappedBalance.add(delta).sub(ONE); // 1 wei rounding loss
        expect(wrappedBalance).to.eq(expectedWrappedBalance);
      });

      describe("when the underlying token is WETH", async () => {
        beforeEach(async () => {
          subjectUnderlyingToken = tokenAddresses.weth;
          subjectWrappedToken = tokenAddresses.cWETHv3;
          subjectUnderlyingUnits = ether(1);
          subjectIntegrationName = wethCompoundV3WrapAdapterIntegrationName;
        });

        it("should reduce the underlying quantity and mint the wrapped asset to the SetToken", async () => {
          const previousUnderlyingBalance = await weth_erc20.balanceOf(setToken.address);
          const previousWrappedBalance = await cWETHv3.balanceOf(setToken.address);

          await subject();

          const underlyingBalance = await weth_erc20.balanceOf(setToken.address);
          const wrappedBalance = await cWETHv3.balanceOf(setToken.address);

          const delta = preciseMul(setTokensIssued, subjectUnderlyingUnits);

          const expectedUnderlyingBalance = previousUnderlyingBalance.sub(delta);
          expect(underlyingBalance).to.eq(expectedUnderlyingBalance);

          const expectedWrappedBalance = previousWrappedBalance.add(delta).sub(TWO); // 2 wei rounding loss
          expect(wrappedBalance).to.gte(expectedWrappedBalance);
        });
      });
    });

    describe("#unwrap", () => {
      let subjectSetToken: Address;
      let subjectUnderlyingToken: Address;
      let subjectWrappedToken: Address;
      let subjectWrappedTokenUnits: BigNumber;
      let subjectIntegrationName: string;
      let subjectCaller: Account;
      let subjectUnwrapData: string;

      let wrappedQuantity: BigNumber;

      beforeEach(async () => {
        subjectSetToken = setToken.address;
        subjectUnderlyingToken = tokenAddresses.usdc;
        subjectWrappedToken = tokenAddresses.cUSDCv3;
        subjectWrappedTokenUnits = usdc(50);
        subjectIntegrationName = usdcCompoundV3WrapAdapterIntegrationName;
        subjectUnwrapData = ZERO_BYTES;
        subjectCaller = owner;

        wrappedQuantity = usdc(100);

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
          subjectUnwrapData
        );
      }

      it("should burn the wrapped asset to the SetToken and increase the underlying quantity", async () => {
        const previousUnderlyingBalance = await usdc_erc20.balanceOf(setToken.address);
        const previousWrappedBalance = await cUSDCv3.balanceOf(setToken.address);

        await subject();

        const underlyingBalance = await usdc_erc20.balanceOf(setToken.address);
        const wrappedBalance = await cUSDCv3.balanceOf(setToken.address);

        const delta = preciseMul(setTokensIssued, wrappedQuantity.sub(subjectWrappedTokenUnits));

        const expectedUnderlyingBalance = previousUnderlyingBalance.add(delta);
        expect(underlyingBalance).to.gte(expectedUnderlyingBalance);

        const expectedWrappedBalance = previousWrappedBalance.sub(delta);
        expect(wrappedBalance).to.gte(expectedWrappedBalance);
      });

      it("should revoke the unwrapping spender allowance", async () => {
        await subject();

        const allowance = await cUSDCv3.allowance(setToken.address, cUSDCv3.address);

        expect(allowance).to.eq(ZERO);
      });

      describe("when the underlying token is WETH", async () => {
        beforeEach(async () => {
          subjectSetToken = setToken.address;
          subjectUnderlyingToken = tokenAddresses.weth;
          subjectWrappedToken = tokenAddresses.cWETHv3;
          subjectWrappedTokenUnits = ether(0.5);
          subjectIntegrationName = wethCompoundV3WrapAdapterIntegrationName;
          subjectUnwrapData = ZERO_BYTES;
          subjectCaller = owner;

          wrappedQuantity = ether(1);

          await wrapModule.wrap(
            subjectSetToken,
            subjectUnderlyingToken,
            subjectWrappedToken,
            wrappedQuantity,
            subjectIntegrationName,
            ZERO_BYTES
          );
        });

        it("should reduce the underlying quantity and mint the wrapped asset to the SetToken", async () => {
          const previousUnderlyingBalance = await weth_erc20.balanceOf(setToken.address);
          const previousWrappedBalance = await cWETHv3.balanceOf(setToken.address);

          await subject();

          const underlyingBalance = await weth_erc20.balanceOf(setToken.address);
          const wrappedBalance = await cWETHv3.balanceOf(setToken.address);

          const delta = preciseMul(setTokensIssued, wrappedQuantity.sub(subjectWrappedTokenUnits));

          const expectedUnderlyingBalance = previousUnderlyingBalance.add(delta);
          expect(underlyingBalance).to.gte(expectedUnderlyingBalance);

          const expectedWrappedBalance = previousWrappedBalance.sub(delta);
          expect(wrappedBalance).to.gte(expectedWrappedBalance);
        });
      });
    });
  });
});
