// Fire a wagmi writeContract (or writeContractAsync) and, on mobile, bring the
// wallet app back to the foreground so the user can confirm without manually
// switching apps. The setTimeout is the load-bearing part: it gives the wallet
// app time to receive the WalletConnect request before we attempt to refocus
// it. The `openWallet` callback is optional — if we cannot reliably resolve
// the active wallet's deep-link scheme, the helper still benefits from the
// async-fire pattern and simply no-ops the focus hint.
export async function writeAndOpen<T>(write: () => Promise<T>, openWallet?: () => void): Promise<T> {
  const promise = write();
  if (typeof window !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) && openWallet) {
    // Delay slightly so the wallet app has time to receive the request.
    setTimeout(openWallet, 2000);
  }
  return promise;
}
