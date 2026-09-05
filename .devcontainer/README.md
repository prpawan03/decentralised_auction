# Dev container

A one-click development environment for the NFT auction demonstration: Node 24,
the Docker CLI wired to your **host** daemon, and the editor extensions the
repository actually uses. It exists so that "clone it and run it" is one button
instead of a page of prerequisites.

---

## Open it in GitHub Codespaces

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/prpawan03/decentralised_auction)

Markdown for the badge (the Codespaces URL is path-based — `codespaces.new/OWNER/REPO`):

```markdown
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/prpawan03/decentralised_auction)
```

To open a specific branch, append a query parameter:
`https://codespaces.new/prpawan03/decentralised_auction?ref=dev`

Once the Codespace is up:

```sh
make up      # or: npm run up
```

Then open the **Auction UI** entry in the **PORTS** panel. Give it a minute the
first time — Compose is building three images.

> **Note on wallets.** Codespaces forwards ports over an HTTPS tunnel, so the
> browser extension wallet in _your_ browser talks to the tunnelled RPC, not to
> `127.0.0.1:8545` on the VM. Forwarded ports are **private** by default; you
> must be signed in to GitHub in the same browser for them to resolve. Set a
> port to public with `gh codespace ports visibility 8545:public` only if you
> understand that this exposes an RPC node whose accounts are funded and whose
> private keys are published in `.env.example`. It is a throwaway local chain,
> but it is still an open RPC endpoint.

---

## Open it locally in VS Code

**Prerequisites:** Docker Desktop (or any Docker Engine ≥ 24) running, VS Code,
and the [Dev Containers extension][devcontainers-ext].

1. Clone the repository and open the folder in VS Code.
2. Command Palette → **Dev Containers: Reopen in Container**.
3. Wait for `post-create.sh` to finish — it creates `.env` and runs `npm ci`.
   The editor does not attach until it is done (`"waitFor": "postCreateCommand"`),
   so you never get a wall of phantom TypeScript errors against an empty
   `node_modules`.
4. `make up`, then open <http://127.0.0.1:5173>.

You can also do the same from the CLI with the [devcontainer CLI][devcontainer-cli]:

```sh
devcontainer up --workspace-folder .
```

Everything works exactly as it does outside the container. `make up`,
`make down`, `make watch`, the optional profiles and the `deployer` gate all
behave identically — that is the whole design goal (see below).

[devcontainers-ext]: https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers
[devcontainer-cli]: https://github.com/devcontainers/cli

---

## Ports

| Port   | Label      | What it is                            | Auto-forward | Started by        |
| ------ | ---------- | ------------------------------------- | ------------ | ----------------- |
| `5173` | Auction UI | Vite dev server in dev, nginx in prod | `notify`     | `make up`         |
| `8545` | JSON-RPC   | Hardhat 3 chain, chain id `31337`     | `silent`     | `make up`         |
| `3000` | Grafana    | Dashboards, no login required         | `silent`     | `make monitoring` |
| `9090` | Prometheus | Metrics scraper and query UI          | `silent`     | `make monitoring` |

Only the UI raises a notification. The other three are machine-facing or belong
to opt-in profiles, so announcing them on every `make up` would be noise.

Two things worth knowing:

- **The host port for the UI is 5173 in both modes.** In development
  `compose.override.yaml` maps `5173 → 5173` (Vite); in production
  `compose.yaml` maps `5173 → 8080` (nginx). The URL in your browser never
  changes.
- **The indexer has no port of its own.** `compose.indexer.yaml` proxies Ponder
  through nginx, so after `make indexer` the GraphQL endpoint is
  `http://127.0.0.1:5173/graphql` and the REST endpoints are under
  `http://127.0.0.1:5173/api/…`.

### Reaching the stack _from inside_ the dev container

`compose.yaml` publishes on the host's loopback (`127.0.0.1:5173:8080` and so
on) — a deliberate security choice, because the chain's accounts are funded and
their keys are public. The dev container is a _sibling_ container, so its own
`127.0.0.1` is not the host's. For scripted checks from a terminal in here, use
the alias the dev container adds:

```sh
curl -s http://host.docker.internal:5173/healthz
curl -s -X POST http://host.docker.internal:8545 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```

Your browser is unaffected — it uses the forwarded ports and `127.0.0.1` is
correct there.

---

## Why `docker-outside-of-docker` and not `docker-in-docker`

