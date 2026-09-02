# ---------------------------------------------------------------------------
# NFT auction demonstration: task runner.
#
# Run `make` or `make help` to list the targets.
#
# Windows PowerShell has no `make`. Use the npm mirror instead. Every target
# below has an npm script with the same name:
#
#     make up      ->  npm run up
#     make watch   ->  npm run dev
#
# This file uses `docker compose` (Compose v2). It never uses the archived
# `docker-compose` script.
# ---------------------------------------------------------------------------

COMPOSE      ?= docker compose
COMPOSE_PROD := $(COMPOSE) -f compose.yaml -f compose.prod.yaml
NPM          ?= npm

# A recipe that fails MUST stop the target.
.SHELLFLAGS := -eu -c
.DEFAULT_GOAL := help

.PHONY: help setup up watch down clean logs deploy seed test lint fmt prod smoke reset-chain audit check-actions indexer monitoring full scenario

## ---------------------------------------------------------------------------
## Help
## ---------------------------------------------------------------------------

help: ## Show this help and exit
	@printf '\nNFT auction demonstration\n\n'
	@printf 'Usage: make <target>\n\n'
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  %-14s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@printf '\nFirst run: make setup, then make up.\n'
	@printf 'Windows PowerShell without make: use npm run <target>.\n\n'

## ---------------------------------------------------------------------------
## Set-up
## ---------------------------------------------------------------------------

setup: ## Create .env and install the workspace packages
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		printf 'setup: created .env from .env.example\n'; \
	else \
		printf 'setup: .env already exists, keeping it\n'; \
	fi
	$(NPM) install
	@printf 'setup: done. Run "make up" next.\n'

## ---------------------------------------------------------------------------
## Run
## ---------------------------------------------------------------------------

up: ## Build and start the whole stack in the background
	$(COMPOSE) up -d --build
	@printf '\nStack is starting.\n'
	@printf '  Application: http://127.0.0.1:$${WEB_PORT:-5173}\n'
	@printf '  JSON-RPC:    http://127.0.0.1:$${RPC_PORT:-8545}\n'
	@printf 'Follow the progress with "make logs".\n'

watch: ## Start the stack and copy source changes into the containers
	$(COMPOSE) up --build --watch

# The optional profiles. Each overlay adds services and leaves the base stack
# alone, so `make up` stays a three-container start.
#
# The file list is explicit, which also DISABLES the automatic load of
# compose.override.yaml -- so it is named here on purpose. Dropping it would
# silently start the production web target instead of the Vite dev server.
COMPOSE_INDEXER    := $(COMPOSE) -f compose.yaml -f compose.override.yaml -f compose.indexer.yaml
COMPOSE_MONITORING := $(COMPOSE) -f compose.yaml -f compose.override.yaml -f compose.monitoring.yaml
COMPOSE_FULL       := $(COMPOSE) -f compose.yaml -f compose.override.yaml -f compose.indexer.yaml -f compose.monitoring.yaml

indexer: ## Start the stack with the Ponder indexer (GraphQL at /graphql)
	$(COMPOSE_INDEXER) --profile indexer up -d --build
	@printf '\nIndexer is starting.\n'
	@printf '  GraphQL:  http://127.0.0.1:${WEB_PORT:-5173}/graphql\n'
	@printf '  REST:     http://127.0.0.1:${WEB_PORT:-5173}/api/leaderboard/bidders\n'
	@printf 'It is proxied through nginx, so there is no extra port to open.\n'

monitoring: ## Start the stack with Prometheus and Grafana
	$(COMPOSE_MONITORING) --profile monitoring up -d --build
	@printf '\nMonitoring is starting.\n'
	@printf '  Grafana:    http://127.0.0.1:${GRAFANA_PORT:-3000}  (no login)\n'
	@printf '  Prometheus: http://127.0.0.1:${PROMETHEUS_PORT:-9090}\n'

full: ## Start everything: chain, web, indexer and monitoring
	$(COMPOSE_FULL) --profile indexer --profile monitoring up -d --build

scenario: ## Load a demo scenario. SCENARIO=ending-soon|snipe-in-progress|reserve-not-met|dutch-falling
	@test -n "$(SCENARIO)" || { printf 'scenario: set SCENARIO=<name>, e.g. "make scenario SCENARIO=snipe-in-progress".\n' >&2; exit 1; }
	$(COMPOSE) run --rm --no-deps --entrypoint sh deployer -c 'npx hardhat run scripts/scenarios/$(SCENARIO).ts --network localhost'

prod: ## Build and start the production shape: nginx serves a static bundle
	$(COMPOSE_PROD) up -d --build
	@printf '\nProduction shape is starting on http://127.0.0.1:$${WEB_PORT:-5173}\n'
	@printf 'Read SECURITY.md before you expose this stack.\n'

logs: ## Follow the logs of every service
	$(COMPOSE) logs -f --tail 200

down: ## Stop the stack and remove the containers
	$(COMPOSE) down --remove-orphans

clean: ## Remove containers, volumes, images and local build output
	$(COMPOSE) down --remove-orphans --volumes --rmi local
	rm -rf contracts/artifacts contracts/cache contracts/coverage
	rm -rf web/dist web/node_modules/.vite
	@printf 'clean: done. Run "make up" to rebuild.\n'

reset-chain: ## Discard the chain state and deploy the contracts again
	$(COMPOSE) rm --stop --force --volumes chain deployer web
	$(COMPOSE) up -d --build
	@printf 'reset-chain: the chain is new. Reset the MetaMask account nonce.\n'
	@printf 'reset-chain: MetaMask > Settings > Advanced > Clear activity tab data.\n'

## ---------------------------------------------------------------------------
## Contracts
## ---------------------------------------------------------------------------

deploy: ## Deploy the contracts to the running chain
	$(COMPOSE) run --rm --no-deps -e SEED_DEMO_DATA=false deployer

seed: ## Create the demo auctions on the running chain
	$(COMPOSE) run --rm --no-deps --entrypoint sh deployer -c 'npm run seed --workspace contracts'

## ---------------------------------------------------------------------------
## Quality
## ---------------------------------------------------------------------------

test: ## Run the contract tests and the web tests
	$(NPM) run test

lint: ## Check the code style without changing a file
	$(NPM) run lint

fmt: ## Format the code in place
	$(NPM) run fmt

smoke: ## Check that a running stack answers correctly
	node scripts/smoke.mjs

check-actions: ## Check that every GitHub Action is pinned to a commit SHA
	node scripts/check-action-pins.mjs

audit: ## Run Slither on both contracts and print a before/after comparison
	@mkdir -p docs/audit
	@echo "Analysing the original contract ..."
	@python -m slither contracts/legacy/DecentralizedAuction.sol --solc-solcs-select 0.8.36 --checklist --markdown-root . > docs/audit/slither-before.md 2>/dev/null || true
	@echo "Analysing the current contract ..."
	@python -m slither contracts/src/AuctionHouse.sol --solc-solcs-select 0.8.36 --solc-remaps "@openzeppelin/=node_modules/@openzeppelin/" --checklist --markdown-root . > docs/audit/slither-after.md 2>/dev/null || true
	@echo ""
	@echo "detector impact counts   before  after"
	@for lvl in High Medium Low Informational; do echo "  $$lvl: $$(grep -c ^Impact:.$$lvl docs/audit/slither-before.md 2>/dev/null || true) -> $$(grep -c ^Impact:.$$lvl docs/audit/slither-after.md 2>/dev/null || true)"; done
	@echo ""
	@echo "Reports are in docs/audit/. Git does not track them."
