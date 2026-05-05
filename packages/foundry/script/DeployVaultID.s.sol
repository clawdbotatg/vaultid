// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { VaultID } from "../contracts/VaultID.sol";

/**
 * @notice Deploy script for VaultID.
 *
 * Reads three env vars:
 *  - CLAWD_TOKEN  (required, default: 0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07)
 *  - CV_TOKEN     (optional, default: address(0); owner can set later via setCvToken)
 *  - OWNER        (optional, default: deployer / msg.sender)
 *
 * Run as part of the chained deploy via `yarn deploy` (see Deploy.s.sol).
 */
contract DeployVaultID is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        address clawdToken = vm.envOr("CLAWD_TOKEN", address(0x9f86dB9fc6f7c9408e8Fda3Ff8ce4e78ac7a6b07));
        address cvToken = vm.envOr("CV_TOKEN", address(0));
        address owner = vm.envOr("OWNER", deployer);

        VaultID vault = new VaultID(owner, clawdToken, cvToken);

        console.logString("VaultID deployed at:");
        console.logAddress(address(vault));
        if (cvToken == address(0)) {
            console.log("CV token initially unset; owner can call setCvToken later.");
        }
    }
}
