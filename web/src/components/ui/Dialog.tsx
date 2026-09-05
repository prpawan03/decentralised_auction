import * as RadixDialog from "@radix-ui/react-dialog";
import { useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";

/**
 * A real modal dialog.
 *
 * The app it replaces collected a bid with the browser's built-in prompt()
 * dialog. That is not a real dialog: it cannot be styled, cannot show a validation error,
 * cannot show a gas estimate, cannot be tested, and on several browsers is
 * suppressed entirely — which silently dropped the bid.
 *
 * Radix gives us, for free and correctly:
 *   role="dialog" aria-modal="true"        SC 4.1.2
 *   a focus trap while open                SC 2.1.2 No Keyboard Trap (the
 *                                          escape route being Escape/Close)
 *   Escape to dismiss
 *   focus returned to the trigger on close SC 3.2.1 / 2.4.3 Focus Order
 *   aria-hidden on the rest of the page
 *   scroll lock
 *
 * `aria-labelledby` and `aria-describedby` are wired by <Dialog.Title> and
 * <Dialog.Description>; both are REQUIRED here rather than optional, because a
 * dialog with no accessible name is a 4.1.2 failure and Radix only warns.
 */

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Announced with the dialog. Say what this dialog is for, in one line. */
  description: string;
  children: ReactNode;
  /** The row of actions pinned to the bottom. */
  footer?: ReactNode;
  /** Blocks Escape and outside-click while a wallet prompt is open. */
  dismissable?: boolean;
  /** Where focus goes on close. Defaults to whatever was focused when it opened. */
  returnFocusTo?: RefObject<HTMLElement | null>;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  dismissable = true,
  returnFocusTo,
}: DialogProps) {
  /* Radix restores focus to its own Trigger. Every opener in this app is a
     plain button that flips `open`, so there is no Trigger and focus fell to
     <body> on Escape (SC 2.4.3). Remember what was focused as the dialog
     opens, before Radix moves focus inside it, and put it back on close. */
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current && typeof document !== "undefined") {
    openerRef.current = document.activeElement as HTMLElement | null;
  }
  wasOpenRef.current = open;

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--color-ground)_82%,transparent)]",
            "backdrop-blur-none", // deliberately NOT glassmorphism
          )}
        />
        <RadixDialog.Content
          /* Radix stopped emitting aria-modal in 1.1.x, relying on inert
             siblings instead. Several screen readers still key off the
             attribute, and SC 4.1.2 is cheap to satisfy explicitly. */
          aria-modal="true"
          onCloseAutoFocus={(e) => {
            const target = returnFocusTo?.current ?? openerRef.current;
            if (target && document.contains(target)) {
              e.preventDefault();
              target.focus();
            }
          }}
          {...(dismissable
            ? {}
            : {
                /* While a wallet prompt is open, closing the dialog underneath
                   it would strand the pending transaction with no UI. */
                onEscapeKeyDown: (e: KeyboardEvent) => e.preventDefault(),
                onPointerDownOutside: (e: Event) => e.preventDefault(),
                onInteractOutside: (e: Event) => e.preventDefault(),
              })}
          className={cn(
            "fixed top-1/2 left-1/2 z-50 w-[min(32rem,calc(100vw-2rem))]",
            "-translate-x-1/2 -translate-y-1/2",
            "max-h-[calc(100dvh-2rem)] overflow-y-auto",
            "rounded-[4px] border border-[var(--color-line-strong)] bg-[var(--color-surface)]",
          )}
        >
          <header className="flex items-start justify-between gap-4 border-b border-[var(--color-line)] px-5 py-4">
            <div className="min-w-0">
              <RadixDialog.Title className="text-base font-semibold text-[var(--color-ink)]">
                {title}
              </RadixDialog.Title>
              <RadixDialog.Description className="mt-1 text-[0.8125rem] text-[var(--color-ink-3)]">
                {description}
              </RadixDialog.Description>
            </div>
            {dismissable ? (
              <RadixDialog.Close
                className={cn(
                  "tap -mt-1 -mr-1 flex h-9 w-9 shrink-0 items-center justify-center",
                  "rounded-[3px] border border-transparent text-[var(--color-ink-3)]",
                  "hover:border-[var(--color-line-strong)] hover:text-[var(--color-ink)]",
                )}
              >
                {/* Named for assistive tech; the glyph is decorative. */}
                <span aria-hidden="true" className="text-lg leading-none">
                  ×
                </span>
                <span className="sr-only">Close dialog</span>
              </RadixDialog.Close>
            ) : null}
          </header>

          <div className="px-5 py-4">{children}</div>

          {footer ? (
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-line)] bg-[var(--color-raised)] px-5 py-3">
              {footer}
            </footer>
          ) : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;
