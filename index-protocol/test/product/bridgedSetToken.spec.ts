import "module-alias/register";
import { Account } from "@utils/test/types";
import { BridgedSetToken } from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  addSnapshotBeforeRestoreAfterEach,
  getAccounts,
  getWaffleExpect,
} from "@utils/test/index";

const expect = getWaffleExpect();

describe("BridgedSetToken", () => {
  let owner: Account;
  let deployer: DeployHelper;

  let bridgedSetToken: BridgedSetToken;

  const name: string = "Bridged Set Token";
  const symbol: string = "BST";

  before(async () => {
    [owner] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);

    bridgedSetToken = await deployer.product.deployBridgedSetToken(name, symbol);
  });

  addSnapshotBeforeRestoreAfterEach();

  describe("#constructor", async () => {
    it("should set the correct state variables", async () => {
      expect(await bridgedSetToken.name()).to.eq(name);
      expect(await bridgedSetToken.symbol()).to.eq(symbol);
      expect(await bridgedSetToken.decimals()).to.eq(18);
      expect(await bridgedSetToken.maxSupply()).to.eq(0);
    });
  });
});
