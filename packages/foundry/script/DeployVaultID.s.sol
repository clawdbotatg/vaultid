// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./DeployHelpers.s.sol";
import { VaultID } from "../contracts/VaultID.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice Deploy script for VaultID.
 *
 * Reads three env vars:
 *  - CLAWD_TOKEN  (REQUIRED — no default; must point at a real ERC-20 on the
 *                  target network. The script verifies this by calling
 *                  `totalSupply()` and reverts if the call fails.)
 *  - CV_TOKEN     (optional, default: address(0); owner can set later via setCvToken)
 *  - OWNER        (REQUIRED — no default; MUST be the LeftClaw `job.client`
 *                  address. The deployer (msg.sender) is intentionally NOT
 *                  used as a fallback to prevent accidental deploys with the
 *                  wrong owner.)
 *
 * Run as part of the chained deploy via `yarn deploy` (see Deploy.s.sol).
 */
contract DeployVaultID is ScaffoldETHDeploy {
    function run() external ScaffoldEthDeployerRunner {
        // CLAWD_TOKEN is mandatory — no fallback default.
        address clawdToken = vm.envAddress("CLAWD_TOKEN");
        address cvToken = vm.envOr("CV_TOKEN", address(0));
        // OWNER is mandatory — must be the LeftClaw job.client.
        address owner = vm.envAddress("OWNER");

        // Pre-flight: confirm CLAWD_TOKEN is a real ERC-20 by probing totalSupply().
        // Reverts if the address has no code or doesn't expose ERC-20.
        try IERC20(clawdToken).totalSupply() returns (uint256) {
            // ok
        } catch {
            revert("CLAWD_TOKEN does not look like an ERC-20 (totalSupply() failed)");
        }

        console.log("Resolved deploy parameters:");
        console.log("  OWNER       :", owner);
        console.log("  CLAWD_TOKEN :", clawdToken);
        console.log("  CV_TOKEN    :", cvToken);

        VaultID vault = new VaultID(owner, clawdToken, cvToken);

        console.logString("VaultID deployed at:");
        console.logAddress(address(vault));
        if (cvToken == address(0)) {
            console.log("CV token initially unset; owner can call setCvToken later (one-shot).");
        }
    }
}
