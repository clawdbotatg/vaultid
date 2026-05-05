"use client";

import React from "react";
import { Address } from "@scaffold-ui/components";
import { base } from "viem/chains";
import { SwitchTheme } from "~~/components/SwitchTheme";
import deployedContracts from "~~/contracts/deployedContracts";

const VAULTID_ADDRESS = deployedContracts[8453].VaultID.address as `0x${string}`;
const BASESCAN_URL = `https://basescan.org/address/${VAULTID_ADDRESS}`;

export const Footer = () => {
  return (
    <footer className="border-t border-primary/15 bg-base-100 mt-12">
      <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3 text-sm">
          <span className="opacity-70">Contract</span>
          <Address address={VAULTID_ADDRESS} chain={base} format="short" disableAddressLink />
          <a href={BASESCAN_URL} target="_blank" rel="noreferrer" className="link link-hover text-xs vault-gold">
            View on Basescan ↗
          </a>
        </div>
        <div className="flex items-center gap-4 text-sm opacity-80">
          <span>Network: Base</span>
          <SwitchTheme />
        </div>
      </div>
      <div className="border-t border-primary/10 px-4 py-3 text-center text-xs opacity-60">
        VaultID — soulbound vaults on Base. Your keys, your contents, forever.
      </div>
    </footer>
  );
};
