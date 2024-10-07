import "module-alias/register";
import { Address } from "@utils/types";
import { Account } from "@utils/test/types";
import {
  CustomOracleNavIssuanceModule,
  CustomSetValuerMock,
  DebtIssuanceMock,
  RebasingComponentModule,
  SetToken,
} from "@utils/contracts";
import DeployHelper from "@utils/deploys";
import {
  cacheBeforeEach,
  getAccounts,
  getWaffleExpect,
  getSystemFixture,
  getRandomAccount,
  getRandomAddress,
} from "@utils/test/index";
import { SystemFixture } from "@utils/fixtures";
import { bitcoin, ether, usdc } from "@utils/index";
import { ADDRESS_ZERO, ZERO } from "@utils/constants";
import { BigNumber } from "ethers";

const expect = getWaffleExpect();

describe("RebasingComponentModule", () => {
  let owner: Account;
  let mockModule: Account;
  let feeRecipient: Account;
  let recipient: Account;
  let deployer: DeployHelper;
  let setup: SystemFixture;

  let rebasingComponentModule: RebasingComponentModule;

  let debtIssuanceMock: DebtIssuanceMock;
  let navIssuanceModule: CustomOracleNavIssuanceModule;
  let setToken: SetToken;
  let setValuer: CustomSetValuerMock;

  cacheBeforeEach(async () => {
    [
      owner,
      mockModule,
      feeRecipient,
      recipient,
    ] = await getAccounts();

    deployer = new DeployHelper(owner.wallet);

    setup = getSystemFixture(owner.address);
    await setup.initialize();

    debtIssuanceMock = await deployer.mocks.deployDebtIssuanceMock();
    await setup.controller.addModule(debtIssuanceMock.address);

    navIssuanceModule = await deployer.modules.deployCustomOracleNavIssuanceModule(
      setup.controller.address,
      setup.weth.address
    );
    await setup.controller.addModule(navIssuanceModule.address);

    rebasingComponentModule = await deployer.modules.deployRebasingComponentModule(setup.controller.address);
    await setup.controller.addModule(rebasingComponentModule.address);

    setToken = await setup.createSetToken(
      [setup.weth.address],
      [ether(1)],
      [navIssuanceModule.address, setup.issuanceModule.address, rebasingComponentModule.address]
    );

    setValuer = await deployer.mocks.deployCustomSetValuerMock();

    const navIssuanceSettings = {
      managerIssuanceHook: rebasingComponentModule.address,
      managerRedemptionHook: rebasingComponentModule.address,
      setValuer: setValuer.address,
      reserveAssets: [setup.usdc.address, setup.weth.address],
      feeRecipient: feeRecipient.address,
      managerFees: [ether(0.001), ether(0.002)],
      maxManagerFee: ether(0.02),
      premiumPercentage: ether(0.01),
      maxPremiumPercentage: ether(0.1),
      minSetTokenSupply: ether(100),
    } as CustomOracleNAVIssuanceSettings;

    await navIssuanceModule.initialize(
      setToken.address,
      navIssuanceSettings
    );

    await setup.weth.approve(setup.issuanceModule.address, ether(100));
    await setup.issuanceModule.initialize(setToken.address, ADDRESS_ZERO);
    await setup.issuanceModule.issue(setToken.address, ether(1), owner.address);
  });

  describe("#constructor", async () => {
    let subjectController: Address;

    beforeEach(async () => {
      subjectController = setup.controller.address;
    });

    async function subject(): Promise<RebasingComponentModule> {
      return deployer.modules.deployRebasingComponentModule(subjectController);
    }

    it("should set the correct controller", async () => {
      const aaveLeverageModule = await subject();

      const controller = await aaveLeverageModule.controller();
      expect(controller).to.eq(subjectController);
    });
  });

  describe("#initialize", async () => {
    let setToken: SetToken;
    let subjectSetToken: Address;
    let subjectRebasingComponents: Address[];
    let subjectCaller: Account;

    const initializeContracts = async () => {
      setToken = await setup.createSetToken(
        [setup.weth.address, setup.dai.address],
        [ether(1), ether(100)],
        [rebasingComponentModule.address, debtIssuanceMock.address]
      );
      await debtIssuanceMock.initialize(setToken.address);
    };

    const initializeSubjectVariables = () => {
      subjectSetToken = setToken.address;
      subjectRebasingComponents = [setup.weth.address, setup.dai.address];
      subjectCaller = owner;
    };

    async function subject(): Promise<any> {
      return rebasingComponentModule.connect(subjectCaller.wallet).initialize(
        subjectSetToken,
        subjectRebasingComponents
      );
    }

    cacheBeforeEach(initializeContracts);
    beforeEach(initializeSubjectVariables);

    it("should enable the Module on the SetToken", async () => {
      await subject();
      const isModuleEnabled = await setToken.isInitializedModule(rebasingComponentModule.address);
      expect(isModuleEnabled).to.eq(true);
    });

    it("should set the rebasing component settings and mappings", async () => {
      await subject();

      const rebasingComponents = await rebasingComponentModule.getRebasingComponents(setToken.address);
      const components = rebasingComponents;

      const isWethRebasingComponent = await rebasingComponentModule.rebasingComponentEnabled(setToken.address, setup.weth.address);
      const isDaiRebasingComponent = await rebasingComponentModule.rebasingComponentEnabled(setToken.address, setup.dai.address);

      expect(JSON.stringify(components)).to.eq(JSON.stringify(subjectRebasingComponents));
      expect(isWethRebasingComponent).to.be.true;
      expect(isDaiRebasingComponent).to.be.true;
    });

    it("should register on the debt issuance module", async () => {
      await subject();
      const isRegistered = await debtIssuanceMock.isRegistered(setToken.address);
      expect(isRegistered).to.be.true;
    });

    describe("when the caller is not the SetToken manager", async () => {
      beforeEach(async () => {
        subjectCaller = await getRandomAccount();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be the SetToken manager");
      });
    });

    describe("when SetToken is not in pending state", async () => {
      beforeEach(async () => {
        const newModule = await getRandomAddress();
        await setup.controller.addModule(newModule);

        const rebasingComponentModuleNotPendingSetToken = await setup.createSetToken(
          [setup.weth.address],
          [ether(1)],
          [newModule]
        );

        subjectSetToken = rebasingComponentModuleNotPendingSetToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be pending initialization");
      });
    });

    describe("when the SetToken is not enabled on the controller", async () => {
      beforeEach(async () => {
        const nonEnabledSetToken = await setup.createNonControllerEnabledSetToken(
          [setup.weth.address],
          [ether(1)],
          [rebasingComponentModule.address]
        );

        subjectSetToken = nonEnabledSetToken.address;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be controller-enabled SetToken");
      });
    });
  });

  describe("#sync", async () => {
    let setToken: SetToken;
    let isInitialized: boolean;

    let subjectSetToken: Address;
    let subjectCaller: Account;

    const initializeSubjectVariables = async () => {
      subjectSetToken = setToken.address;
      subjectCaller = await getRandomAccount();
    };

    async function subject(): Promise<any> {
      return rebasingComponentModule.connect(subjectCaller.wallet).sync(subjectSetToken);
    }

    context("when WETH and DAI are rebasing collateral", async () => {
      const initializeContracts = async () => {
        setToken = await setup.createSetToken(
          [setup.weth.address, setup.dai.address],
          [ether(2), ether(1000)],
          [rebasingComponentModule.address, debtIssuanceMock.address, setup.issuanceModule.address]
        );
        await debtIssuanceMock.initialize(setToken.address);

        // Initialize module if set to true
        if (isInitialized) {
          await rebasingComponentModule.initialize(
            setToken.address,
            [setup.weth.address, setup.dai.address, setup.wbtc.address]
          );
        }
        await setup.issuanceModule.initialize(setToken.address, ADDRESS_ZERO);

        await setup.weth.approve(setup.issuanceModule.address, ether(1000));
        await setup.dai.approve(setup.issuanceModule.address, ether(10000));
        const issueQuantity = ether(1);
        await setup.issuanceModule.issue(setToken.address, issueQuantity, owner.address);
      };

      describe("when module is initialized", async () => {
        before(async () => {
          isInitialized = true;
        });

        cacheBeforeEach(initializeContracts);
        beforeEach(initializeSubjectVariables);

        it("should update the rebasing component positions on the SetToken correctly", async () => {
          const initialPositions = await setToken.getPositions();

          // Send units to SetToken to simulate rebasing
          await setup.weth.transfer(setToken.address, ether(1));
          await setup.dai.transfer(setToken.address, ether(100));
          await subject();

          const currentPositions = await setToken.getPositions();
          const newFirstPosition = (await setToken.getPositions())[0];
          const newSecondPosition = (await setToken.getPositions())[1];

          const expectedFirstPositionUnit = await setup.weth.balanceOf(setToken.address);  // need not divide as total supply is 1.
          const expectedSecondPositionUnit = await setup.dai.balanceOf(setToken.address);

          expect(initialPositions.length).to.eq(2);
          expect(currentPositions.length).to.eq(2);
          expect(newFirstPosition.component).to.eq(setup.weth.address);
          expect(newFirstPosition.positionState).to.eq(0); // Default
          expect(newFirstPosition.unit).to.eq(expectedFirstPositionUnit);
          expect(newFirstPosition.module).to.eq(ADDRESS_ZERO);

          expect(newSecondPosition.component).to.eq(setup.dai.address);
          expect(newSecondPosition.positionState).to.eq(0); // Default
          expect(newSecondPosition.unit).to.eq(expectedSecondPositionUnit);
          expect(newSecondPosition.module).to.eq(ADDRESS_ZERO);
        });

        describe("when SetToken is not valid", async () => {
          beforeEach(async () => {
            const nonEnabledSetToken = await setup.createNonControllerEnabledSetToken(
              [setup.weth.address],
              [ether(1)],
              [rebasingComponentModule.address],
              owner.address
            );

            subjectSetToken = nonEnabledSetToken.address;
          });

          it("should revert", async () => {
            await expect(subject()).to.be.revertedWith("Must be a valid and initialized SetToken");
          });
        });
      });

      describe("when module is not initialized", async () => {
        beforeEach(() => {
          isInitialized = false;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized SetToken");
        });
      });
    });

    describe("when set token total supply is 0", async () => {
      const initializeContracts = async () => {
        setToken = await setup.createSetToken(
          [setup.weth.address, setup.dai.address],
          [ether(2), ether(1000)],
          [rebasingComponentModule.address, debtIssuanceMock.address, setup.issuanceModule.address]
        );
        await debtIssuanceMock.initialize(setToken.address);

        // Initialize module if set to true
        await rebasingComponentModule.initialize(
          setToken.address,
          [setup.weth.address, setup.dai.address]
        );
      };

      beforeEach(async () => {
        await initializeContracts();
        await initializeSubjectVariables();
      });

      it("should preserve default positions", async () => {
        const initialPositions = await setToken.getPositions();

        // Send units to SetToken to simulate rebasing
        await setup.weth.transfer(setToken.address, ether(1));
        await setup.dai.transfer(setToken.address, ether(100));
        await subject();

        const currentPositions = await setToken.getPositions();

        expect(currentPositions.length).to.eq(2);
        expect(initialPositions.length).to.eq(2);

        expect(currentPositions[0].component).to.eq(setup.weth.address);
        expect(currentPositions[0].positionState).to.eq(0);
        expect(currentPositions[0].unit).to.eq(initialPositions[0].unit);
        expect(currentPositions[0].module).to.eq(ADDRESS_ZERO);

        expect(currentPositions[1].component).to.eq(setup.dai.address);
        expect(currentPositions[1].positionState).to.eq(0);
        expect(currentPositions[1].unit).to.eq(initialPositions[1].unit);
        expect(currentPositions[1].module).to.eq(ADDRESS_ZERO);
      });
    });
  });

  describe("#addRebasingComponents", async () => {
    let setToken: SetToken;
    let isInitialized: boolean;

    let subjectSetToken: Address;
    let subjectRebasingComponents: Address[];
    let subjectCaller: Account;

    const initializeContracts = async () => {
      setToken = await setup.createSetToken(
        [setup.weth.address],
        [ether(1)],
        [rebasingComponentModule.address, debtIssuanceMock.address, setup.issuanceModule.address]
      );
      await debtIssuanceMock.initialize(setToken.address);
      // Initialize module if set to true
      if (isInitialized) {
        await rebasingComponentModule.initialize(
          setToken.address,
          [setup.weth.address],
        );
      }
    };

    const initializeSubjectVariables = () => {
      subjectSetToken = setToken.address;
      subjectRebasingComponents = [setup.dai.address];
      subjectCaller = owner;
    };

    async function subject(): Promise<any> {
      return rebasingComponentModule.connect(subjectCaller.wallet).addRebasingComponents(
        subjectSetToken,
        subjectRebasingComponents,
      );
    }

    describe("when module is initialized", () => {
      beforeEach(() => {
        isInitialized = true;
      });

      cacheBeforeEach(initializeContracts);
      beforeEach(initializeSubjectVariables);

      it("should add the rebasing component to mappings", async () => {
        await subject();
        const rebasingComponents = await rebasingComponentModule.getRebasingComponents(setToken.address);
        const isDaiRebasingComponent = await rebasingComponentModule.rebasingComponentEnabled(setToken.address, setup.dai.address);

        expect(JSON.stringify(rebasingComponents)).to.eq(JSON.stringify([setup.weth.address, setup.dai.address]));
        expect(isDaiRebasingComponent).to.be.true;
      });

      it("should emit the correct RebasingComponentsUpdated event", async () => {
        await expect(subject()).to.emit(rebasingComponentModule, "RebasingComponentsUpdated").withArgs(
          subjectSetToken,
          true,
          subjectRebasingComponents,
        );
      });

      describe("when rebasing component is duplicated", async () => {
        beforeEach(async () => {
          subjectRebasingComponents = [setup.weth.address, setup.weth.address];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Rebasing component already enabled");
        });
      });

      describe("when the caller is not the SetToken manager", async () => {
        beforeEach(async () => {
          subjectCaller = await getRandomAccount();
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be the SetToken manager");
        });
      });
    });

    describe("when module is not initialized", async () => {
      beforeEach(async () => {
        isInitialized = false;
        await initializeContracts();
        initializeSubjectVariables();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized SetToken");
      });
    });
  });

  describe("#registerToModule", async () => {
    let setToken: SetToken;
    let otherIssuanceModule: DebtIssuanceMock;
    let isInitialized: boolean;
    let subjectSetToken: Address;
    let subjectDebtIssuanceModule: Address;

    const initializeContracts = async function () {
      otherIssuanceModule = await deployer.mocks.deployDebtIssuanceMock();
      await setup.controller.addModule(otherIssuanceModule.address);

      setToken = await setup.createSetToken(
        [setup.weth.address],
        [ether(100)],
        [rebasingComponentModule.address, setup.issuanceModule.address, debtIssuanceMock.address]
      );
      await debtIssuanceMock.initialize(setToken.address);
      // Initialize module if set to true
      if (isInitialized) {
        await rebasingComponentModule.initialize(
          setToken.address,
          [setup.weth.address, setup.dai.address, setup.wbtc.address]
        );
      }
      await setup.issuanceModule.initialize(setToken.address, ADDRESS_ZERO);
      // Add other issuance mock after initializing rebasing component module, so register is never called
      await setToken.addModule(otherIssuanceModule.address);
      await otherIssuanceModule.initialize(setToken.address);
    };

    const initializeSubjectVariables = () => {
      subjectSetToken = setToken.address;
      subjectDebtIssuanceModule = otherIssuanceModule.address;
    };

    async function subject(): Promise<any> {
      return rebasingComponentModule.registerToModule(subjectSetToken, subjectDebtIssuanceModule);
    }

    describe("when module is initialized", () => {
      beforeEach(() => {
        isInitialized = true;
      });

      cacheBeforeEach(initializeContracts);
      beforeEach(initializeSubjectVariables);

      it("should register on the other issuance module", async () => {
        const previousIsRegistered = await otherIssuanceModule.isRegistered(setToken.address);
        await subject();
        const currentIsRegistered = await otherIssuanceModule.isRegistered(setToken.address);
        expect(previousIsRegistered).to.be.false;
        expect(currentIsRegistered).to.be.true;
      });

      describe("when SetToken is not valid", async () => {
        beforeEach(async () => {
          const nonEnabledSetToken = await setup.createNonControllerEnabledSetToken(
            [setup.weth.address],
            [ether(1)],
            [rebasingComponentModule.address],
            owner.address
          );

          subjectSetToken = nonEnabledSetToken.address;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be a valid and initialized SetToken");
        });
      });

      describe("when debt issuance module is not initialized on SetToken", async () => {
        beforeEach(async () => {
          await setToken.removeModule(otherIssuanceModule.address);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Issuance not initialized");
        });
      });
    });

    describe("when module is not initialized", async () => {
      beforeEach(async () => {
        isInitialized = false;
        await initializeContracts();
        initializeSubjectVariables();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized SetToken");
      });
    });
  });

  describe("#moduleIssueHook", async () => {
    let setToken: SetToken;
    let isInitialized: boolean;

    let subjectSetToken: Address;
    let subjectCaller: Account;

    context("when WETH and DAI are rebasing components", async () => {
      before(async () => {
        isInitialized = true;
      });

      cacheBeforeEach(async () => {
        // Add mock module to controller
        await setup.controller.addModule(mockModule.address);

        setToken = await setup.createSetToken(
          [setup.weth.address, setup.dai.address],
          [ether(10), ether(5000)],
          [rebasingComponentModule.address, setup.issuanceModule.address, debtIssuanceMock.address]
        );
        await debtIssuanceMock.initialize(setToken.address);
        // Initialize module if set to true
        if (isInitialized) {
          await rebasingComponentModule.initialize(
            setToken.address,
            [setup.weth.address, setup.dai.address, setup.wbtc.address]
          );
        }
        await setup.issuanceModule.initialize(setToken.address, ADDRESS_ZERO);
        // Initialize mock module
        await setToken.addModule(mockModule.address);
        await setToken.connect(mockModule.wallet).initializeModule();

        await setup.weth.approve(setup.issuanceModule.address, ether(10));
        await setup.dai.approve(setup.issuanceModule.address, ether(10000));
        const issueQuantity = ether(1);
        await setup.issuanceModule.issue(setToken.address, issueQuantity, owner.address);
      });

      beforeEach(() => {
        subjectSetToken = setToken.address;
        subjectCaller = mockModule;
      });

      async function subject(): Promise<any> {
        return rebasingComponentModule.connect(subjectCaller.wallet).moduleIssueHook(subjectSetToken, ZERO);
      }

      it("should update the rebasing component positions on the SetToken correctly", async () => {
        const initialPositions = await setToken.getPositions();

        // Send units to SetToken to simulate rebasing
        await setup.weth.transfer(setToken.address, ether(1));
        await setup.dai.transfer(setToken.address, ether(100));
        await subject();

        const currentPositions = await setToken.getPositions();
        const newFirstPosition = (await setToken.getPositions())[0];
        const newSecondPosition = (await setToken.getPositions())[1];

        const expectedFirstPositionUnit = await setup.weth.balanceOf(setToken.address);    // need not divide, since total Supply = 1
        const expectedSecondPositionUnit = await setup.dai.balanceOf(setToken.address);

        expect(initialPositions.length).to.eq(2);
        expect(currentPositions.length).to.eq(2);

        expect(newFirstPosition.component).to.eq(setup.weth.address);
        expect(newFirstPosition.positionState).to.eq(0); // Default
        expect(newFirstPosition.unit).to.eq(expectedFirstPositionUnit);
        expect(newFirstPosition.module).to.eq(ADDRESS_ZERO);

        expect(newSecondPosition.component).to.eq(setup.dai.address);
        expect(newSecondPosition.positionState).to.eq(0); // Default
        expect(newSecondPosition.unit).to.eq(expectedSecondPositionUnit);
        expect(newSecondPosition.module).to.eq(ADDRESS_ZERO);
      });

      describe("when caller is not module", async () => {
        beforeEach(async () => {
          subjectCaller = owner;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Only the module can call");
        });
      });

      describe("if disabled module is caller", async () => {
        beforeEach(async () => {
          await setup.controller.removeModule(mockModule.address);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Module must be enabled on controller");
        });
      });
    });
  });

  describe("#moduleRedeemHook", async () => {
    let setToken: SetToken;
    let isInitialized: boolean;

    let subjectSetToken: Address;
    let subjectCaller: Account;

    context("when WETH and DAI are rebasing components", async () => {
      before(async () => {
        isInitialized = true;
      });

      cacheBeforeEach(async () => {
        // Add mock module to controller
        await setup.controller.addModule(mockModule.address);

        setToken = await setup.createSetToken(
          [setup.weth.address, setup.dai.address],
          [ether(10), ether(5000)],
          [rebasingComponentModule.address, setup.issuanceModule.address, debtIssuanceMock.address]
        );
        await debtIssuanceMock.initialize(setToken.address);
        // Initialize module if set to true
        if (isInitialized) {
          await rebasingComponentModule.initialize(
            setToken.address,
            [setup.weth.address, setup.dai.address, setup.wbtc.address]
          );
        }
        await setup.issuanceModule.initialize(setToken.address, ADDRESS_ZERO);
        // Initialize mock module
        await setToken.addModule(mockModule.address);
        await setToken.connect(mockModule.wallet).initializeModule();

        await setup.weth.approve(setup.issuanceModule.address, ether(10));
        await setup.dai.approve(setup.issuanceModule.address, ether(10000));
        const issueQuantity = ether(1);
        await setup.issuanceModule.issue(setToken.address, issueQuantity, owner.address);
      });

      beforeEach(() => {
        subjectSetToken = setToken.address;
        subjectCaller = mockModule;
      });

      async function subject(): Promise<any> {
        return rebasingComponentModule.connect(subjectCaller.wallet).moduleRedeemHook(subjectSetToken, ZERO);
      }

      it("should update the rebasing component positions on the SetToken correctly", async () => {
        const initialPositions = await setToken.getPositions();

        // Send units to SetToken to simulate rebasing
        await setup.weth.transfer(setToken.address, ether(1));
        await setup.dai.transfer(setToken.address, ether(100));
        await subject();

        const currentPositions = await setToken.getPositions();
        const newFirstPosition = (await setToken.getPositions())[0];
        const newSecondPosition = (await setToken.getPositions())[1];

        const expectedFirstPositionUnit = await setup.weth.balanceOf(setToken.address);    // need not divide, since total Supply = 1
        const expectedSecondPositionUnit = await setup.dai.balanceOf(setToken.address);

        expect(initialPositions.length).to.eq(2);
        expect(currentPositions.length).to.eq(2);

        expect(newFirstPosition.component).to.eq(setup.weth.address);
        expect(newFirstPosition.positionState).to.eq(0); // Default
        expect(newFirstPosition.unit).to.eq(expectedFirstPositionUnit);
        expect(newFirstPosition.module).to.eq(ADDRESS_ZERO);

        expect(newSecondPosition.component).to.eq(setup.dai.address);
        expect(newSecondPosition.positionState).to.eq(0); // Default
        expect(newSecondPosition.unit).to.eq(expectedSecondPositionUnit);
        expect(newSecondPosition.module).to.eq(ADDRESS_ZERO);
      });

      describe("when caller is not module", async () => {
        beforeEach(async () => {
          subjectCaller = owner;
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Only the module can call");
        });
      });

      describe("if disabled module is caller", async () => {
        beforeEach(async () => {
          await setup.controller.removeModule(mockModule.address);
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Module must be enabled on controller");
        });
      });
    });
  });

  describe("#componentIssueHook", async () => {
    let setToken: SetToken;
    let isInitialized: boolean;

    let subjectSetToken: Address;
    let subjectSetQuantity: BigNumber;
    let subjectComponent: Address;
    let subjectIsEquity: boolean;
    let subjectCaller: Account;
    let issueQuantity: BigNumber;

    before(async () => {
      isInitialized = true;
    });

    cacheBeforeEach(async () => {
      // Add mock module to controller
      await setup.controller.addModule(mockModule.address);

      setToken = await setup.createSetToken(
        [setup.weth.address],
        [ether(2)],
        [rebasingComponentModule.address, setup.issuanceModule.address, debtIssuanceMock.address]
      );
      await debtIssuanceMock.initialize(setToken.address);
      // Initialize module if set to true
      if (isInitialized) {
        await rebasingComponentModule.initialize(
          setToken.address,
          [setup.weth.address, setup.dai.address, setup.wbtc.address]
        );
      }
      await setup.issuanceModule.initialize(setToken.address, ADDRESS_ZERO);
      // Initialize mock module
      await setToken.addModule(mockModule.address);
      await setToken.connect(mockModule.wallet).initializeModule();

      // Approve tokens to issuance module and call issue
      await setup.weth.connect(owner.wallet).approve(setup.issuanceModule.address, ether(100));
      issueQuantity = ether(1);
      await setup.issuanceModule.issue(setToken.address, issueQuantity, owner.address);
    });

    beforeEach(() => {
      subjectSetToken = setToken.address;
      subjectSetQuantity = issueQuantity;
      subjectComponent = setup.dai.address;
      subjectIsEquity = true;
      subjectCaller = mockModule;
    });

    async function subject(): Promise<any> {
      return rebasingComponentModule.connect(subjectCaller.wallet).componentIssueHook(
        subjectSetToken,
        subjectSetQuantity,
        subjectComponent,
        subjectIsEquity
      );
    }

    it("should not revert", async () => {
      await expect(subject()).to.not.be.reverted;
    });

    describe("when caller is not module", async () => {
      beforeEach(async () => {
        subjectCaller = owner;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Only the module can call");
      });
    });

    describe("if disabled module is caller", async () => {
      beforeEach(async () => {
        await setup.controller.removeModule(mockModule.address);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Module must be enabled on controller");
      });
    });
  });

  describe("#componentRedeemHook", async () => {
    let setToken: SetToken;
    let isInitialized: boolean;

    let subjectSetToken: Address;
    let subjectSetQuantity: BigNumber;
    let subjectComponent: Address;
    let subjectIsEquity: boolean;
    let subjectCaller: Account;
    let issueQuantity: BigNumber;

    before(async () => {
      isInitialized = true;
    });

    cacheBeforeEach(async () => {
      // Add mock module to controller
      await setup.controller.addModule(mockModule.address);

      setToken = await setup.createSetToken(
        [setup.weth.address],
        [ether(2)],
        [rebasingComponentModule.address, setup.issuanceModule.address, debtIssuanceMock.address]
      );
      await debtIssuanceMock.initialize(setToken.address);
      // Initialize module if set to true
      if (isInitialized) {
        await rebasingComponentModule.initialize(
          setToken.address,
          [setup.weth.address, setup.wbtc.address]
        );
      }
      await setup.issuanceModule.initialize(setToken.address, ADDRESS_ZERO);
      // Initialize mock module
      await setToken.addModule(mockModule.address);
      await setToken.connect(mockModule.wallet).initializeModule();

      await setup.weth.connect(owner.wallet).approve(setup.issuanceModule.address, ether(100));
      issueQuantity = ether(1);
      await setup.issuanceModule.issue(setToken.address, issueQuantity, owner.address);
    });

    beforeEach(() => {
      subjectSetToken = setToken.address;
      subjectSetQuantity = issueQuantity;
      subjectComponent = setup.dai.address;
      subjectIsEquity = true;
      subjectCaller = mockModule;
    });

    async function subject(): Promise<any> {
      return rebasingComponentModule.connect(subjectCaller.wallet).componentRedeemHook(
        subjectSetToken,
        subjectSetQuantity,
        subjectComponent,
        subjectIsEquity
      );
    }

    it("should not revert", async () => {
      await expect(subject()).to.not.be.reverted;
    });

    describe("when caller is not module", async () => {
      beforeEach(async () => {
        subjectCaller = owner;
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Only the module can call");
      });
    });

    describe("if disabled module is caller", async () => {
      beforeEach(async () => {
        await setup.controller.removeModule(mockModule.address);
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Module must be enabled on controller");
      });
    });
  });

  describe("#removeModule", async () => {
    let setToken: SetToken;
    let subjectModule: Address;

    cacheBeforeEach(async () => {
      setToken = await setup.createSetToken(
        [setup.weth.address],
        [ether(100)],
        [rebasingComponentModule.address, debtIssuanceMock.address, setup.issuanceModule.address]
      );
      await debtIssuanceMock.initialize(setToken.address);
      await rebasingComponentModule.initialize(
        setToken.address,
        [setup.weth.address]
      );
      await setup.issuanceModule.initialize(setToken.address, ADDRESS_ZERO);

      await setup.weth.approve(setup.issuanceModule.address, ether(1000));
      await setup.issuanceModule.issue(setToken.address, ether(1), owner.address);
    });

    beforeEach(() => {
      subjectModule = rebasingComponentModule.address;
    });

    async function subject(): Promise<any> {
      return setToken.removeModule(subjectModule);
    }

    describe("When an EOA is registered as a module", () => {
      cacheBeforeEach(async () => {
        await setup.controller
          .addModule(owner.address);
        await setToken
          .addModule(owner.address);
        await setToken.connect(owner.wallet).initializeModule();
      });
      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("function call to a non-contract account");
      });
    });

    it("should remove the Module on the SetToken", async () => {
      await subject();
      const isModuleEnabled = await setToken.isInitializedModule(rebasingComponentModule.address);
      expect(isModuleEnabled).to.be.false;
    });

    it("should delete the mappings", async () => {
      await subject();
      const rebasingComponents = await rebasingComponentModule.getRebasingComponents(setToken.address);
      const isWethRebasingComponent = await rebasingComponentModule.rebasingComponentEnabled(setToken.address, setup.weth.address);
      const isDaiRebasingComponent = await rebasingComponentModule.rebasingComponentEnabled(setToken.address, setup.weth.address);

      expect(rebasingComponents.length).to.eq(0);
      expect(isWethRebasingComponent).to.be.false;
      expect(isDaiRebasingComponent).to.be.false;
    });

    it("should unregister on the debt issuance module", async () => {
      await subject();
      const isRegistered = await debtIssuanceMock.isRegistered(setToken.address);
      expect(isRegistered).to.be.false;
    });
  });

  describe("#removeRebasingComponents", async () => {
    let setToken: SetToken;
    let isInitialized: boolean;

    let subjectSetToken: Address;
    let subjectRebasingComponents: Address[];
    let subjectCaller: Account;

    const initializeContracts = async () => {
      setToken = await setup.createSetToken(
        [setup.weth.address],
        [ether(1)],
        [rebasingComponentModule.address, debtIssuanceMock.address, setup.issuanceModule.address]
      );
      await debtIssuanceMock.initialize(setToken.address);
      // Initialize module if set to true
      if (isInitialized) {
        await rebasingComponentModule.initialize(
          setToken.address,
          [setup.weth.address, setup.dai.address],
        );
      }
    };

    const initializeSubjectVariables = () => {
      subjectSetToken = setToken.address;
      subjectRebasingComponents = [setup.dai.address];
      subjectCaller = owner;
    };

    async function subject(): Promise<any> {
      return await rebasingComponentModule.connect(subjectCaller.wallet).removeRebasingComponents(
        subjectSetToken,
        subjectRebasingComponents,
      );
    }

    describe("when module is initialized", () => {
      before(async () => {
        isInitialized = true;
      });

      cacheBeforeEach(initializeContracts);
      beforeEach(initializeSubjectVariables);

      it("should remove the rebasing component from mappings", async () => {
        await subject();
        const rebasingComponents = await rebasingComponentModule.getRebasingComponents(setToken.address);
        const isDaiRebasingComponent = await rebasingComponentModule.rebasingComponentEnabled(setToken.address, setup.dai.address);
        expect(JSON.stringify(rebasingComponents)).to.eq(JSON.stringify([setup.weth.address]));
        expect(isDaiRebasingComponent).to.be.false;
      });

      it("should emit the correct RebasingComponentsUpdated event", async () => {
        await expect(subject()).to.emit(rebasingComponentModule, "RebasingComponentsUpdated").withArgs(
          subjectSetToken,
          false,
          subjectRebasingComponents,
        );
      });

      describe("when rebasing component is not enabled on module", async () => {
        beforeEach(async () => {
          subjectRebasingComponents = [setup.weth.address, setup.usdc.address];
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Rebasing component not enabled");
        });
      });

      describe("when the caller is not the SetToken manager", async () => {
        beforeEach(async () => {
          subjectCaller = await getRandomAccount();
        });

        it("should revert", async () => {
          await expect(subject()).to.be.revertedWith("Must be the SetToken manager");
        });
      });
    });

    describe("when module is not initialized", async () => {
      beforeEach(async () => {
        isInitialized = false;
        await initializeContracts();
        initializeSubjectVariables();
      });

      it("should revert", async () => {
        await expect(subject()).to.be.revertedWith("Must be a valid and initialized SetToken");
      });
    });
  });

  describe("#invokePreIssueHook", async () => {
    let subjectSetToken: Address;
    let subjectReserveAsset: Address;
    let subjectReserveQuantity: BigNumber;
    let subjectMinSetTokenReceived: BigNumber;
    let subjectTo: Account;

    beforeEach(async () => {
      await rebasingComponentModule.initialize(
        setToken.address,
        [setup.weth.address, setup.wbtc.address],
      );

      await setup.issuanceModule.issue(setToken.address, ether(99), owner.address);

      subjectSetToken = setToken.address;
      subjectReserveAsset = setup.usdc.address;
      subjectReserveQuantity = usdc(100000);
      subjectMinSetTokenReceived = ZERO;
      subjectTo = recipient;

      await setup.usdc.approve(navIssuanceModule.address, subjectReserveQuantity);
    });

    async function subject(): Promise<any> {
      return navIssuanceModule.issue(
        subjectSetToken,
        subjectReserveAsset,
        subjectReserveQuantity,
        subjectMinSetTokenReceived,
        subjectTo.address
      );
    }

    it("should sync rebasing components", async () => {
      const initialPositions = await setToken.getPositions();
      const initialFirstPosition = (await setToken.getPositions())[0];

      // Send units to SetToken to simulate rebasing
      await setup.wbtc.transfer(setToken.address, bitcoin(100));
      await subject();

      const currentPositions = await setToken.getPositions();
      const newFirstPosition = (await setToken.getPositions())[0];
      const newSecondPosition = (await setToken.getPositions())[1];
      const newThirdPosition = (await setToken.getPositions())[2];

      expect(initialPositions.length).to.eq(1);
      expect(currentPositions.length).to.eq(3);

      expect(newFirstPosition.component).to.eq(setup.weth.address);
      expect(newFirstPosition.positionState).to.eq(0); // Default
      expect(newFirstPosition.unit).to.lt(initialFirstPosition.unit);
      expect(newFirstPosition.module).to.eq(ADDRESS_ZERO);

      expect(newSecondPosition.component).to.eq(setup.wbtc.address);
      expect(newSecondPosition.positionState).to.eq(0); // Default
      expect(newSecondPosition.unit).to.gt(ZERO);
      expect(newSecondPosition.module).to.eq(ADDRESS_ZERO);

      expect(newThirdPosition.component).to.eq(setup.usdc.address);
      expect(newThirdPosition.positionState).to.eq(0); // Default
      expect(newThirdPosition.unit).to.gt(ZERO);
      expect(newThirdPosition.module).to.eq(ADDRESS_ZERO);
    });
  });

  describe("#invokePreRedeemHook", async () => {
    let subjectSetToken: Address;
    let subjectReserveAsset: Address;
    let subjectSetTokenQuantity: BigNumber;
    let subjectMinReserveQuantityReceived: BigNumber;
    let subjectTo: Account;

    beforeEach(async () => {
      await rebasingComponentModule.initialize(
        setToken.address,
        [setup.weth.address, setup.wbtc.address],
      );

      await setup.issuanceModule.issue(setToken.address, ether(99), owner.address);

      await setup.usdc.approve(navIssuanceModule.address, usdc(100000));
      await navIssuanceModule.issue(
        setToken.address,
        setup.usdc.address,
        usdc(100000),
        ZERO,
        owner.address
      );

      subjectSetToken = setToken.address;
      subjectReserveAsset = setup.usdc.address;
      subjectSetTokenQuantity = ether(400);
      subjectMinReserveQuantityReceived = ZERO;
      subjectTo = recipient;
    });

    async function subject(): Promise<any> {
      return navIssuanceModule.redeem(
        subjectSetToken,
        subjectReserveAsset,
        subjectSetTokenQuantity,
        subjectMinReserveQuantityReceived,
        subjectTo.address
      );
    }

    it("should sync rebasing components", async () => {
      const initialPositions = await setToken.getPositions();
      const initialFirstPosition = (await setToken.getPositions())[0];
      const initialSecondPosition = (await setToken.getPositions())[1];

      // Send units to SetToken to simulate rebasing
      await setup.wbtc.transfer(setToken.address, bitcoin(100));

      await subject();

      const currentPositions = await setToken.getPositions();
      const newFirstPosition = (await setToken.getPositions())[0];
      const newSecondPosition = (await setToken.getPositions())[1];
      const newThirdPosition = (await setToken.getPositions())[2];

      expect(initialPositions.length).to.eq(2);
      expect(currentPositions.length).to.eq(3);

      expect(newFirstPosition.component).to.eq(setup.weth.address);
      expect(newFirstPosition.positionState).to.eq(0); // Default
      expect(newFirstPosition.unit).to.gt(initialFirstPosition.unit);
      expect(newFirstPosition.module).to.eq(ADDRESS_ZERO);

      expect(newSecondPosition.component).to.eq(setup.usdc.address);
      expect(newSecondPosition.positionState).to.eq(0); // Default
      expect(newSecondPosition.unit).to.gt(initialSecondPosition.unit);
      expect(newSecondPosition.module).to.eq(ADDRESS_ZERO);

      expect(newThirdPosition.component).to.eq(setup.wbtc.address);
      expect(newThirdPosition.positionState).to.eq(0); // Default
      expect(newThirdPosition.unit).to.gt(ZERO);
      expect(newThirdPosition.module).to.eq(ADDRESS_ZERO);
    });
  });
});
