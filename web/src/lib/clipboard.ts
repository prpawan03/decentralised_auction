/**
 * Copy to clipboard with a working fallback.
 *
 * `navigator.clipboard` only exists in a secure context. This app is served
 * over plain http on a LAN address during a demo (http://192.168.1.x:5173),
 * which is NOT a secure context, so the modern API is simply undefined there.
 * The old app called it unconditionally and the copy button was dead on every
 * machine except the presenter's laptop.
 *
 * Returns true on success so the caller can announce the result rather than
 * assuming it.
 */
export async function copyText(text: string): Promise<boolean> {
  /* 1. The real API, where it exists and is permitted. */
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* Permission denied or a detached document: fall through. */
    }
  }

  /* 2. execCommand on an off-screen textarea. Deprecated, still universally
        implemented, and the only thing that works over plain http. */
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.tabIndex = -1;
  /* Off-screen, not display:none — a hidden element cannot be selected.
     Keep it in the viewport vertically so iOS does not scroll the page. */
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "-9999px";
  ta.style.opacity = "0";

  const active = document.activeElement as HTMLElement | null;
  document.body.appendChild(ta);

  try {
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    return ok;
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
    /* SC 3.2.1 On Focus: put focus back where the user left it. */
    active?.focus?.();
  }
}
