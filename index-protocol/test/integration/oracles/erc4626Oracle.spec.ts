import "module-alias/register";
import { BigNumber } from "ethers";

import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import { ERC4626ConverterMock, ERC4626Oracle } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import { ether } from "@utils/index";
import {
  getAccounts,
  getWaffleExpect,
  getSystemFixture,
  addSnapshotBeforeRestoreAfterEach,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

describe("ERC4626Oracle", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let usdcLowDecimalVault: ERC4626ConverterMock;
  let usdcHighDecimalVault: ERC4626ConverterMock;
  let daiVault: ERC4626ConverterMock;

  let erc4626UsdcLowDecimalOracle: ERC4626Oracle;
  let erc4626UsdcHighDecimalOracle: ERC4626Oracle;
  let erc4626DaiOracle: ERC4626Oracle;

  let price: BigNumber;

  before(async () => {
    [
      owner,
    ] = await getAccounts();

    // System setup
    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    price = ether(1.02);

    usdcLowDecimalVault = await deployer.mocks.deployERC4626ConverterMock(setup.usdc.address, 6, price);
    usdcHighDecimalVault = await deployer.mocks.deployERC4626ConverterMock(setup.usdc.address, 18, price);
    daiVault = await deployer.mocks.deployERC4626ConverterMock(setup.dai.address, 18, price);

    erc4626UsdcLowDecimalOracle = await deployer.oracles.deployERC4626Oracle(
      usdcLowDecimalVault.address,
      "usdcLowDecimalVault-usdc Oracle"
    );
    erc4626UsdcHighDecimalOracle = await deployer.oracles.deployERC4626Oracle(
      usdcHighDecimalVault.address,
      "usdcHighDecimalVault-usdc Oracle"
    );
    erc4626DaiOracle = await deployer.oracles.deployERC4626Oracle(
      daiVault.address,
      "daiVault-dai Oracle"
    );
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#constructor", async () => {
    let subjectVaultAddress: Address;
    let subjectDataDescription: string;

    before(async () => {
      subjectVaultAddress = daiVault.address;
      subjectDataDescription = "daiVault-dai Oracle";
    });

    async function subject(): Promise<ERC4626Oracle> {
      return deployer.oracles.deployERC4626Oracle(
        subjectVaultAddress,
        subjectDataDescription
      );
    }

    it("sets the correct vault address", async () => {
      const oracle = await subject();
      const vaultAddress = await oracle.vault();
      expect(vaultAddress).to.equal(subjectVaultAddress);
    });


    it("sets the correct full units", async () => {
      const oracle = await subject();
      const underlyingFullUnit = await oracle.underlyingFullUnit();
      const vaultFullUnit = await oracle.vaultFullUnit();
      expect(underlyingFullUnit).to.eq(ether(1));
      expect(vaultFullUnit).to.eq(ether(1));
    });

    it("sets the correct data description", async () => {
      const oracle = await subject();
      const actualDataDescription = await oracle.dataDescription();
      expect(actualDataDescription).to.eq(subjectDataDescription);
    });
  });


  describe("#read", async () => {
    let subjectOracle: ERC4626Oracle;

    before(async () => {
      subjectOracle = erc4626DaiOracle;
    });

    async function subject(): Promise<BigNumber> {
      return subjectOracle.read();
    }

    it("returns the correct value", async () => {
      const result = await subject();
      expect(result).to.eq(price);
    });

    describe("when the vault has higher decimals than the underlying", async () => {
      beforeEach(async () => {
        subjectOracle = erc4626UsdcHighDecimalOracle;
      });

      it("returns the correct value", async () => {
        const result = await subject();
        expect(result).to.eq(price);
      });
    });

    describe("when the vault and the underlying have decimals below 18", async () => {
      beforeEach(async () => {
        subjectOracle = erc4626UsdcLowDecimalOracle;
      });

      it("returns the correct value", async () => {
        const result = await subject();
        expect(result).to.eq(price);
      });
    });
  });
});
