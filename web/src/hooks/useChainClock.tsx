import { useEffect } from "react";
import { useBlock } from "wagmi";
import { localChain } from "@/config/chain";
import { useSetClockSkew } from "@/hooks/useTicker";

/**
 * Keeps the shared clock honest.
 *
 * Watches the latest block and publishes (block.timestamp - wall clock) as the
 * skew the ticker adds to Date.now(). Renders nothing. It lives inside the
 * Wagmi provider, while the ticker itself does not depend on wagmi, so the
 * countdown components stay renderable in unit tests with no wallet stack.
 *
 * A read-only visitor with no wallet still gets this: useBlock only needs the
 * public transport.
 */
export function ChainClockAnchor() {
  const setSkew = useSetClockSkew();
  const block = useBlock({
    chainId: localChain.id,
    watch: true,
    query: { select: (b) => Number(b.timestamp) },
  });

  useEffect(() => {
    if (block.data === undefined) return;
    setSkew(block.data - Math.floor(Date.now() / 1000));
  }, [block.data, setSkew]);

  return null;
}
