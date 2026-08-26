# web/ — why these versions

Verified against npm on 2026-08-26. Do not "upgrade" anything on this page
without reading the reason first.

## wagmi is pinned to 2.x, NOT 3.x

`web/package.json` pins:

```json
"wagmi": "2.19.5",
"viem": "2.55.19",
"@rainbow-me/rainbowkit": "2.2.11"
```

wagmi 3.x is the current major. **Do not install it.**

`@rainbow-me/rainbowkit@2.2.11` declares:

```json
"peerDependencies": { "wagmi": "^2.9.0", "viem": "2.x", "react": ">=18", ... }
```

RainbowKit has no v3 support. The failure mode is the dangerous kind: npm's
peer resolution does not hard-fail the install, so `npm i wagmi@3` appears to
work, `npm run build` succeeds, and the app boots. It breaks at RUNTIME, where
RainbowKit reaches into wagmi 2 internals that moved — the wallet modal renders
empty, or the connect button does nothing, with no error in the console loud
enough to point at the cause.

viem stays on 2.x for the same reason: RainbowKit's peer range is `viem: 2.x`,
and wagmi 2.x itself is built against viem 2.

**Unpin only when RainbowKit ships a release whose `peerDependencies.wagmi`
includes 3.** Bump wagmi, viem and RainbowKit together, then run
`npm test` and click the connect button, because no automated test in this
repo can catch an empty wallet modal.

The pin is also asserted in `web/src/app/regressions.test.tsx`, so a stray
`npm i wagmi@latest` fails CI rather than shipping.

## Tailwind is v4, CSS-first

`tailwindcss@4.3.3` + `@tailwindcss/vite@4.3.3`.

There is deliberately **no `tailwind.config.js` and no `postcss.config.js`** in
`web/`. v4 is configured from CSS: the theme tokens live in the `@theme { }`
block in `web/src/styles/theme.css`, and Tailwind is wired through the Vite
plugin rather than through PostCSS.

Adding either config file back would be silently ignored by v4 and would
mislead the next person. `regressions.test.tsx` asserts neither exists.

## Everything else

| Package | Version | Note |
| --- | --- | --- |
| vite | 8.2.2 | Uses rolldown, which needs a **64-bit** Node — see below |
| react / react-dom | 19.2.8 | |
| typescript | 5.9.3 | `strict` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` |
| @tanstack/react-query | 5.102.5 | Owns all chain data |
| vitest | 4.1.11 | Also needs the rolldown binding |
| @playwright/test | 1.62.1 | Browsers are **not** downloaded on install; run `npx playwright install chromium` |
| react-hook-form + zod | 7.86.0 / 4.4.3 | Create-listing validation, mirrored from the contract |
| @radix-ui/react-dialog | 1.1.23 | Real modal: focus trap, Escape, focus return |
| sonner | 2.0.8 | Exactly one `<Toaster />`, at the root |

### 64-bit Node is required

Vite 8 and Vitest 4 both load `rolldown`, which ships native bindings only for
64-bit platforms. On a 32-bit Node (`process.arch === "ia32"`) there is no
binding to load, and the WASM fallback cannot start either: it asks for a 1 GiB
initial `WebAssembly.Memory`, which a 32-bit process cannot reserve.

Symptom:

```
Error: Cannot find native binding.
  cause: Error: Cannot find module '@rolldown/binding-win32-ia32-msvc'
```

Fix: install the x64 build of Node 22 (`node -p "process.arch"` must print
`x64`), delete `node_modules`, and reinstall. `engines.node` in
`web/package.json` records the floor, but npm does not check architecture, so
this note is the only warning you get.
