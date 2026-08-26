# Security policy

## Read this first

This project is a **local demonstration**. It is **not** a product.

- The contracts are **NOT audited**. No third party reviewed them.
- The chain runs on your own machine. It is not a public network.
- The private keys in `.env.example` are **public**. They hold no value.

You **MUST NOT** deploy this code to a public network. You **MUST NOT** send
real money to any address that this project creates.

## The keys in `.env.example` are public on purpose

`.env.example` holds this mnemonic:

```
test test test test test test test test test test test junk
```

Every Ethereum development tool uses this mnemonic. It is written in public
documentation. Millions of people know it.

It also holds the private key of account 0 of that mnemonic:

```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

That address is `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`.

These values are in the repository **on purpose**:

1. The accounts exist only on your local chain.
2. The ETH on that chain is created by the chain itself. It has no value.
3. A shared, known mnemonic gives every developer the same account list and
   the same contract addresses. A demonstration then works the same for
   everybody.

**A secret scanner MAY report these keys. That report is a false positive.**

You **MUST NOT** send real money to any of these addresses. Anybody can take
it at once, because everybody has the key.

You **MUST NOT** put a real private key in `.env`. Nothing in this project
needs one.

## What the stack exposes

| Port | Bound to | Service | Risk |
| --- | --- | --- | --- |
| 8545 | `127.0.0.1` only | JSON-RPC chain | Funded accounts, public keys |
| 5173 | `127.0.0.1` only | Web application | None beyond a static page |

Both ports are bound to `127.0.0.1`. Only your own machine can reach them.

The `127.0.0.1` prefix in `compose.yaml` is a security control. A bind to
`0.0.0.0` would offer a funded and unlocked RPC node to every device on the
local network. You **MUST NOT** remove that prefix.

You **MUST NOT** put this stack behind a public address, a tunnel, or a port
forward.

## Hardening that the stack already applies

| Control | Where |
| --- | --- |
| Non-root user in every image | `docker/*.Dockerfile` |
| `no-new-privileges:true` | `compose.yaml` |
| `cap_drop: ALL` | `compose.yaml` |
| Read-only root file system for `chain` and `web` | `compose.yaml` |
| tmpfs instead of a writable image layer | `compose.yaml` |
| CPU and memory limits | `compose.yaml` |
| Log rotation | `compose.yaml` |
| Loopback-only port publishing | `compose.yaml` |
| Pinned base image versions | `docker/*.Dockerfile` |
| `npm ci` against a lock file | `docker/*.Dockerfile` |

## Automatic checks

| Check | Tool | Where |
| --- | --- | --- |
| Solidity static analysis | Slither | `.github/workflows/ci.yml` |
| JavaScript and TypeScript analysis | CodeQL | `.github/workflows/codeql.yml` |
| Container image scan | Trivy | `.github/workflows/ci.yml` |
| Dependency updates | Dependabot | `.github/dependabot.yml` |

A CRITICAL problem that has a known fix fails the build.

## How to report a problem

Report a problem that affects **this code**, not a problem in a dependency.
Report a dependency problem to that project.

1. You **MUST NOT** open a public issue for a problem that lets somebody take
   funds or take control.
2. Use the private reporting form: the **Security** tab, then
   **Report a vulnerability**.
3. Write these things:
   - What the problem is.
   - The steps that show it.
   - What an attacker gains.
   - The commit hash that you tested.

You **SHOULD** get a first answer in 7 days.

Because this project is a local demonstration with no users and no funds, a
report is treated as a **bug report** and not as an incident. There is no
reward programme.

### What is not a security problem here

- The public test keys in `.env.example`. See above.
- The `pause()` function. `withdraw()` and `settle()` stay callable while the
  contract is paused. This is deliberate. See `docs/CONTRACT_INTERFACE.md`.
- An open RPC port on `127.0.0.1`. Only your own machine can reach it.

## Supported versions

Only the newest commit on `main` is supported. There is no release branch and
there is no backport.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Any older commit | No |
