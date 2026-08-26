import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useEffect,
  type ReactNode,
} from "react";
import type { Hash } from "viem";
import { useWaitForTransactionReceipt } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { decodeContractError } from "@/lib/errors";

/**
 * The transaction tray.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE:
 *   Success is claimed only after a receipt comes back with status "success".
 *
 * The old app called `toast.success('Bid placed successfully!')` in the `try`
 * block right after `.send()` resolved. `.send()` resolving means the wallet
 * accepted the request, not that the transaction succeeded — so a reverted bid
 * showed a green success toast and the bidder walked away believing they had
 * won. Here, submission is a *pending* state and nothing else. The only code
 * that can mark a transaction successful is the receipt watcher below, and it
 * checks `receipt.status === "success"` explicitly, because a receipt is
 * returned for reverted transactions too.
 */

export type TxKind = "bid" | "buy-now" | "settle" | "cancel" | "withdraw" | "create" | "approve";

export type TxStatus = "signing" | "pending" | "success" | "reverted" | "error";

export interface TrackedTx {
  id: string;
  hash?: Hash;
  kind: TxKind;
  /** Short human label: "Bid 2.50 ETH on #4". */
  label: string;
  status: TxStatus;
  /** Set on reverted/error only. */
  message?: string;
  startedAt: number;
  /** Query keys to invalidate once the receipt confirms. */
  invalidate?: readonly (readonly unknown[])[];
}

type Action =
  | { type: "open"; tx: TrackedTx }
  | { type: "hash"; id: string; hash: Hash }
  | { type: "settled"; id: string; status: Exclude<TxStatus, "signing" | "pending">; message?: string }
  | { type: "dismiss"; id: string }
  | { type: "clear-finished" };

function reducer(state: TrackedTx[], action: Action): TrackedTx[] {
  switch (action.type) {
    case "open":
      return [action.tx, ...state].slice(0, 12);
    case "hash":
      return state.map((t) => (t.id === action.id ? { ...t, hash: action.hash, status: "pending" } : t));
    case "settled":
      return state.map((t) =>
        t.id === action.id
          ? { ...t, status: action.status, ...(action.message ? { message: action.message } : {}) }
          : t,
      );
    case "dismiss":
      return state.filter((t) => t.id !== action.id);
    case "clear-finished":
      return state.filter((t) => t.status === "signing" || t.status === "pending");
    default:
      return state;
  }
}

interface TxContextValue {
  transactions: TrackedTx[];
  /** Register a transaction the moment the wallet prompt opens. */
  begin: (input: { kind: TxKind; label: string; invalidate?: readonly (readonly unknown[])[] }) => string;
  /** The wallet returned a hash. Still PENDING, never success. */
  submitted: (id: string, hash: Hash) => void;
  /** The wallet threw or the user rejected. */
  failed: (id: string, error: unknown) => void;
  dismiss: (id: string) => void;
  clearFinished: () => void;
  pendingCount: number;
}

const TxContext = createContext<TxContextValue | null>(null);

let counter = 0;
const nextId = () => `tx-${++counter}-${Date.now()}`;

export function TxTrackerProvider({ children }: { children: ReactNode }) {
  const [transactions, dispatch] = useReducer(reducer, [] as TrackedTx[]);

  const begin: TxContextValue["begin"] = useCallback(({ kind, label, invalidate }) => {
    const id = nextId();
    dispatch({
      type: "open",
      tx: {
        id,
        kind,
        label,
        status: "signing",
        startedAt: Date.now(),
        ...(invalidate ? { invalidate } : {}),
      },
    });
    return id;
  }, []);

  const submitted: TxContextValue["submitted"] = useCallback((id, hash) => {
    dispatch({ type: "hash", id, hash });
  }, []);

  const failed: TxContextValue["failed"] = useCallback((id, error) => {
    const decoded = decodeContractError(error);
    /* A user cancelling their own wallet prompt is not a failure worth a red
       banner. The row leaves the tray quietly and nothing is announced. */
    if (decoded.rejected) {
      dispatch({ type: "dismiss", id });
      return;
    }
    dispatch({ type: "settled", id, status: "error", message: decoded.message });
    toast.error(decoded.message);
  }, []);

  const dismiss: TxContextValue["dismiss"] = useCallback((id) => dispatch({ type: "dismiss", id }), []);
  const clearFinished = useCallback(() => dispatch({ type: "clear-finished" }), []);

  const markSettled = useCallback(
    (id: string, status: "success" | "reverted", message?: string) => {
      dispatch({ type: "settled", id, status, ...(message ? { message } : {}) });
    },
    [],
  );

  const pendingCount = transactions.filter(
    (t) => t.status === "signing" || t.status === "pending",
  ).length;

  const value = useMemo<TxContextValue>(
    () => ({ transactions, begin, submitted, failed, dismiss, clearFinished, pendingCount }),
    [transactions, begin, submitted, failed, dismiss, clearFinished, pendingCount],
  );

  return (
    <TxContext.Provider value={value}>
      {children}
      {/* One watcher per pending hash. Mounted here, not in the card that
          started it, so navigating away does not orphan the transaction. */}
      {transactions
        .filter((t) => t.hash && t.status === "pending")
        .map((t) => (
          <ReceiptWatcher key={t.id} tx={t} onSettled={markSettled} />
        ))}
    </TxContext.Provider>
  );
}

/**
 * Renders nothing. Waits for one receipt and reports what it actually says.
 * This is the ONLY place in the codebase that may produce a success toast for
 * a write.
 */
function ReceiptWatcher({
  tx,
  onSettled,
}: {
  tx: TrackedTx;
  onSettled: (id: string, status: "success" | "reverted", message?: string) => void;
}) {
  const queryClient = useQueryClient();
  const receipt = useWaitForTransactionReceipt({
    hash: tx.hash as Hash,
    /* One confirmation is the truth on a local chain. */
    confirmations: 1,
    query: { enabled: Boolean(tx.hash) },
  });

  useEffect(() => {
    if (receipt.isLoading || receipt.fetchStatus === "fetching") return;

    if (receipt.data) {
      /* A receipt exists for reverted transactions too. Check the status. */
      if (receipt.data.status === "success") {
        onSettled(tx.id, "success");
        toast.success(`${tx.label} confirmed`);
        for (const key of tx.invalidate ?? []) {
          void queryClient.invalidateQueries({ queryKey: key });
        }
      } else {
        onSettled(
          tx.id,
          "reverted",
          "The chain rejected this transaction. Gas was spent; nothing else changed.",
        );
        toast.error(`${tx.label} was reverted by the contract`);
      }
      return;
    }

    if (receipt.isError && receipt.error) {
      const decoded = decodeContractError(receipt.error);
      onSettled(tx.id, "reverted", decoded.message);
      toast.error(decoded.message);
    }
  }, [
    receipt.data,
    receipt.isError,
    receipt.error,
    receipt.isLoading,
    receipt.fetchStatus,
    tx.id,
    tx.label,
    tx.invalidate,
    onSettled,
    queryClient,
  ]);

  return null;
}

export function useTxTracker(): TxContextValue {
  const ctx = useContext(TxContext);
  if (!ctx) throw new Error("useTxTracker must be used inside <TxTrackerProvider>");
  return ctx;
}
