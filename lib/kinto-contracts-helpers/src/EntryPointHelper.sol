// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "account-abstraction/interfaces/IEntryPoint.sol";
import "./interfaces/IKintoWallet.sol";

import "./UserOp.sol";

abstract contract EntryPointHelper is UserOp {
    function _handleOps(
        IEntryPoint _entryPoint,
        bytes memory _selectorAndParams,
        address _from,
        address _to,
        uint256 _signerPk
    ) internal {
        _handleOps(_entryPoint, _selectorAndParams, _from, _to, address(0), _signerPk);
    }

    function _handleOps(
        IEntryPoint _entryPoint,
        bytes memory _selectorAndParams,
        address _from,
        address _to,
        address _sponsorPaymaster,
        uint256 _signerPk
    ) internal {
        uint256[] memory privateKeys = new uint256[](1);
        privateKeys[0] = _signerPk;
        _handleOps(_entryPoint, _selectorAndParams, _from, _to, 0, _sponsorPaymaster, privateKeys);
    }

    function _handleOps(
        IEntryPoint _entryPoint,
        bytes memory _selectorAndParams,
        address _from,
        address _to,
        uint256 value,
        address _sponsorPaymaster,
        uint256 _signerPk
    ) internal {
        uint256[] memory privateKeys = new uint256[](1);
        privateKeys[0] = _signerPk;
        _handleOps(_entryPoint, _selectorAndParams, _from, _to, value, _sponsorPaymaster, privateKeys);
    }

    function _handleOps(
        IEntryPoint _entryPoint,
        bytes memory _selectorAndParams,
        address _from,
        address _to,
        uint256 value,
        address _sponsorPaymaster,
        uint256[] memory _privateKeys
    ) internal {
        UserOperation[] memory userOps = new UserOperation[](1);
        userOps[0] = _createUserOperation(
            block.chainid,
            _from,
            _to,
            value,
            IKintoWallet(_from).getNonce(),
            _privateKeys,
            _selectorAndParams,
            _sponsorPaymaster
        );
        _entryPoint.handleOps(userOps, payable(vm.addr(_privateKeys[0])));
    }
}
