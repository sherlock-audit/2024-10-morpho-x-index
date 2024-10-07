import "module-alias/register";

import { BigNumber } from "ethers";
import { Address, Bytes } from "@utils/types";
import { Account } from "@utils/test/types";
import { ERC4626ExchangeAdapter, IERC20, IERC20__factory } from "@typechain/index";
import {
  SetToken,
  TradeModule,
} from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
  usdc,
} from "@utils/index";
import {
  getAccounts,
  getSystemFixture,
  getWaffleExpect,
} from "@utils/test/index";

import { SystemFixture } from "@utils/fixtures";
import { MAX_UINT_256, ZERO, ZERO_BYTES } from "@utils/constants";
import { impersonateAccount } from "@utils/test/testingUtils";
import { forkingConfig } from "../../../hardhat.config";
import { network } from "hardhat";

const expect = getWaffleExpect();

describe("ERC4626ExchangeAdapter TradeModule Integration [ @forked-mainnet ]", () => {
  const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
  const fUsdcAddress = "0x9Fb7b4477576Fe5B32be4C1843aFB1e55F251B33";

  let owner: Account;
  let manager: Account;

  let deployer: DeployHelper;

  let usdcErc20: IERC20;
  let fUsdc: IERC20;

  let erc4626ExchangeAdapter: ERC4626ExchangeAdapter;
  let erc4626ExchangeAdapterName: string;

  let setup: SystemFixture;
  let tradeModule: TradeModule;

  let setToken: SetToken;

  const blockNumber = 20528609;
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
      manager,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    usdcErc20 = IERC20__factory.connect(usdcAddress, owner.wallet);
    fUsdc = IERC20__factory.connect(fUsdcAddress, owner.wallet);

    erc4626ExchangeAdapter = await deployer.adapters.deployERC4626ExchangeAdapter(fUsdcAddress);
    erc4626ExchangeAdapterName = "fUSDC_Exchange_Adapter";

    tradeModule = await deployer.modules.deployTradeModule(setup.controller.address);
    await setup.controller.addModule(tradeModule.address);

    await setup.integrationRegistry.addIntegration(
      tradeModule.address,
      erc4626ExchangeAdapterName,
      erc4626ExchangeAdapter.address
    );

    setToken = await setup.createSetToken(
      [usdcAddress],
      [usdc(1)],
      [setup.issuanceModule.address, tradeModule.address],
      manager.address
    );

    await tradeModule.connect(manager.wallet).initialize(setToken.address);

    const mockPreIssuanceHook = await deployer.mocks.deployManagerIssuanceHookMock();
    await setup.issuanceModule.connect(manager.wallet).initialize(setToken.address, mockPreIssuanceHook.address);

    const issueQuantity = ether(5);
    const usdcWhale = "0x075e72a5eDf65F0A5f44699c7654C1a76941Ddc8";
    const usdcWhaleAccount = await impersonateAccount(usdcWhale);
    await usdcErc20.connect(usdcWhaleAccount).approve(setup.issuanceModule.address, MAX_UINT_256);
    await setup.issuanceModule.connect(usdcWhaleAccount).issue(setToken.address, issueQuantity, owner.address);
  });

  describe("#trade", function() {
    context("when trading the underlying for a ERC-4626 component", async () => {
      let subjectDestinationToken: Address;
      let subjectSourceToken: Address;
      let subjectSourceQuantity: BigNumber;
      let subjectAdapterName: string;
      let subjectSetToken: Address;
      let subjectMinDestinationQuantity: BigNumber;
      let subjectData: Bytes;
      let subjectCaller: Account;

      beforeEach(async () => {
        subjectSetToken = setToken.address;
        subjectSourceToken = usdcAddress;
        subjectDestinationToken = fUsdcAddress;
        subjectSourceQuantity = usdc(0.5);
        subjectMinDestinationQuantity = usdc(0.4);
        subjectAdapterName = erc4626ExchangeAdapterName;
        subjectData = ZERO_BYTES;
        subjectCaller = manager;
      });

      async function subject(): Promise<any> {
        tradeModule = tradeModule.connect(subjectCaller.wallet);
        return tradeModule.trade(
          subjectSetToken,
          subjectAdapterName,
          subjectSourceToken,
          subjectSourceQuantity,
          subjectDestinationToken,
          subjectMinDestinationQuantity,
          subjectData
        );
      }

      it("should transfer the correct components to and from the SetToken", async () => {
        const beforeUnderlyingBalance = await usdcErc20.balanceOf(subjectSetToken);
        const beforeVaultBalance = await fUsdc.balanceOf(subjectSetToken);
        expect(beforeUnderlyingBalance).to.eq(usdc(5));
        expect(beforeVaultBalance).to.eq(ZERO);

        await subject();

        const afterUnderlyingBalance = await usdcErc20.balanceOf(subjectSetToken);
        const afterVaultBalance = await fUsdc.balanceOf(subjectSetToken);
        expect(afterUnderlyingBalance).to.eq(usdc(2.5));
        expect(afterVaultBalance).to.be.gt(usdc(2.3));
      });
    });

    context("when trading the ERC-4626 component for a underlying", async () => {
      let subjectDestinationToken: Address;
      let subjectSourceToken: Address;
      let subjectSourceQuantity: BigNumber;
      let subjectAdapterName: string;
      let subjectSetToken: Address;
      let subjectMinDestinationQuantity: BigNumber;
      let subjectData: Bytes;
      let subjectCaller: Account;

      beforeEach(async () => {
        subjectSetToken = setToken.address;
        subjectSourceToken = fUsdcAddress;
        subjectDestinationToken = usdcAddress;
        subjectSourceQuantity = usdc(0.4);
        subjectMinDestinationQuantity = usdc(0.41);
        subjectAdapterName = erc4626ExchangeAdapterName;
        subjectData = ZERO_BYTES;
        subjectCaller = manager;
      });

      async function subject(): Promise<any> {
        tradeModule = tradeModule.connect(subjectCaller.wallet);
        return tradeModule.trade(
          subjectSetToken,
          subjectAdapterName,
          subjectSourceToken,
          subjectSourceQuantity,
          subjectDestinationToken,
          subjectMinDestinationQuantity,
          subjectData
        );
      }

      it("should transfer the correct components to and from the SetToken", async () => {
        const beforeSourceTokenBalance = await fUsdc.balanceOf(subjectSetToken);
        const beforeDestinationTokenBalance = await usdcErc20.balanceOf(subjectSetToken);
        expect(beforeSourceTokenBalance).to.gt(usdc(2.3));
        expect(beforeDestinationTokenBalance).to.eq(usdc(2.5));

        await subject();

        const afterSourceTokenBalance = await fUsdc.balanceOf(subjectSetToken);
        const afterDestinationTokenBalance = await usdcErc20.balanceOf(subjectSetToken);
        expect(afterSourceTokenBalance).to.be.lt(usdc(0.35));
        expect(afterDestinationTokenBalance).to.be.gt(usdc(4.6));
      });
    });
  });
});
