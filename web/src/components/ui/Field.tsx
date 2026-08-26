import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A labelled form control, wired the way WCAG requires and the old app did not:
 *
 *   SC 1.3.1 / 4.1.2  every control has a <label for> pointing at a real id.
 *   SC 3.3.2          helper text is linked with aria-describedby, so it is
 *                     announced with the field, not stranded next to it.
 *   SC 3.3.1          an error sets aria-invalid AND is announced by an alert
 *                     that is also in aria-describedby, so the message reaches
 *                     the user whether they are tabbing or reading.
 *   SC 1.4.1          the error is text and an icon-free "Error:" prefix, not
 *                     a red outline alone.
 *
 * The ids are generated with useId so two instances on a page cannot collide,
 * which is what broke the old form when two cards were open at once.
 */

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  /** Persistent helper text. Always announced with the field. */
  hint?: ReactNode;
  /** Present => invalid. */
  error?: string | undefined;
  /** Trailing unit shown inside the control, e.g. ETH. Decorative. */
  suffix?: string;
  /** Visually hides the label but keeps it for assistive tech. */
  labelHidden?: boolean;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, hint, error, suffix, labelHidden, className, required, ...rest },
  ref,
) {
  const uid = useId();
  const inputId = `field-${uid}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={inputId}
        className={cn(
          "text-[0.8125rem] font-medium text-[var(--color-ink-2)]",
          labelHidden && "sr-only",
        )}
      >
        {label}
        {required ? (
          <>
            {" "}
            <span className="text-[var(--color-danger)]" aria-hidden="true">
              *
            </span>
            <span className="sr-only">(required)</span>
          </>
        ) : null}
      </label>

      <div
        className={cn(
          "flex items-center rounded-[3px] border bg-[var(--color-ground)]",
          "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--color-action)]",
          error ? "border-[var(--color-danger)]" : "border-[var(--color-line-strong)]",
        )}
      >
        <input
          {...rest}
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "tnum h-11 w-full min-w-0 bg-transparent px-3 text-sm text-[var(--color-ink)]",
            "placeholder:text-[var(--color-ink-3)] focus:outline-none",
            className,
          )}
        />
        {suffix ? (
          <span
            aria-hidden="true"
            className="shrink-0 border-l border-[var(--color-line)] px-3 py-2 text-[0.75rem] font-medium tracking-wide text-[var(--color-ink-3)] uppercase"
          >
            {suffix}
          </span>
        ) : null}
      </div>

      {hint ? (
        <p id={hintId} className="text-[0.75rem] leading-relaxed text-[var(--color-ink-3)]">
          {hint}
        </p>
      ) : null}

      {error ? (
        /* role="alert" => assertive live region. It is inside the field group
           and referenced by aria-describedby, so it is announced on focus too. */
        <p
          id={errorId}
          role="alert"
          className="flex gap-1.5 text-[0.75rem] leading-relaxed text-[var(--color-danger)]"
        >
          <span className="font-semibold">Error:</span>
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
});
