import "module-alias/register";

import { BigNumber } from "ethers";
import { Address, Bytes } from "@utils/types";
import { Account } from "@utils/test/types";
import {
  EMPTY_BYTES,
  ZERO,
} from "@utils/constants";
import { ERC4626ExchangeAdapter, ERC4626Mock, StandardTokenMock } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  ether,
} from "@utils/index";
import {
  addSnapshotBeforeRestoreAfterEach,
  getAccounts,
  getRandomAddress,
  getSystemFixture,
  getWaffleExpect,
} from "@utils/test/index";

import { SystemFixture } from "@utils/fixtures";

const expect = getWaffleExpect();

describe("ERC4626ExchangeAdapter", () => {
  let owner: Account;
  let mockSetToken: Account;
  let deployer: DeployHelper;

  let setV2Setup: SystemFixture;

  let underlyingToken: StandardTokenMock;
  let vault: ERC4626Mock;

  let erc4626ExchangeAdapter: ERC4626ExchangeAdapter;

  before(async () => {
    [
      owner,
      mockSetToken,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);

    setV2Setup = getSystemFixture(owner.address);

    await setV2Setup.initialize();

    underlyingToken = setV2Setup.dai;
    vault = await deployer.mocks.deployERC4626Mock("maDAI", "maDAI", setV2Setup.dai.address);

    erc4626ExchangeAdapter = await deployer.adapters.deployERC4626ExchangeAdapter(vault.address);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("constructor", async () => {
    let subjectVault: Address;

    beforeEach(async () => {
      subjectVault = vault.address;
    });

    async function subject(): Promise<any> {
      return await deployer.adapters.deployERC4626ExchangeAdapter(subjectVault);
    }

    it("should have the correct vault address", async () => {
      const deployedErc4626ExchangeAdapter = await subject();

      const actualVaultAddress = await deployedErc4626ExchangeAdapter.vault();
      expect(actualVaultAddress).to.eq(vault.address);
    });
  });

  describe("getSpender", async () => {
    async function subject(): Promise<any> {
      return await erc4626ExchangeAdapter.getSpender();
    }

    it("should return the correct spender address", async () => {
      const spender = await subject();

      expect(spender).to.eq(vault.address);
    });
  });

  describe("getTradeCalldata", async () => {
    let subjectSourceToken: Address;
    let subjectDestinationToken: Address;
    let subjectDestinationAddress: Address;
    let subjectSourceQuantity: BigNumber;
    let subjectMinDestinationQuantity: BigNumber;
    let subjectData: Bytes;

    beforeEach(async () => {
      subjectSourceToken = underlyingToken.address;
      subjectDestinationToken = vault.address;
      subjectDestinationAddress = mockSetToken.address;
      subjectSourceQuantity = ether(1);
      subjectMinDestinationQuantity = ether(1);
      subjectData = EMPTY_BYTES;
    });

    async function subject(): Promise<any> {
      return await erc4626ExchangeAdapter.getTradeCalldata(
        subjectSourceToken,
        subjectDestinationToken,
        subjectDestinationAddress,
        subjectSourceQuantity,
        subjectMinDestinationQuantity,
        subjectData,
      );
    }

    it("should return the correct deposit calldata", async () => {
      const calldata = await subject();
      const expectedCallData = vault.interface.encodeFunctionData("deposit", [
        subjectSourceQuantity,
        subjectDestinationAddress,
      ]);
      expect(JSON.stringify(calldata)).to.eq(JSON.stringify([vault.address, ZERO, expectedCallData]));
    });

    describe("when the sourceToken is the vault and the destinationToken is the underlying", async () => {
      beforeEach(async () => {
        subjectSourceToken = vault.address;
        subjectDestinationToken = underlyingToken.address;
      });

      it("should return the correct redeem calldata", async () => {
        const calldata = await subject();
        const expectedCallData = vault.interface.encodeFunctionData("redeem", [
          subjectSourceQuantity,
          subjectDestinationAddress,
          subjectDestinationAddress,
        ]);
        expect(JSON.stringify(calldata)).to.eq(JSON.stringify([vault.address, ZERO, expectedCallData]));
      });
    });

    describe("when the sourceToken is neither the underlying nor the vault", async () => {
      beforeEach(async () => {
        subjectSourceToken = await getRandomAddress();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Invalid source token");
      });
    });

    describe("when the sourceToken is the underlying but the destinationToken is not the vault", async () => {
      beforeEach(async () => {
        subjectSourceToken = underlyingToken.address;
        subjectDestinationToken = await getRandomAddress();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Invalid destination token");
      });
    });

    describe("when the sourceToken is the vault but the destinationToken is not the underlying", async () => {
      beforeEach(async () => {
        subjectSourceToken = vault.address;
        subjectDestinationToken = await getRandomAddress();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Invalid destination token");
      });
    });
  });
});