The dev container mounts the **host's** `/var/run/docker.sock` and installs only
the Docker CLI. Every `docker` and `docker compose` command you run inside the
container is executed by the **host daemon**, so `chain`, `deployer`, `web`,
and the optional `indexer` / `monitoring` services come up as _siblings_ of the
dev container, not as children of it.

Docker-in-Docker would instead start a **nested daemon** inside this container.
That breaks the stack in four separate ways:

1. **Port forwarding stops working.** The stack would run in a network
   namespace nested one level deeper than the one VS Code and Codespaces watch
   for listening sockets. Nothing reaches your browser.
2. **The build cache is thrown away.** The nested daemon has no access to the
   host's layers, so every `make up` rebuilds the Node images from scratch.
3. **Images and volumes are invisible from the host.** `docker ps` on your
   laptop shows nothing; cleanup tools cannot see what to clean.
4. **It needs a privileged container** and generally more memory, for no
   benefit here.

The dev container's job is to _drive_ the existing Compose stack, not to host a
private copy of it. Docker-outside-of-docker is the option that matches that
job.

## Why a standalone dev box and not a Compose service

`devcontainer.json` supports two flavours: a standalone `image`/`build`
container, or `dockerComposeFile`, which makes the dev container one of the
services in `compose.yaml`. This repository uses the **standalone** flavour.

- **One mental model.** `make up` means the same thing on a laptop, in the dev
  container, and in CI. Under the Compose flavour, the editor itself becomes a
  member of `docker compose ps`, so `make down` would try to stop the machine
  you are typing in.
- **No duplicated startup contract.** The stack already encodes its ordering
  once — `web` waits for `deployer` to exit `0`, and the extra services live
  behind the `indexer` and `monitoring` profiles. The Compose flavour needs
  `runServices` to list what to start, which is a second, drift-prone copy of
  that graph. (It also **defaults to every service in the file**, so Codespaces
  would start the whole monitoring overlay on every create unless you set it.)
- **No bind mount to fight.** `compose.override.yaml` documents why there is
  deliberately no bind mount into the app containers — it uses `develop: watch:`
  to copy changed files in over the Docker API instead. The Compose flavour
  would reintroduce exactly the filesystem boundary that decision avoids.

---

## Files here

| File                | Purpose                                                                       |
| ------------------- | ----------------------------------------------------------------------------- |
| `devcontainer.json` | Image, features, ports, extensions and settings. JSONC — comments allowed.    |
| `post-create.sh`    | Runs once on create: `.env` from `.env.example`, `npm ci`, next-steps banner. |
| `README.md`         | This file.                                                                    |

`post-create.sh` mirrors `make setup`. If you change one, change the other.

---

## Prebuilds — the honest version

[Codespaces prebuilds][prebuilds] cache the container image and the `npm ci`
result, turning a two-to-three minute create into roughly twenty seconds. They
are genuinely nice. They are also not free:

- **Prebuild storage is billed**, including for **public** repositories. The
  free Codespaces allowance covers core-hours and storage for _your_ Codespaces;
  a repository's prebuild storage is billed to the repository owner. A prebuild
  is regenerated on every push to the configured branch by default, and each
  region you target stores its own copy.
- **Organisation-owned repositories need a GitHub Team or Enterprise plan** to
  configure prebuilds at all.
- The Actions minutes that generate the prebuild are billed too.

This repository therefore **does not** ship a prebuild configuration. A cold
create here is a couple of minutes, which is a reasonable trade for a demo
project. If you fork it and want prebuilds, enable them under
**Settings → Codespaces → Set up prebuild** and check the storage cost against
your plan first.

[prebuilds]: https://docs.github.com/en/codespaces/prebuilding-your-codespaces/about-github-codespaces-prebuilds

---

## Troubleshooting

**`docker: command not found` or "the daemon did not answer"**
`post-create.sh` prints this as a warning rather than failing the build, so you
still get a usable terminal. Locally, check Docker Desktop is running. In a
Codespace, rebuild the container (Command Palette → **Dev Containers: Rebuild
Container**) so the `docker` group membership is re-applied.

**The UI port never appears**
The `web` service will not start until `deployer` exits `0` — that gate is
intentional; a failed deployment must not produce a running UI. Run
`make logs` and look at the `deployer` output.

**Nothing is listening on `127.0.0.1:5173` inside the container shell**
Expected. See _Reaching the stack from inside the dev container_ above; use
`host.docker.internal`.

**Playwright says browsers are missing**
The image does not ship them, because they are ~400 MB and most sessions never
run E2E. Install on demand:
`npx playwright install --with-deps chromium`.
