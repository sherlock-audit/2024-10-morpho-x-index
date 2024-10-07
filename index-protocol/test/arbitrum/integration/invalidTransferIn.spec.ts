import "module-alias/register";

import { BigNumber, utils } from "ethers";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { cacheBeforeEach, getAccounts } from "@utils/test/index";
import { getWaffleExpect, impersonateAccount } from "@utils/test/testingUtils";

import { DebtIssuanceModuleV2 } from "@typechain/DebtIssuanceModuleV2";
import { DebtIssuanceModuleV2__factory } from "@typechain/factories/DebtIssuanceModuleV2__factory";
import { DebtIssuanceModuleV3 } from "@typechain/DebtIssuanceModuleV3";
import { DebtIssuanceModuleV3__factory } from "@typechain/factories/DebtIssuanceModuleV3__factory";
import { IERC20 } from "@typechain/IERC20";
import { IERC20__factory } from "@typechain/factories/IERC20__factory";
import { Controller } from "@typechain/Controller";
import { Controller__factory } from "@typechain/factories/Controller__factory";
import { SetToken } from "@typechain/SetToken";
import { SetToken__factory } from "@typechain/factories/SetToken__factory";
import { time, setBalance } from "@nomicfoundation/hardhat-network-helpers";

const expect = getWaffleExpect();

describe("Reproducing issuance failure for leveraged tokens on arbitrum [ @forked-arbitrum ]", () => {
  const tokenTransferBuffer = 1;
  let owner: Account;
  let manager: Account;
  const debtIssuanceModuleAddress = "0x120d2f26B7ffd35a8917415A5766Fa63B2af94aa";
  const aaveLeverageModuleAddress = "0x6D1b74e18064172D028C5EE7Af5D0ccC26f2A4Ae";
  let debtIssuanceModuleV2: DebtIssuanceModuleV2;
  let debtIssuanceModuleV3: DebtIssuanceModuleV3;

  const aWETHAddress = "0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8";
  let aWETH: IERC20;
  const aWETHWhaleAddress = "0xb7fb2b774eb5e2dad9c060fb367acbdc7fa7099b";

  // const usdcAddress = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";
  // let usdc: IERC20;
  // const usdcWhaleAddress = "0xB38e8c17e38363aF6EbdCb3dAE12e0243582891D";

  const controllerAddress = "0xCd79A0B9aeca0eCE7eA59d14338ea330cb1cb2d7";
  let controller: Controller;

  const supplyCapIssuanceHookAddress = "0xe44C15131b6B93d6940C578b17A1ff3aC9AA2321";
  const mintFee = utils.parseEther("0.001"); // 0.1% mint fee
  const maxFee = utils.parseEther("0.05"); // 0.1% mint fee
  const redeemFee = utils.parseEther("0.001"); // 0.1% mint fee

  const setTokenAddress = "0x67d2373f0321Cd24a1b58e3c81fC1b6Ef15B205C"; // ETH2X
  let setToken: SetToken;

  let subjectSetToken: Address;
  let subjectCaller: Account;
  let subjectQuantity: BigNumber;
  let subjectTo: Address;

  cacheBeforeEach(async () => {
    [owner, manager] = await getAccounts();
    controller = Controller__factory.connect(controllerAddress, owner.wallet);
    const controllerOwner = await controller.owner();
    const controllerOwnerSigner = await impersonateAccount(controllerOwner);
    await setBalance(controllerOwner, utils.parseEther("1"));
    controller = controller.connect(controllerOwnerSigner);
    const aWethWhaleSigner = await impersonateAccount(aWETHWhaleAddress);
    aWETH = IERC20__factory.connect(aWETHAddress, owner.wallet);
    const aWETHToTransfer = utils.parseEther("10");
    await aWETH.connect(aWethWhaleSigner).transfer(owner.address, aWETHToTransfer);
    // usdc = IERC20__factory.connect(usdcAddress, owner.wallet);
    setToken = SetToken__factory.connect(setTokenAddress, owner.wallet);
    const totalSupply = await setToken.totalSupply();
    console.log("set token total supply", totalSupply.toString());

    debtIssuanceModuleV2 = DebtIssuanceModuleV2__factory.connect(
      debtIssuanceModuleAddress,
      owner.wallet,
    );
    await aWETH.approve(debtIssuanceModuleV2.address, aWETHToTransfer);

    console.log("Deploying DIMV3");
    const debtIssuanceV3ModuleFactory = new DebtIssuanceModuleV3__factory(owner.wallet);
    debtIssuanceModuleV3 = await debtIssuanceV3ModuleFactory.deploy(
      controllerAddress,
      tokenTransferBuffer,
    );
    await controller.addModule(debtIssuanceModuleV3.address);
    const setTokenManager = await setToken.manager();
    const managerSigner = await impersonateAccount(setTokenManager);
    await setBalance(setTokenManager, utils.parseEther("1"));
    await setToken.connect(managerSigner).addModule(debtIssuanceModuleV3.address);

    console.log("Initializing DIMV3");
    await debtIssuanceModuleV3
      .connect(managerSigner)
      .initialize(
        setToken.address,
        maxFee,
        mintFee,
        redeemFee,
        manager.address,
        supplyCapIssuanceHookAddress,
      );
    await aWETH.approve(debtIssuanceModuleV3.address, aWETHToTransfer);
    const almSigner = await impersonateAccount(aaveLeverageModuleAddress);
    await setBalance(aaveLeverageModuleAddress, utils.parseEther("1"));
    console.log("Connecting ALM to DIMV3");
    await debtIssuanceModuleV3.connect(almSigner).registerToIssuanceModule(setToken.address);

    subjectSetToken = setTokenAddress;
    subjectCaller = owner;
    subjectQuantity = utils.parseEther("1");
    subjectTo = subjectCaller.address;
  });

  // Cherry-picked timestamps for which V2.issue will fail due to rounding error in aToken transfer
  [0].forEach((_, i) => {
    context(`when timestamp offset is ${i}`, async () => {
      beforeEach(async () => {
        const newTimestamp = Math.floor(new Date("2024-04-23T07:30:00.000Z").getTime() / 1000);
        await time.setNextBlockTimestamp(newTimestamp + i);
        await aWETH.transfer(setToken.address, 1);
      });
      describe("#DebtIssuanceModuleV2.issue", async () => {
        async function subject(): Promise<any> {
          return debtIssuanceModuleV2
            .connect(subjectCaller.wallet)
            .issue(subjectSetToken, subjectQuantity, subjectTo);
        }

        it("reverts", async () => {
          await expect(subject()).to.be.revertedWith(
            "Invalid transfer in. Results in undercollateralization",
          );
        });
      });

      describe("#DebtIssuanceModuleV3.issue", async () => {
        async function subject(): Promise<any> {
          return debtIssuanceModuleV3
            .connect(subjectCaller.wallet)
            .issue(subjectSetToken, subjectQuantity, subjectTo);
        }

        it("does not revert", async () => {
          await subject();
        });
      });
    });
  });
});
