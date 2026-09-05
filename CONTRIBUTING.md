# How to contribute

Thank you for your interest in this project.

This document uses RFC 2119 keywords. **MUST** is a rule. **SHOULD** is a
strong recommendation. **MAY** is a choice.

## What you need

| Tool           | Version                 | Why                                                               |
| -------------- | ----------------------- | ----------------------------------------------------------------- |
| Docker Desktop | 4.30 or later           | Runs the stack                                                    |
| Docker Compose | v2.24 or later          | This project uses the `!override` tag                             |
| Node           | 22 or later, **64-bit** | Hardhat 3 needs Node 22. Vite 8 and Vitest 4 need a 64-bit build. |
| Git            | 2.40 or later           | Line ending rules                                                 |

`make` is optional. Windows PowerShell has no `make`. Every Makefile target
has an npm script with the same name.

### Node MUST be 64-bit

Run `node -p "process.arch"`. It MUST print `x64`. Vite 8 and Vitest 4 load
`rolldown`, which ships native bindings only for 64-bit platforms. A 32-bit
Node has no binding to load, and the fallback cannot start either. The install
does not fail with a clear message about this, so check the architecture
before you report a build problem. See
[docs/WEB_DEPENDENCIES.md](docs/WEB_DEPENDENCIES.md) for the full explanation
and the exact error text.

## First run

```bash
git clone https://github.com/prpawan03/decentralised_auction.git
cd decentralised_auction
make setup      # or: npm run setup
make up         # or: npm run up
```

Open `http://127.0.0.1:5173`.

`make setup` copies `.env.example` to `.env`. The command never replaces an
existing `.env`.

## Daily commands

| Make               | npm                   | What it does                                     |
| ------------------ | --------------------- | ------------------------------------------------ |
| `make help`        | `npm run help`        | Lists every command                              |
| `make up`          | `npm run up`          | Builds and starts the stack                      |
| `make watch`       | `npm run dev`         | Starts the stack and copies your changes into it |
| `make logs`        | `npm run logs`        | Follows the logs                                 |
| `make down`        | `npm run down`        | Stops the stack                                  |
| `make test`        | `npm test`            | Runs every test                                  |
| `make lint`        | `npm run lint`        | Checks the code style                            |
| `make fmt`         | `npm run fmt`         | Formats the code                                 |
| `make smoke`       | `npm run smoke`       | Checks that a running stack answers              |
| `make reset-chain` | `npm run reset-chain` | Discards the chain state                         |
| `make clean`       | `npm run clean`       | Removes containers, volumes and images           |

## How the stack starts

Three services start in a fixed order:

1. `chain` starts. Compose waits until the health probe passes.
2. `deployer` starts. It deploys the contracts, it seeds the demo data, and
   then it exits with code 0.
3. `web` starts, but only after `deployer` exited with code 0.

Step 3 uses `depends_on: deployer: condition: service_completed_successfully`.
The user interface therefore never starts before the contracts exist.

A failed deployment stops the whole start-up. This is correct behaviour. A
broken deployment **MUST NOT** produce a running user interface.

## Where each thing lives

| Path            | Owner          | Holds                               |
| --------------- | -------------- | ----------------------------------- |
| `contracts/`    | Contract work  | Solidity, tests, deployment scripts |
| `web/`          | Interface work | React, Vite, TypeScript             |
| `docker/`       | Platform work  | Dockerfiles, nginx, entry points    |
| `scripts/`      | Platform work  | Node helper scripts                 |
| `compose*.yaml` | Platform work  | Service definitions                 |
| `.github/`      | Platform work  | CI and templates                    |

## Rules for a change

### Line endings

A shell script **MUST** use LF. A Linux container cannot run a script that
has CRLF line endings. The error message is confusing, because the shell
reports that the interpreter is missing.

`.gitattributes` enforces this. You **MUST NOT** turn that rule off.

Every Dockerfile also runs `chmod +x` on the scripts that it copies. Git on
Windows does not keep the executable bit, so the Dockerfile sets it.

### Dependencies

You **MUST** use `npm ci` and not `npm install` inside a Dockerfile. `npm ci`
installs the exact versions from the lock file. `npm install` MAY change the
lock file, and a build that changes its own input is not repeatable.

You **MUST** commit `package-lock.json` with any dependency change.

### Containers

You **MUST NOT** add a bind mount for source code. The repository often sits
on a Windows path, and a bind mount from there is slow and it loses file
change events. Use `develop: watch:` in `compose.override.yaml` instead.

You **MUST NOT** add an anonymous `node_modules` volume. Such a volume hides
what the image installed, and it then goes stale.

You **MUST NOT** publish a port on `0.0.0.0`. Every published port **MUST**
carry the `127.0.0.1:` prefix. Read SECURITY.md for the reason.

You **MUST NOT** add Ganache. You **MUST NOT** add Truffle. Both are archived
software.

### The contract address

The contract address reaches the browser at run time and not at build time.
`docker/web-entrypoint.d/10-runtime-config.sh` writes `config.js`, and that
file sets `window.__AUCTION_CONFIG__`.

