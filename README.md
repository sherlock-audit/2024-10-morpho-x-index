
# Morpho x Index contest details

- Join [Sherlock Discord](https://discord.gg/MABEWyASkp)
- Submit findings using the issue page in your private contest repo (label issues as med or high)
- [Read for more details](https://docs.sherlock.xyz/audits/watsons)

# Q&A

### Q: On what chains are the smart contracts going to be deployed?
Any EVM compatible network where Morpho is also deployed (currently Ethereum and Base)

___

### Q: If you are integrating tokens, are you allowing only whitelisted tokens to work with the codebase or any complying with the standard? Are they assumed to have certain properties, e.g. be non-reentrant? Are there any types of [weird tokens](https://github.com/d-xo/weird-erc20) you want to integrate?
In theory any ERC20-Token (including USTD and USDC that is compatible with Morpho should also be compatible with this integration. 

Exceptions are tokens that are rebasing or enforce a transfer fee which are generally not supported by Index Protocol.
___

### Q: Are there any limitations on values set by admins (or other roles) in the codebase, including restrictions on array lengths?
Generally the 'Operator' role in the MorphoLeverageStrategyExtension as well as the 'Manager' role in the Leverage Module are trusted and can be assumed not to set any malicious or obviously wrong values on the contract settings. 

(Non complete list of examples):
- Any contract address (i.e. that of the Morpho contract or other Index Modules) will be set to their valid deployments 
- target / min / max  / icentivized leverage ratio will be set to values that are below the liquidation threshold on Morpho
- rebalanceInterval will be set to a reasonable value that allows maintaining a safe leverage ration and protection against liquidation
- slippageTolerance will be set to a reasonable value ( < 1% ) that avoids excessive front running when executing rebalance trades
- overrideNoRebalanceInProgress will generally be set to 'false' and is only meant as a last resort to recover if the contract enters an unexpected state. 

___

### Q: Are there any limitations on values set by admins (or other roles) in protocols you integrate with, including restrictions on array lengths?
No
___

### Q: For permissioned functions, please list all checks and requirements that will be made before calling the function.
- Any of the above mentioned limitations will be checked
- All permissioned functions will be published via mev-protection services and not released to the public mempool

___

### Q: Is the codebase expected to comply with any EIPs? Can there be/are there any deviations from the specification?
No
___

### Q: Are there any off-chain mechanisms for the protocol (keeper bots, arbitrage bots, etc.)? We assume they won't misbehave, delay, or go offline unless specified otherwise.
- Normally 'rebalance' and 'iterateRebalance' will be called by permissioned keeper bots that can be assumed not to misbehave
- However in the future we might adjust the contract settings such that anyone can call these methods (any method with the onlyAllowedCaller modifier), so we would still like to know about any issue that could result in that scenario. 
___

### Q: If the codebase is to be deployed on an L2, what should be the behavior of the protocol in case of sequencer issues (if applicable)? Should Sherlock assume that the Sequencer won't misbehave, including going offline?
Yes, Sherlock can assume that the Sequencer won't misbehaver or go offline. 
___

### Q: What properties/invariants do you want to hold even if breaking them has a low/unknown impact?
- setToken.totalSupply = sum(setToken.balanceOf(holderAddres)) [over all holders]
- The tokens morpho position should not be liquidatable assuming that the `rebalance`  /  `iterateRebalance`  methods are called whenever the `shouldRebalance` method indicates necessity to do that. (and also assuming that liquidity on the respective dex pool does not dry up)
___

### Q: Please discuss any design choices you made.
- We chose to not call `accrueInterest` on morpho in certain places but instead duplicate / copy logic from the Morpho contract such that we calculate the interest that should be added to our morpho borrow balance to reflect the current state of our position. 
- We chose to only support one morpho market per token, even though that might limit the amount of available liquidity
___

### Q: Please list any known issues and explicitly state the acceptable risks for each known issue.
- If the associated morpho market runs out of liquidity (available borrow tokens) then no new tokens can be issued and the token can not be "levered up" if its leverage ratio falls below the target. However redemptions as well as levering down (to avoid liquiditation) should still work.
- If the Dex Pools configured for the trade between collateral and borrow token run out of liquidity then the token can not be levered up or down and might be at risk of liquidation.
- If the Price Oracle (which is the same as configured for the associated Morpho Market) becomes stale or reports inaccurate data then the token might also be unable to mantain he desired leverage ratio. 
- Due to rounding errors when converting between borrow assets / shares from morpho, it is not possible to redeem 100% of a leverage tokens supply (i.e. to the very last wei) once it has been levered up. In itself this has been deemed an acceptable limitation. However potential security issues that result from this limitation would be in scope of this context and should be reported. Also since this only refers to a rounding issue it should always be possible to redeem tokens as long as the total supply after redemption is > 0.001 Tokens (i.e. 1e15 wei). Any scenario in which this assumption is violated might also be an eligible issue. 

___

### Q: We will report issues where the core protocol functionality is inaccessible for at least 7 days. Would you like to override this value?
No i don't want to override this value
___

### Q: Please provide links to previous audits (if any).
- Full list of audits: https://docs.indexcoop.com/index-coop-community-handbook/protocol/security-and-audits#audits
- The most relevant previous audit was the Sherlock Competition on the AaveV3 leverage integration whose contracts served the same basic function as the ones in this contest but for a different underlying money market: https://audits.sherlock.xyz/contests/81
___

### Q: Please list any relevant protocol resources.
- Index Protocol Docs: https://docs.indexcoop.com/index-coop-community-handbook/protocol/index-protocol
- Set Protocol Docs (of which Index Protocol is a fork): https://docs.tokensets.com/
- Morpho Docs: https://docs.morpho.org/morpho/overview
___



# Audit scope


[index-coop-smart-contracts @ 7202ed7d335c107d51efa5c081fcd68517c310d5](https://github.com/IndexCoop/index-coop-smart-contracts/tree/7202ed7d335c107d51efa5c081fcd68517c310d5)
- [index-coop-smart-contracts/contracts/adapters/MorphoLeverageStrategyExtension.sol](index-coop-smart-contracts/contracts/adapters/MorphoLeverageStrategyExtension.sol)

[index-protocol @ d219221ca97536d74b53b06c2b063ebe3d878b9f](https://github.com/IndexCoop/index-protocol/tree/d219221ca97536d74b53b06c2b063ebe3d878b9f)
- [index-protocol/contracts/protocol/integration/lib/Morpho.sol](index-protocol/contracts/protocol/integration/lib/Morpho.sol)
- [index-protocol/contracts/protocol/integration/lib/MorphoBalancesLib.sol](index-protocol/contracts/protocol/integration/lib/MorphoBalancesLib.sol)
- [index-protocol/contracts/protocol/integration/lib/MorphoMarketParams.sol](index-protocol/contracts/protocol/integration/lib/MorphoMarketParams.sol)
- [index-protocol/contracts/protocol/integration/lib/MorphoSharesMath.sol](index-protocol/contracts/protocol/integration/lib/MorphoSharesMath.sol)
- [index-protocol/contracts/protocol/modules/v1/MorphoLeverageModule.sol](index-protocol/contracts/protocol/modules/v1/MorphoLeverageModule.sol)




[index-coop-smart-contracts @ 7202ed7d335c107d51efa5c081fcd68517c310d5](https://github.com/IndexCoop/index-coop-smart-contracts/tree/7202ed7d335c107d51efa5c081fcd68517c310d5)
- [index-coop-smart-contracts/contracts/adapters/MorphoLeverageStrategyExtension.sol](index-coop-smart-contracts/contracts/adapters/MorphoLeverageStrategyExtension.sol)


