import "module-alias/register";
import { BigNumber } from "ethers";

import { Account } from "@utils/test/types";
import { PreciseUnitOracle } from "@utils/contracts";
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

describe("PreciseUnitOracle", () => {
  let owner: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let preciseUnitOracle: PreciseUnitOracle;

  before(async () => {
    [
      owner,
    ] = await getAccounts();

    // System setup
    deployer = new DeployHelper(owner.wallet);
    setup = getSystemFixture(owner.address);
    await setup.initialize();

    preciseUnitOracle = await deployer.oracles.deployPreciseUnitOracle("aUSDC-USDC Oracle");
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#constructor", async () => {
    let subjectDataDescription: string;

    before(async () => {
      subjectDataDescription = "aUSDC-USDC Oracle";
    });

    async function subject(): Promise<PreciseUnitOracle> {
      return deployer.oracles.deployPreciseUnitOracle(subjectDataDescription);
    }

    it("sets the correct data description", async () => {
      const preciseUnitOracle = await subject();
      const actualDataDescription = await preciseUnitOracle.dataDescription();
      expect(actualDataDescription).to.eq(subjectDataDescription);
    });
  });


  describe("#read", async () => {
    async function subject(): Promise<BigNumber> {
      return preciseUnitOracle.read();
    }

    it("returns the correct vault value", async () => {
      const result = await subject();
      expect(result).to.eq(ether(1));
    });
  });
});
