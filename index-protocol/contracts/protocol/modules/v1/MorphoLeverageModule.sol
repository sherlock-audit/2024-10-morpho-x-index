/*
    Copyright 2024 Index Coop

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

    SPDX-License-Identifier: Apache License, Version 2.0
*/

pragma solidity 0.6.10;
pragma experimental "ABIEncoderV2";

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import { IController } from "../../../interfaces/IController.sol";
import { IDebtIssuanceModule } from "../../../interfaces/IDebtIssuanceModule.sol";
import { IExchangeAdapter } from "../../../interfaces/IExchangeAdapter.sol";
import { IModuleIssuanceHook } from "../../../interfaces/IModuleIssuanceHook.sol";
import { ISetToken } from "../../../interfaces/ISetToken.sol";
import { MarketParams, Market, IMorpho, Position } from "../../../interfaces/external/morpho/IMorpho.sol";
import { Morpho } from "../../../protocol/integration/lib/Morpho.sol";
import { MorphoMarketParams } from "../../../protocol/integration/lib/MorphoMarketParams.sol";
import { MorphoSharesMath } from "../../../protocol/integration/lib/MorphoSharesMath.sol";
import { MorphoBalancesLib } from "../../../protocol/integration/lib/MorphoBalancesLib.sol";
import { ModuleBase } from "../../lib/ModuleBase.sol";

/**
 * @title Morpho Leverage Module
 * @author Index Coop
 * @notice Smart contract that enables leverage trading using Morpho Blue as the lending protocol.
 */