The web code **MUST** read `window.__AUCTION_CONFIG__` first, and it **MUST**
fall back to `import.meta.env`. The Vite development server does not run the
nginx entry point, so the fallback is the development path.

You **MUST NOT** bake an address into the bundle. A baked address needs a new
image after every chain reset.

The exact shape is documented at the top of
`docker/web-entrypoint.d/10-runtime-config.sh`.

### The contract interface

`docs/CONTRACT_INTERFACE.md` is the single source of truth for the on-chain
API. You **MUST NOT** change a signature there without telling both the
contract side and the web side.

### The generated ABI

`web/src/abi/` is generated from the compiled contracts. Do not edit it by
hand.

When you change a contract, you **MUST** run this command and commit the
result in the same pull request:

```bash
npm run export-abi --workspace contracts
```

CI runs the same command and fails the build if the committed ABI does not
match the compiled contracts.

## Pre-commit hooks

The repository ships two hook sets. Install them once after `npm ci`:

```bash
pip install pre-commit
pre-commit install --hook-type pre-commit --hook-type commit-msg --hook-type pre-push
```

`.pre-commit-config.yaml` runs on every commit. It checks whitespace, line
endings, YAML, JSON and TOML syntax, merge markers, large files, private keys
and AWS credentials, then runs prettier, solhint, the web typecheck and the
GitHub Actions pin check on the files you changed. It also refuses a direct
commit to `main`, and `commitizen` checks that the message follows
Conventional Commits. Run everything by hand with:

```bash
pre-commit run --all-files
```

`.code-analysis-precommit.yaml` holds the heavier scanners: detect-secrets,
gitleaks and semgrep. CI runs them on every pull request and publishes the log
as an artifact. To run them locally you need Linux or macOS and a Go
toolchain, or the container images the workflow names:

```bash
pre-commit run --config .code-analysis-precommit.yaml --all-files
```

Two files carry deliberate allowances. `.gitleaks.toml` and the
`detect-private-key` exclusion allow the public Hardhat test key and mnemonic
in `.env.example`; anything else that looks like a key MUST be reported.
`.secrets.baseline` records reviewed detect-secrets findings; regenerate it
with `detect-secrets scan > .secrets.baseline` when a new false positive
appears, and read the diff before you commit it.

## Quality gates

CI runs these gates. A gate that fails blocks the merge.

| Gate               | Rule                                                 |
| ------------------ | ---------------------------------------------------- |
| solhint            | No error                                             |
| Contract tests     | Every test passes                                    |
| Contract coverage  | Line coverage is 80% or more                         |
| ABI freshness      | The committed ABI matches the compiled contracts     |
| Web lint           | No error                                             |
| Type check         | `tsc --noEmit` reports no error                      |
| Web tests          | Every test passes                                    |
| Bundle size        | Below the ceiling in `scripts/check-bundle-size.mjs` |
| Slither            | The report reaches the security tab                  |
| Trivy              | No fixable CRITICAL problem in an image              |
| Compose smoke test | The chain answers, bytecode exists, the page serves  |

Run the same gates before you push:

```bash
npm run lint
npm test
npm run fmt:check
npm run compose:config
```

You **MAY** raise a size ceiling. You **MUST** give the reason in the pull
request.

## Commit messages

Use Conventional Commits.

```
feat(contracts): add an anti-snipe extension to bid()
fix(web): read the address from window.__AUCTION_CONFIG__
chore(docker): move the chain image to node 24
docs(security): explain why the test keys are public
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `ci`.

Scopes: `contracts`, `web`, `docker`, `ci`, `docs`.

## Pull requests

1. Branch from `main`.
2. Make the change.
3. Run the gates above.
4. Open the pull request and fill in the template.
5. Wait for CI to pass.

A pull request **SHOULD** change one thing. A small pull request is reviewed
faster than a large one.

A pull request that changes a contract **MUST** add a test for the new
behaviour.

## Writing style for documentation

Every document in this repository follows ASD-STE100 simplified technical
English:

- Write short sentences.
- Write one instruction in one sentence.
- Use the active voice.
- Do not use an idiom.
- Use the same word for the same thing every time.

Use RFC 2119 keywords for a requirement. Write a date in ISO 8601 format,
which is `YYYY-MM-DD`.

## If something breaks

| Problem                                 | Cause                                 | Fix                                                   |
| --------------------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `deployer` exits with a non-zero code   | The chain state and `.env` disagree   | `make reset-chain`                                    |
| MetaMask reports a wrong nonce          | The chain restarted                   | MetaMask, Settings, Advanced, Clear activity tab data |
| The page shows no auction               | The address did not reach the browser | Open `http://127.0.0.1:5173/config.js` and read it    |
| `docker compose` reports an unknown tag | Compose is older than v2.24           | Update Docker Desktop                                 |
| A container reports "exec format error" | A script has CRLF line endings        | Check `.gitattributes`, then clone again              |

Read the logs first:

```bash
make logs
```

## Licence

This project uses the MIT licence. Your contribution uses the same licence.
