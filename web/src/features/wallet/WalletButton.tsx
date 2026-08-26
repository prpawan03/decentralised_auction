import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { truncateAddress, spellAddress } from "@/lib/format";
import { useSwitchToLocalChain } from "@/hooks/useSwitchToLocalChain";
import { localChain } from "@/config/chain";

/**
 * The header wallet control.
 *
 * RainbowKit's ConnectButton.Custom is used rather than the stock button so
 * the control matches the rest of the terminal and, more importantly, so the
 * WRONG-CHAIN state gets our own two-step switch (EIP-3326 then EIP-3085 on
 * 4902) instead of RainbowKit's, which some injected wallets do not complete.
 *
 * Everything here is presentational. `useAccount()` is the one source of truth
 * for the connected account; nothing copies it into state.
 */
export function WalletButton() {
  const { isWrongChain, switchChain, isPending, error, targetChainName } = useSwitchToLocalChain();

  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        if (!ready) {
          /* Reserve the space so the header does not jump when hydration lands. */
          return <div aria-hidden="true" className="h-9 w-32" />;
        }

        if (!connected) {
          return (
            <Button variant="primary" size="sm" onClick={openConnectModal}>
              Connect wallet
            </Button>
          );
        }

        if (chain.unsupported || isWrongChain) {
          return (
            <div className="flex flex-col items-end gap-1">
              <Button
                variant="danger"
                size="sm"
                onClick={() => void switchChain()}
                loading={isPending}
                loadingLabel="Asking your wallet to switch"
              >
                Switch to {targetChainName}
              </Button>
              <p className="text-[0.6875rem] text-[var(--color-ink-3)]">
                Connected to {chain.name ?? `chain ${String(chain.id)}`}; this app needs chain{" "}
                <span className="tnum">{localChain.id}</span>.
              </p>
              {error ? (
                <p role="alert" className="max-w-56 text-right text-[0.6875rem] text-[var(--color-danger)]">
                  {error}
                </p>
              ) : null}
            </div>
          );
        }

        return (
          <div className="flex items-center gap-2">
            <Pill tone="live">on chain</Pill>
            <Button variant="secondary" size="sm" onClick={openAccountModal}>
              <span aria-hidden="true" className="tnum">
                {truncateAddress(account.address)}
              </span>
              <span className="sr-only">
                Wallet menu for account {spellAddress(account.address)}
                {account.displayBalance ? `, balance ${account.displayBalance}` : ""}
              </span>
              {account.displayBalance ? (
                <span aria-hidden="true" className="tnum text-[0.75rem] text-[var(--color-ink-3)]">
                  {account.displayBalance}
                </span>
              ) : null}
            </Button>
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}

/**
 * The inline "you need a wallet for this" prompt, shown INSIDE a disabled
 * action rather than in place of the whole page. Reading never requires this.
 */
export function ConnectPrompt({ action }: { action: string }) {
  const { isConnected } = useAccount();
  if (isConnected) return null;

  return (
    <ConnectButton.Custom>
      {({ openConnectModal, mounted }) => (
        <div className="flex flex-wrap items-center gap-3 border-l-2 border-[var(--color-action)] bg-[var(--color-raised)] px-4 py-3">
          <p className="min-w-0 flex-1 text-[0.8125rem] text-[var(--color-ink-2)]">
            Browsing needs nothing. {action} needs a wallet that can sign a transaction.
          </p>
          <Button variant="primary" size="sm" onClick={openConnectModal} disabled={!mounted}>
            Connect wallet
          </Button>
        </div>
      )}
    </ConnectButton.Custom>
  );
}