contract MorphoLeverageModule is ModuleBase, ReentrancyGuard, Ownable, IModuleIssuanceHook {
    using Morpho for ISetToken;
    using MorphoMarketParams for MarketParams;
    using MorphoSharesMath for uint128;
    using MorphoBalancesLib for  IMorpho;

    /* ============ Structs ============ */

    struct ActionInfo {
        ISetToken setToken;                      // SetToken instance
        IExchangeAdapter exchangeAdapter;        // Exchange adapter instance
        uint256 setTotalSupply;                  // Total supply of SetToken
        uint256 notionalSendQuantity;            // Total notional quantity sent to exchange
        uint256 minNotionalReceiveQuantity;      // Min total notional received from exchange
        IERC20 collateralAsset;                  // Address of collateral asset
        IERC20 borrowAsset;                      // Address of borrow asset
        uint256 preTradeReceiveTokenBalance;     // Balance of pre-trade receive token balance
    }

    /* ============ Events ============ */

    /**
     * @dev Emitted on lever()
     * @param _setToken             Instance of the SetToken being levered
     * @param _borrowAsset          Asset being borrowed for leverage
     * @param _collateralAsset      Collateral asset being levered
     * @param _exchangeAdapter      Exchange adapter used for trading
     * @param _totalBorrowAmount    Total amount of `_borrowAsset` borrowed
     * @param _totalReceiveAmount   Total amount of `_collateralAsset` received by selling `_borrowAsset`
     * @param _protocolFee          Protocol fee charged
     */
    event LeverageIncreased(
        ISetToken indexed _setToken,
        IERC20 indexed _borrowAsset,
        IERC20 indexed _collateralAsset,
        IExchangeAdapter _exchangeAdapter,
        uint256 _totalBorrowAmount,
        uint256 _totalReceiveAmount,
        uint256 _protocolFee
    );

    /**
     * @dev Emitted on delever() and deleverToZeroBorrowBalance()
     * @param _setToken             Instance of the SetToken being delevered
     * @param _collateralAsset      Asset sold to decrease leverage
     * @param _repayAsset           Asset being bought to repay to Morpho
     * @param _exchangeAdapter      Exchange adapter used for trading
     * @param _totalRedeemAmount    Total amount of `_collateralAsset` being sold
     * @param _totalRepayAmount     Total amount of `_repayAsset` being repaid
     * @param _protocolFee          Protocol fee charged
     */
    event LeverageDecreased(
        ISetToken indexed _setToken,
        IERC20 indexed _collateralAsset,
        IERC20 indexed _repayAsset,
        IExchangeAdapter _exchangeAdapter,
        uint256 _totalRedeemAmount,
        uint256 _totalRepayAmount,
        uint256 _protocolFee
    );

    /**
     * @dev Emitted on updateAllowedSetToken()
     * @param _setToken SetToken being whose allowance to initialize this module is being updated
     * @param _added    true if added false if removed
     */
    event SetTokenStatusUpdated(
        ISetToken indexed _setToken,
        bool indexed _added
    );

    /**
     * @dev Emitted on updateAnySetAllowed()
     * @param _anySetAllowed    true if any set is allowed to initialize this module, false otherwise
     */
    event AnySetAllowedUpdated(
        bool indexed _anySetAllowed
    );

    /**
     * @dev Emitted on updateAnySetAllowed()
     * @param _setToken SetToken whose Morpho Market params are updated
     * @param _marketId Morpho Market Id corresponding to the Market Params that have been set 
     */
    event MorphoMarketUpdated(
        ISetToken indexed _setToken,
        bytes32 _marketId
    );

    /* ============ Constants ============ */


    // String identifying the DebtIssuanceModule in the IntegrationRegistry. Note: Governance must add DefaultIssuanceModule as
    // the string as the integration name
    string constant internal DEFAULT_ISSUANCE_MODULE_NAME = "DefaultIssuanceModule";

    // 0 index stores protocol fee % on the controller, charged in the _executeTrade function
    uint256 constant internal PROTOCOL_TRADE_FEE_INDEX = 0;

    IMorpho public immutable morpho;

    /* ============ State Variables ============ */


    // Mapping of SetToken to Morpho MarketParams defining the market on which to leverage
    mapping(ISetToken => MarketParams) public marketParams;

    // Mapping of SetToken to boolean indicating if SetToken is on allow list. Updateable by governance
    mapping(ISetToken => bool) public allowedSetTokens;

    // Boolean that returns if any SetToken can initialize this module. If false, then subject to allow list. Updateable by governance.
    bool public anySetAllowed;

    /* ============ Constructor ============ */

    /**
     * @dev Set morpho contract address
     * @param _controller                       Address of controller contract
     * @param _morpho                           Address of morpho contract
     */
    constructor(
        IController _controller,
        IMorpho _morpho
    )
        public
        ModuleBase(_controller)
    {
        morpho = _morpho;
    }

    /* ============ External Functions ============ */

    /**
     * @dev MANAGER ONLY: Increases leverage for a given collateral position using an enabled borrow asset.
     * Retrieves borrow / collateral tokens from configured Morpho Market Params
     * Borrows borrow token from Morpho. Performs a DEX trade, exchanging the borrow token for collateral token.
     * Deposits collateral token to Morpho Market
     * Note: Assumes that at the time the function is called, the set has already deposited sufficient collateral tokens in morpho to borrow against
     * @param _setToken                     Instance of the SetToken
     * @param _borrowQuantityUnits          Borrow quantity of asset in position units
     * @param _minReceiveQuantityUnits      Min receive quantity of collateral asset to receive post-trade in position units
     * @param _tradeAdapterName             Name of trade adapter
     * @param _tradeData                    Arbitrary data for trade
     */
    function lever(
        ISetToken _setToken,
        uint256 _borrowQuantityUnits,
        uint256 _minReceiveQuantityUnits,
        string memory _tradeAdapterName,
        bytes memory _tradeData
    )
        external
        nonReentrant
        onlyManagerAndValidSet(_setToken)
    {
        MarketParams memory setMarketParams = marketParams[_setToken]; 
        require(setMarketParams.collateralToken != address(0), "Collateral not set");

        // For levering up, send quantity is derived from borrow asset and receive quantity is derived from
        // collateral asset
        ActionInfo memory leverInfo = _createAndValidateActionInfo(
            _setToken,
            IERC20(setMarketParams.loanToken),
            IERC20(setMarketParams.collateralToken),
            _borrowQuantityUnits,
            _minReceiveQuantityUnits,
            _tradeAdapterName,
            true
        );

        _borrow(leverInfo.setToken, setMarketParams, leverInfo.notionalSendQuantity);

        uint256 postTradeReceiveQuantity = _executeTrade(leverInfo, IERC20(setMarketParams.loanToken), IERC20(setMarketParams.collateralToken), _tradeData);

        uint256 protocolFee = _accrueProtocolFee(_setToken, IERC20(setMarketParams.collateralToken), postTradeReceiveQuantity);

        uint256 postTradeCollateralQuantity = postTradeReceiveQuantity.sub(protocolFee);

        _deposit(leverInfo.setToken, setMarketParams, postTradeCollateralQuantity);

        _sync(leverInfo.setToken);

        emit LeverageIncreased(
            _setToken,
            IERC20(setMarketParams.loanToken),
            IERC20(setMarketParams.collateralToken),
            leverInfo.exchangeAdapter,
            leverInfo.notionalSendQuantity,
            postTradeCollateralQuantity,
            protocolFee
        );
    }

    /**
     * @dev MANAGER ONLY: Decrease leverage for a given collateral position using an enabled borrow asset.
     * Determines collatera / borrow tokens based on configured morpho market params
     * Withdraws collateral token from Morpho Market. Performs a DEX trade, exchanging the collateral token for borrow token
     * Repays borrow token to Morpho
     * @param _setToken                 Instance of the SetToken
     * @param _redeemQuantityUnits      Quantity of collateral asset to delever in position units
     * @param _minRepayQuantityUnits    Minimum amount of repay asset to receive post trade in position units
     * @param _tradeAdapterName         Name of trade adapter
     * @param _tradeData                Arbitrary data for trade
     */
    function delever(
        ISetToken _setToken,
        uint256 _redeemQuantityUnits,
        uint256 _minRepayQuantityUnits,
        string memory _tradeAdapterName,
        bytes memory _tradeData
    )
        external
        nonReentrant
        onlyManagerAndValidSet(_setToken)
    {
        MarketParams memory setMarketParams = marketParams[_setToken]; 
        require(setMarketParams.collateralToken != address(0), "Collateral not set");

        // Note: for delevering, send quantity is derived from collateral asset and receive quantity is derived from
        // repay asset
        ActionInfo memory deleverInfo = _createAndValidateActionInfo(
            _setToken,
            IERC20(setMarketParams.collateralToken),
            IERC20(setMarketParams.loanToken),
            _redeemQuantityUnits,
            _minRepayQuantityUnits,
            _tradeAdapterName,
            false
        );

        _withdraw(deleverInfo.setToken, setMarketParams, deleverInfo.notionalSendQuantity);

        uint256 postTradeReceiveQuantity = _executeTrade(deleverInfo, IERC20(setMarketParams.collateralToken), IERC20(setMarketParams.loanToken), _tradeData);

        uint256 protocolFee = _accrueProtocolFee(_setToken, IERC20(setMarketParams.loanToken), postTradeReceiveQuantity);

        uint256 repayQuantity = postTradeReceiveQuantity.sub(protocolFee);

        _repayBorrow(deleverInfo.setToken, setMarketParams, repayQuantity, 0);

        _updateRepayDefaultPosition(deleverInfo, IERC20(setMarketParams.loanToken));

        uint256 collateralBalance = deleverInfo.collateralAsset.balanceOf(address(deleverInfo.setToken));
        if(collateralBalance > 0) {
            _deposit(_setToken, setMarketParams, collateralBalance);
        }

        _sync(deleverInfo.setToken);

        emit LeverageDecreased(
            _setToken,
            IERC20(setMarketParams.collateralToken),
            IERC20(setMarketParams.loanToken),
            deleverInfo.exchangeAdapter,
            deleverInfo.notionalSendQuantity,
            repayQuantity,
            protocolFee
        );
    }

    /** @dev MANAGER ONLY: Pays down the borrow token to 0 selling off a given amount of collateral asset.
     * Withdraws collateral token from Morpho. Performs a DEX trade, exchanging the collateral Token for borrow Token.
     * Minimum receive amount for the DEX trade is set to the current borrow asset balance on Morpho
     * Repays received borrow tokens to Morpho. Any extra received borrow asset is updated as equity
     * The function reverts if not enough collateral token is redeemed to buy the required minimum amount of borrow tokens.
     * @param _setToken             Instance of the SetToken
     * @param _redeemQuantityUnits  Quantity of collateral asset to delever in position units
     * @param _tradeAdapterName     Name of trade adapter
     * @param _tradeData            Arbitrary data for trade
     * @return uint256              Notional repay quantity
     */
    function deleverToZeroBorrowBalance(
        ISetToken _setToken,
        uint256 _redeemQuantityUnits,
        string memory _tradeAdapterName,
        bytes memory _tradeData
    )
        external
        nonReentrant
        onlyManagerAndValidSet(_setToken)
        returns (uint256)
    {
        MarketParams memory setMarketParams = marketParams[_setToken]; 
        require(setMarketParams.collateralToken != address(0), "Collateral not set");
       
        uint256 setTotalSupply = _setToken.totalSupply();
        uint256 notionalRedeemQuantity = _redeemQuantityUnits.preciseMul(setTotalSupply);
        (,uint256 borrowBalance, uint256 borrowShares) = _getCollateralAndBorrowBalances(_setToken, setMarketParams);

        ActionInfo memory deleverInfo = _createAndValidateActionInfoNotional(
            _setToken,
            IERC20(setMarketParams.collateralToken),
            IERC20(setMarketParams.loanToken),
            notionalRedeemQuantity,
            borrowBalance,
            _tradeAdapterName,
            false,
            setTotalSupply
        );

        _withdraw(deleverInfo.setToken, setMarketParams, deleverInfo.notionalSendQuantity);

        _executeTrade(deleverInfo, IERC20(setMarketParams.collateralToken), IERC20(setMarketParams.loanToken), _tradeData);

        _repayBorrow(deleverInfo.setToken, setMarketParams, borrowBalance, borrowShares);

        _updateRepayDefaultPosition(deleverInfo, IERC20(setMarketParams.loanToken));

        uint256 collateralBalance = deleverInfo.collateralAsset.balanceOf(address(deleverInfo.setToken));
        if(collateralBalance > 0) {
            _deposit(_setToken, setMarketParams, collateralBalance);
        }

       _sync(deleverInfo.setToken);

        emit LeverageDecreased(
            _setToken,
            IERC20(setMarketParams.collateralToken),
            IERC20(setMarketParams.loanToken),
            deleverInfo.exchangeAdapter,
            deleverInfo.notionalSendQuantity,
            borrowBalance,
            0   // No protocol fee
        );

        return borrowBalance;
    }

    /**
     * @dev CALLABLE BY ANYBODY: Sync Set positions with ALL enabled Morpho collateral and borrow positions.
     * @param _setToken               Instance of the SetToken
     */
    function sync(ISetToken _setToken) public nonReentrant onlyValidAndInitializedSet(_setToken) {
        _sync(_setToken);
    }

    function _sync(ISetToken _setToken) internal {
        MarketParams memory setMarketParams = marketParams[_setToken];
        require(setMarketParams.collateralToken != address(0), "Collateral not set");

        uint256 setTotalSupply = _setToken.totalSupply();
        (int256 newCollateralPositionUnit, int256 newBorrowPositionUnit) = _getCollateralAndBorrowPositions(_setToken, setMarketParams, setTotalSupply);

        int256 previousCollateralPositionUnit = _setToken.getExternalPositionRealUnit(setMarketParams.collateralToken, address(this));
        if (previousCollateralPositionUnit != newCollateralPositionUnit) {
            _updateExternalPosition(_setToken, setMarketParams.collateralToken, newCollateralPositionUnit);
        }

        int256 previousBorrowPositionUnit = _setToken.getExternalPositionRealUnit(setMarketParams.loanToken, address(this));
        // Note: Accounts for if borrowPosition does not exist on SetToken but is tracked in enabledAssets
        if (newBorrowPositionUnit != previousBorrowPositionUnit) {
            _updateExternalPosition(_setToken, setMarketParams.loanToken, newBorrowPositionUnit);
        }
    }

    /**
     * @dev MANAGER ONLY: Initializes this module to the SetToken. Either the SetToken needs to be on the allowed list
     * or anySetAllowed needs to be true. Only callable by the SetToken's manager.
     * Note: Managers can enable collateral and borrow assets that don't exist as positions on the SetToken
     * @param _setToken             Instance of the SetToken to initialize
     * @param _marketParams         Parameters defining the Morpho market to use for leveraging
     */
    function initialize(
        ISetToken _setToken,
        MarketParams memory _marketParams
    )
        external
        onlySetManager(_setToken, msg.sender)
        onlyValidAndPendingSet(_setToken)
    {
        if (!anySetAllowed) {
            require(allowedSetTokens[_setToken], "Not allowed SetToken");
        }

        // Initialize module before trying register
        _setToken.initializeModule();

        // Get debt issuance module registered to this module and require that it is initialized
        require(_setToken.isInitializedModule(getAndValidateAdapter(DEFAULT_ISSUANCE_MODULE_NAME)), "Issuance not initialized");

        // Try if register exists on any of the modules including the debt issuance module
        address[] memory modules = _setToken.getModules();
        for(uint256 i = 0; i < modules.length; i++) {
            try IDebtIssuanceModule(modules[i]).registerToIssuanceModule(_setToken) {} catch {}
        }

        _setMarketParams(_setToken, _marketParams);
    }

    /**
     * @dev MANAGER ONLY: Deposits full collateral token balance as collateral into the specified Morpho market
     * Will result in the collateral token position switching from being a default to an external position.
     * Note: At the time of calling this the set token should contain >0 balance of collateral tokens and no other position
     * @param _setToken             Instance of the SetToken for which to deposit collateral tokens into Morpho
     */
    function enterCollateralPosition(
        ISetToken _setToken
    )
        external
        onlyManagerAndValidSet(_setToken)
    {
        MarketParams memory setMarketParams = marketParams[_setToken];
        uint256 collateralBalance = IERC20(setMarketParams.collateralToken).balanceOf(address(_setToken));
        require(collateralBalance > 0, "Collateral balance is 0");
        _deposit(_setToken, setMarketParams, collateralBalance);
        // Remove default position for collateral token 
        _setToken.editDefaultPosition(setMarketParams.collateralToken, 0);
        sync(_setToken);
    }

    /**
     * @dev MANAGER ONLY: Withdraws full collateral position from the specified Morpho market
     * @param _setToken             Instance of the SetToken for which to withdraw collateral tokens from Morpho
     */
    function exitCollateralPosition(
        ISetToken _setToken
    )
        external
        onlyManagerAndValidSet(_setToken)
    {
        MarketParams memory setMarketParams = marketParams[_setToken];
        bytes32 marketId = setMarketParams.id();
        Position memory position = morpho.position(marketId, address(_setToken));
        require(position.borrowShares == 0, "Borrow balance must be 0");
        _withdraw(_setToken, setMarketParams, position.collateral);

        _sync(_setToken);

        uint256 collateralNotionalBalance = IERC20(setMarketParams.collateralToken).balanceOf(address(_setToken));
        uint256 newCollateralPosition = collateralNotionalBalance.preciseDiv(_setToken.totalSupply());
        _setToken.editDefaultPosition(setMarketParams.collateralToken, newCollateralPosition);
    }


    /**
     * @dev MANAGER ONLY: Removes this module from the SetToken, via call by the SetToken. Any deposited collateral assets
     * are disabled to be used as collateral on Morpho. Morpho market params state is deleted.
     * Note: Function should revert is there is any debt remaining on Morpho
     */
    function removeModule()
        external
        override
        onlyValidAndInitializedSet(ISetToken(msg.sender))
    {
        ISetToken setToken = ISetToken(msg.sender);

        sync(setToken);

        delete marketParams[setToken];

        // Try if unregister exists on any of the modules
        address[] memory modules = setToken.getModules();
        for(uint256 i = 0; i < modules.length; i++) {
            try IDebtIssuanceModule(modules[i]).unregisterFromIssuanceModule(setToken) {} catch {}
        }
    }

    /**
     * @dev MANAGER ONLY: Add registration of this module on the debt issuance module for the SetToken.
     * Note: if the debt issuance module is not added to SetToken before this module is initialized, then this function
     * needs to be called if the debt issuance module is later added and initialized to prevent state inconsistencies
     * @param _setToken             Instance of the SetToken
     * @param _debtIssuanceModule   Debt issuance module address to register
     */
    function registerToModule(
        ISetToken _setToken,
        IDebtIssuanceModule _debtIssuanceModule
    )
        external
        onlyManagerAndValidSet(_setToken)
    {
        require(_setToken.isInitializedModule(address(_debtIssuanceModule)), "Issuance not initialized");

        _debtIssuanceModule.registerToIssuanceModule(_setToken);
    }

    /**
     * @dev GOVERNANCE ONLY: Enable/disable ability of a SetToken to initialize this module. Only callable by governance.
     * @param _setToken             Instance of the SetToken
     * @param _status               Bool indicating if _setToken is allowed to initialize this module
     */
    function updateAllowedSetToken(
        ISetToken _setToken,
        bool _status
    )
        external
        onlyOwner
    {
        require(controller.isSet(address(_setToken)) || allowedSetTokens[_setToken], "Invalid SetToken");
        allowedSetTokens[_setToken] = _status;
        emit SetTokenStatusUpdated(_setToken, _status);
    }

    /**
     * @dev GOVERNANCE ONLY: Toggle whether ANY SetToken is allowed to initialize this module. Only callable by governance.
     * @param _anySetAllowed             Bool indicating if ANY SetToken is allowed to initialize this module
     */
    function updateAnySetAllowed(bool _anySetAllowed) external onlyOwner {
        anySetAllowed = _anySetAllowed;
        emit AnySetAllowedUpdated(_anySetAllowed);
    }

    /**
     * @dev MODULE ONLY: Hook called prior to issuance to sync positions on SetToken. Only callable by valid module.
     * @param _setToken             Instance of the SetToken
     */
    function moduleIssueHook(
        ISetToken _setToken,
        uint256 /* _setTokenQuantity */
    )
        external
        override
        onlyModule(_setToken)
    {
        sync(_setToken);
    }

    /**
     * @dev MODULE ONLY: Hook called prior to redemption to sync positions on SetToken. For redemption, always use current borrowed
     * balance after interest accrual. Only callable by valid module.
     * @param _setToken             Instance of the SetToken
     */
    function moduleRedeemHook(
        ISetToken _setToken,
        uint256 /* _setTokenQuantity */
    )
        external
        override
        onlyModule(_setToken)
    {
        sync(_setToken);
    }

    /**
     * @dev MODULE ONLY: Hook called prior to looping through each component on issuance. Invokes borrow in order for
     * module to return debt to issuer. Only callable by valid module.
     * @param _setToken             Instance of the SetToken
     * @param _setTokenQuantity     Quantity of SetToken
     * @param _component            Address of component
     */
    function componentIssueHook(
        ISetToken _setToken,
        uint256 _setTokenQuantity,
        IERC20 _component,
        bool _isEquity
    )
        external
        override
        onlyModule(_setToken)
    {
        // Check hook not being called for an equity position. If hook is called with equity position and outstanding borrow position 
        // exists the loan would be taken out twice potentially leading to liquidation
        MarketParams memory setMarketParams = marketParams[_setToken];
        if (_isEquity && setMarketParams.collateralToken == address(_component)) {
            int256 componentCollateral = _setToken.getExternalPositionRealUnit(address(_component), address(this));

            require(componentCollateral > 0, "Component must be positive");

            uint256 notionalCollateral = componentCollateral.toUint256().preciseMul(_setTokenQuantity);
            _deposit(_setToken, setMarketParams, notionalCollateral);
        }
        if(!_isEquity) {
            require(setMarketParams.loanToken == address(_component), "Debt component mismatch");
            int256 componentDebt = _setToken.getExternalPositionRealUnit(address(_component), address(this));

            require(componentDebt < 0, "Component must be negative");

            uint256 notionalDebt = componentDebt.mul(-1).toUint256().preciseMul(_setTokenQuantity);
            _borrow(_setToken, setMarketParams, notionalDebt);
        }
    }

    /**
     * @dev MODULE ONLY: Hook called prior to looping through each component on redemption. Invokes repay after
     * the issuance module transfers debt from the issuer. Only callable by valid module.
     * @param _setToken             Instance of the SetToken
     * @param _setTokenQuantity     Quantity of SetToken
     * @param _component            Address of component
     */
    function componentRedeemHook(
        ISetToken _setToken,
        uint256 _setTokenQuantity,
        IERC20 _component,
        bool _isEquity
    )
        external
        override
        onlyModule(_setToken)
    {
        MarketParams memory setMarketParams = marketParams[_setToken];
        if (_isEquity && setMarketParams.collateralToken == address(_component)) {
            int256 componentCollateral = _setToken.getExternalPositionRealUnit(address(_component), address(this));
            require(componentCollateral > 0, "Component must be negative");
            uint256 notionalCollateral = componentCollateral.toUint256().preciseMul(_setTokenQuantity);
            _withdraw(_setToken, setMarketParams, notionalCollateral);
        }
        if(!_isEquity) {
            require(setMarketParams.loanToken == address(_component), "Debt component mismatch");
            int256 componentDebt = _setToken.getExternalPositionRealUnit(address(_component), address(this));

            require(componentDebt < 0, "Component must be negative");

            uint256 notionalDebt = componentDebt.mul(-1).toUint256().preciseMul(_setTokenQuantity);
            _repayBorrow(_setToken, setMarketParams, notionalDebt, 0);
        }
    }


    function getMarketId(ISetToken _setToken) external view returns (bytes32) {
        MarketParams memory setMarketParams = marketParams[_setToken];
        require(setMarketParams.collateralToken != address(0), "Collateral not set");
        return setMarketParams.id();
    }

    /**
     * @dev Reads outstanding borrow token debt and collateral token balance from Morpho
     */
    function getCollateralAndBorrowBalances(
        ISetToken _setToken
    )
        external
        view 
        returns(uint256 collateralBalance, uint256 borrowBalance, uint256 borrowSharesU256)
    {
        MarketParams memory setMarketParams = marketParams[_setToken];
        require(setMarketParams.collateralToken != address(0), "Collateral not set");
        return _getCollateralAndBorrowBalances(_setToken, setMarketParams);
    }


    /* ============ Internal Functions ============ */

    /**
     * @dev Reads outstanding borrow token debt and collateral token balance from Morpho
     * and normalizes them  by the sets total supply to get the per token equivalent (position)
     */
    function _getCollateralAndBorrowPositions(
        ISetToken _setToken,
        MarketParams memory _marketParams,
        uint256 _setTotalSupply
    )
        internal
        view
        returns(int256 collateralPosition, int256 borrowPosition)
    {
        if (_setTotalSupply == 0) {
            return (0, 0);
        }
        (uint256 collateralBalance, uint256 borrowBalance, ) = _getCollateralAndBorrowBalances(_setToken, _marketParams);
        collateralPosition = collateralBalance.preciseDiv(_setTotalSupply).toInt256();
        borrowPosition = borrowBalance.preciseDivCeil(_setTotalSupply).toInt256().mul(-1);
    }

    /**
     * @dev Reads outstanding borrow token debt and collateral token balance from Morpho
     */
    function _getCollateralAndBorrowBalances(
        ISetToken _setToken,
        MarketParams memory _marketParams
    )
        internal
        view 
        returns(uint256 collateralBalance, uint256 borrowBalance, uint256 borrowSharesU256)
    {
        bytes32 marketId = _marketParams.id();
        Position memory position = morpho.position(marketId, address(_setToken));
        (,, uint256 totalBorrowAssets, uint256 totalBorrowShares) = morpho.expectedMarketBalances(_marketParams);

        borrowBalance = position.borrowShares.toAssetsUp(totalBorrowAssets, totalBorrowShares);

        collateralBalance = uint256(position.collateral);
        borrowSharesU256 = uint256(position.borrowShares);
    }

    /**
     * @dev Updates external position unit for given borrow asset on SetToken
     */
    function _updateExternalPosition(
        ISetToken _setToken, 
        address _underlyingAsset,
        int256 _newPositionUnit
    )
        internal
    {
        _setToken.editExternalPosition(_underlyingAsset, address(this), _newPositionUnit, "");
    }


    /**
     * @dev Invoke deposit (as collateral) from SetToken using Morpho Blue
     */
    function _deposit(
        ISetToken _setToken,
        MarketParams memory _marketParams,
        uint256 _notionalQuantity
    )
        internal
    {
        _setToken.invokeApprove(_marketParams.collateralToken, address(morpho), _notionalQuantity);
        _setToken.invokeSupplyCollateral(
            morpho,
            _marketParams,
            _notionalQuantity
        );
    }

    /**
     * @dev Invoke withdraw from SetToken using Morpho Blue
     */
    function _withdraw(
        ISetToken _setToken,
        MarketParams memory _marketParams,
        uint256 _notionalQuantity
    )
        internal
    {
        _setToken.invokeWithdrawCollateral(
            morpho,
            _marketParams,
            _notionalQuantity
        );
    }

    /**
     * @dev Invoke repay from SetToken using Morpho Blue
     */
    function _repayBorrow(
        ISetToken _setToken,
        MarketParams memory _marketParams,
        uint256 _notionalQuantity,
        uint256 _shares
    )
        internal
    {
        // Only ever set shares or assets to avoid "inconsistent input" error when there is a rounding error
        if(_shares > 0) {
            _setToken.invokeApprove(_marketParams.loanToken, address(morpho), _notionalQuantity);
            _setToken.invokeRepay(
                morpho,
                _marketParams,
                0,
                _shares
            );
        } else {
            _setToken.invokeApprove(_marketParams.loanToken, address(morpho), _notionalQuantity);
            _setToken.invokeRepay(
                morpho,
                _marketParams,
                _notionalQuantity,
                0
            );
        }
    }


    /**
     * @dev Invoke borrow from the SetToken using Morpho 
     */
    function _borrow(
        ISetToken _setToken,
        MarketParams memory _marketParams,
        uint256 _notionalQuantity
    )
        internal
    {
        _setToken.invokeBorrow(
            morpho,
            _marketParams,
            _notionalQuantity
        );
    }

    /**
     * @dev Invokes approvals, gets trade call data from exchange adapter and invokes trade from SetToken
     * @return uint256     The quantity of tokens received post-trade
     */
    function _executeTrade(
        ActionInfo memory _actionInfo,
        IERC20 _sendToken,
        IERC20 _receiveToken,
        bytes memory _data
    )
        internal
        returns (uint256)
    {
        ISetToken setToken = _actionInfo.setToken;
        uint256 notionalSendQuantity = _actionInfo.notionalSendQuantity;

        setToken.invokeApprove(
            address(_sendToken),
            _actionInfo.exchangeAdapter.getSpender(),
            notionalSendQuantity
        );

        (
            address targetExchange,
            uint256 callValue,
            bytes memory methodData
        ) = _actionInfo.exchangeAdapter.getTradeCalldata(
            address(_sendToken),
            address(_receiveToken),
            address(setToken),
            notionalSendQuantity,
            _actionInfo.minNotionalReceiveQuantity,
            _data
        );

        setToken.invoke(targetExchange, callValue, methodData);

        uint256 receiveTokenQuantity = _receiveToken.balanceOf(address(setToken)).sub(_actionInfo.preTradeReceiveTokenBalance);
        require(
            receiveTokenQuantity >= _actionInfo.minNotionalReceiveQuantity,
            "Slippage too high"
        );

        return receiveTokenQuantity;
    }

    /**
     * @dev Calculates protocol fee on module and pays protocol fee from SetToken
     * @return uint256          Total protocol fee paid
     */
    function _accrueProtocolFee(ISetToken _setToken, IERC20 _receiveToken, uint256 _exchangedQuantity) internal returns(uint256) {
        uint256 protocolFeeTotal = getModuleFee(PROTOCOL_TRADE_FEE_INDEX, _exchangedQuantity);

        payProtocolFeeFromSetToken(_setToken, address(_receiveToken), protocolFeeTotal);

        return protocolFeeTotal;
    }

    /**
     * @dev Construct the ActionInfo struct for lever and delever
     * @return ActionInfo       Instance of constructed ActionInfo struct
     */
    function _createAndValidateActionInfo(
        ISetToken _setToken,
        IERC20 _sendToken,
        IERC20 _receiveToken,
        uint256 _sendQuantityUnits,
        uint256 _minReceiveQuantityUnits,
        string memory _tradeAdapterName,
        bool _isLever
    )
        internal
        view
        returns(ActionInfo memory)
    {
        uint256 totalSupply = _setToken.totalSupply();

        return _createAndValidateActionInfoNotional(
            _setToken,
            _sendToken,
            _receiveToken,
            _sendQuantityUnits.preciseMul(totalSupply),
            _minReceiveQuantityUnits.preciseMul(totalSupply),
            _tradeAdapterName,
            _isLever,
            totalSupply
        );
    }

    /**
     * @dev Construct the ActionInfo struct for lever and delever accepting notional units
     * @return ActionInfo       Instance of constructed ActionInfo struct
     */
    function _createAndValidateActionInfoNotional(
        ISetToken _setToken,
        IERC20 _sendToken,
        IERC20 _receiveToken,
        uint256 _notionalSendQuantity,
        uint256 _minNotionalReceiveQuantity,
        string memory _tradeAdapterName,
        bool _isLever,
        uint256 _setTotalSupply
    )
        internal
        view
        returns(ActionInfo memory)
    {
        ActionInfo memory actionInfo = ActionInfo ({
            exchangeAdapter: IExchangeAdapter(getAndValidateAdapter(_tradeAdapterName)),
            setToken: _setToken,
            collateralAsset: _isLever ? _receiveToken : _sendToken,
            borrowAsset: _isLever ? _sendToken : _receiveToken,
            setTotalSupply: _setTotalSupply,
            notionalSendQuantity: _notionalSendQuantity,
            minNotionalReceiveQuantity: _minNotionalReceiveQuantity,
            preTradeReceiveTokenBalance: IERC20(_receiveToken).balanceOf(address(_setToken))
        });

        _validateCommon(actionInfo);

        return actionInfo;
    }

    /**
     * @dev Validates and sets given market params for given set token
     */
    function _setMarketParams(
        ISetToken _setToken,
        MarketParams memory _newMarketParams
    ) 
        internal
    {
        bytes32 marketId = _validateMarketParams(_newMarketParams);
        marketParams[_setToken] = _newMarketParams;
        emit MorphoMarketUpdated(
            _setToken,
            marketId
        );
    }

    /**
     * @dev Validates market params by checking that the resulting marketId exists on morpho
     */
    function _validateMarketParams(
        MarketParams memory _newMarketParams
    )
        internal
        view
        returns(bytes32 marketId)
    {
        marketId = _newMarketParams.id();
        Market memory market = morpho.market(marketId);
        require(market.lastUpdate != 0, "Market not created");
    }

    /**
     * @dev Validate common requirements for lever and delever
     */
    function _validateCommon(ActionInfo memory _actionInfo) internal view {
        require(marketParams[_actionInfo.setToken].collateralToken != address(0), "Collateral not enabled");
        require(marketParams[_actionInfo.setToken].loanToken != address(0), "Borrow not enabled");
        require(_actionInfo.collateralAsset != _actionInfo.borrowAsset, "Collateral and borrow asset must be different");
        require(_actionInfo.notionalSendQuantity > 0, "Quantity is 0");
    }

    /**
     * @dev Updates the default (i.e. non-morpho) token balance of the repay / collateral token after delevering if necessary
     */
    function _updateRepayDefaultPosition(ActionInfo memory _actionInfo, IERC20 _repayAsset) internal {
        // if amount of tokens traded for exceeds debt, update default position first to save gas on editing borrow position
        uint256 repayAssetBalance = _repayAsset.balanceOf(address(_actionInfo.setToken));
        if (repayAssetBalance != _actionInfo.preTradeReceiveTokenBalance) {
            _actionInfo.setToken.calculateAndEditDefaultPosition(
                address(_repayAsset),
                _actionInfo.setTotalSupply,
                _actionInfo.preTradeReceiveTokenBalance
            );
        }
    }
}
