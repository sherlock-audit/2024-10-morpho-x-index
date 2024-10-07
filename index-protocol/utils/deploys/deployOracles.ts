import { Signer } from "ethers";
import { Address } from "../types";
import { BigNumber } from "ethers";

import { CTokenOracle, ERC4626Oracle, PreciseUnitOracle, YearnVaultOracle } from "../contracts";

import { CTokenOracle__factory } from "../../typechain/factories/CTokenOracle__factory";
import { ERC4626Oracle__factory } from "../../typechain/factories/ERC4626Oracle__factory";
import { PreciseUnitOracle__factory } from "../../typechain/factories/PreciseUnitOracle__factory";
import { YearnVaultOracle__factory } from "../../typechain/factories/YearnVaultOracle__factory";

export default class DeployOracles {
  private _deployerSigner: Signer;

  constructor(deployerSigner: Signer) {
    this._deployerSigner = deployerSigner;
  }

  public async deployCTokenOracle(
    cToken: Address,
    underlyingOracle: Address,
    cTokenFullUnit: BigNumber,
    underlyingFullUnit: BigNumber,
    dataDescription: string): Promise<CTokenOracle> {
    return await new CTokenOracle__factory(this._deployerSigner)
      .deploy(cToken, underlyingOracle, cTokenFullUnit, underlyingFullUnit, dataDescription);
  }

  public async deployYearnVaultOracle(
    vault: Address,
    underlyingOracle: Address,
    underlyingFullUnit: BigNumber,
    dataDescription: string): Promise<YearnVaultOracle> {
    return await new YearnVaultOracle__factory(this._deployerSigner).deploy(vault, underlyingOracle, underlyingFullUnit, dataDescription);
  }

  public async deployERC4626Oracle(
    vault: Address,
    dataDescription: string): Promise<ERC4626Oracle> {
    return await new ERC4626Oracle__factory(this._deployerSigner).deploy(vault, dataDescription);
  }

  public async deployPreciseUnitOracle(
    dataDescription: string): Promise<PreciseUnitOracle> {
    return await new PreciseUnitOracle__factory(this._deployerSigner).deploy(dataDescription);
  }
}
