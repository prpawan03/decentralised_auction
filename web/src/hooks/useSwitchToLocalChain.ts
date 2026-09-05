import { useCallback, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import { getConnectorClient } from "wagmi/actions";
import { addChainParams, localChain } from "@/config/chain";
import { decodeContractError } from "@/lib/errors";

/**
 * "Switch to the local chain".
 *
 * `wallet_switchEthereumChain` (EIP-3326) fails with code 4902 when the wallet
 * has never heard of the chain — which is always true the first time someone
 * points MetaMask at a fresh local node. The correct recovery is to call
 * `wallet_addEthereumChain` (EIP-3085) and then let the wallet switch.
 *
 * wagmi's `useSwitchChain` handles the happy path but its behaviour on 4902
 * depends on the connector, so this does the two-step explicitly against the
 * connector's own EIP-1193 provider.
 */

interface ProviderError {
  code?: number;
  message?: string;
  /* MetaMask nests the real code when the request came through its RPC engine. */
  data?: { originalError?: { code?: number } };
}

function errorCode(error: unknown): number | undefined {
  const e = error as ProviderError | null;
  return e?.code ?? e?.data?.originalError?.code;
}

export function useSwitchToLocalChain() {
  const config = useConfig();
  const { isConnected, chainId } = useAccount();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isWrongChain = isConnected && chainId !== undefined && chainId !== localChain.id;

  const switchChain = useCallback(async (): Promise<boolean> => {
    setError(null);
    setIsPending(true);
    try {
      const client = await getConnectorClient(config);
      const hexId = `0x${localChain.id.toString(16)}` as const;

      try {
        await client.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: hexId }],
        });
        return true;
      } catch (switchError: unknown) {
        /* 4902: the wallet does not know this chain yet. Add it, then it
           switches to it as part of the same flow. */
        if (errorCode(switchError) !== 4902) throw switchError;

        await client.request({
          method: "wallet_addEthereumChain",
          params: [addChainParams],
        });
        return true;
      }
    } catch (e: unknown) {
      const decoded = decodeContractError(e);
      /* A user closing the wallet prompt is not an error to shout about. */
      setError(decoded.rejected ? null : decoded.message);
      return false;
    } finally {
      setIsPending(false);
    }
  }, [config]);

  return {
    switchChain,
    isPending,
    error,
    isWrongChain,
    targetChainId: localChain.id,
    targetChainName: localChain.name,
  };
}
