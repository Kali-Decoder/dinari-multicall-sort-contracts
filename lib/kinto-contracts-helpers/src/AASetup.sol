// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import "forge-std/console.sol";

import "account-abstraction/interfaces/IEntryPoint.sol";

import "./interfaces/IKintoWalletFactory.sol";
import "./interfaces/ISponsorPaymaster.sol";
import "./interfaces/IKintoID.sol";

import "./Create2Helper.sol";
import "./ArtifactsReader.sol";

abstract contract AASetup is Create2Helper, ArtifactsReader {
    function _checkAccountAbstraction()
        internal
        returns (
            IKintoID _kintoID,
            IEntryPoint _entryPoint,
            IKintoWalletFactory _walletFactory,
            ISponsorPaymaster _sponsorPaymaster
        )
    {
        // Kinto ID
        address kintoProxyAddr = _getChainDeployment("KintoID");
        if (!isContract(kintoProxyAddr)) {
            console.log("Kinto ID proxy not deployed at", address(kintoProxyAddr));
            revert("Kinto ID not deployed");
        }
        _kintoID = IKintoID(address(kintoProxyAddr));

        // Entry Point
        address entryPointAddr = _getChainDeployment("EntryPoint");
        if (!isContract(entryPointAddr)) {
            console.log("EntryPoint not deployed at", address(entryPointAddr));
            revert("EntryPoint not deployed");
        }
        _entryPoint = IEntryPoint(payable(entryPointAddr));

        // Wallet Factory
        address walletFactoryAddr = _getChainDeployment("KintoWalletFactory");
        if (!isContract(walletFactoryAddr)) {
            console.log("Wallet factory proxy not deployed at", address(walletFactoryAddr));
            revert("Wallet Factory Proxy not deployed");
        }
        _walletFactory = IKintoWalletFactory(payable(walletFactoryAddr));

        // Sponsor Paymaster
        address sponsorProxyAddr = _getChainDeployment("SponsorPaymaster");
        if (!isContract(sponsorProxyAddr)) {
            console.log("Paymaster proxy not deployed at", address(sponsorProxyAddr));
            revert("Paymaster proxy not deployed");
        }
        _sponsorPaymaster = ISponsorPaymaster(payable(sponsorProxyAddr));
    }
}
