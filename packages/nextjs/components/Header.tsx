"use client";

import React, { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { RainbowKitCustomConnectButton } from "~~/components/scaffold-eth";
import { useOutsideClick } from "~~/hooks/scaffold-eth";

type HeaderMenuLink = {
  label: string;
  href: string;
};

export const menuLinks: HeaderMenuLink[] = [
  { label: "Home", href: "/" },
  { label: "Create", href: "/create" },
  { label: "My Vault", href: "/vault" },
  { label: "Verify", href: "/verify" },
];

const HeaderMenuLinks = ({ onNavigate }: { onNavigate?: () => void }) => {
  const pathname = usePathname();
  return (
    <>
      {menuLinks.map(({ label, href }) => {
        const isActive = pathname === href || (href !== "/" && pathname?.startsWith(href));
        return (
          <li key={href}>
            <Link
              href={href}
              passHref
              onClick={onNavigate}
              className={`${
                isActive ? "bg-secondary text-secondary-content" : "hover:bg-base-300"
              } py-1.5 px-3 text-sm rounded-full inline-flex items-center gap-2`}
            >
              <span>{label}</span>
            </Link>
          </li>
        );
      })}
    </>
  );
};

const VaultMark = () => (
  <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-9 h-9">
    <rect x="2" y="2" width="36" height="36" rx="8" fill="#1A1A2E" stroke="#C9A84C" strokeWidth="1.4" />
    <path d="M14 18v-3a6 6 0 0 1 12 0v3" stroke="#C9A84C" strokeWidth="1.6" strokeLinecap="round" />
    <rect x="11" y="18" width="18" height="13" rx="3" fill="#C9A84C" />
    <circle cx="20" cy="24" r="2.4" fill="#1A1A2E" />
    <rect x="19.1" y="23.6" width="1.8" height="4" rx="0.7" fill="#1A1A2E" />
  </svg>
);

export const Header = () => {
  const burgerMenuRef = useRef<HTMLDetailsElement>(null);
  useOutsideClick(burgerMenuRef, () => {
    burgerMenuRef?.current?.removeAttribute("open");
  });

  return (
    <div className="sticky lg:static top-0 navbar bg-base-100/90 backdrop-blur min-h-0 shrink-0 justify-between z-20 px-2 sm:px-4 border-b border-primary/15">
      <div className="navbar-start w-auto lg:w-1/2">
        <details className="dropdown" ref={burgerMenuRef}>
          <summary className="ml-1 btn btn-ghost lg:hidden hover:bg-transparent">
            <Bars3Icon className="h-5 w-5" />
          </summary>
          <ul
            className="menu menu-compact dropdown-content mt-3 p-2 shadow-sm bg-base-100 rounded-box w-52"
            onClick={() => burgerMenuRef?.current?.removeAttribute("open")}
          >
            <HeaderMenuLinks onNavigate={() => burgerMenuRef?.current?.removeAttribute("open")} />
          </ul>
        </details>
        <Link href="/" passHref className="hidden lg:flex items-center gap-3 ml-2 mr-6 shrink-0">
          <VaultMark />
          <div className="flex flex-col leading-tight">
            <span className="font-bold tracking-wide">VaultID</span>
            <span className="text-xs opacity-70">Proof, passes, memories.</span>
          </div>
        </Link>
        <ul className="hidden lg:flex lg:flex-nowrap menu menu-horizontal px-1 gap-1">
          <HeaderMenuLinks />
        </ul>
      </div>
      <div className="navbar-end grow mr-2 sm:mr-4">
        <RainbowKitCustomConnectButton />
      </div>
    </div>
  );
};
