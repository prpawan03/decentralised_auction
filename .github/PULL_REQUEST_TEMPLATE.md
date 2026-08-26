# Pull request

## What does this change?

<!-- Write one or two sentences. Say what changes and why. -->

## Which type is it?

<!-- Mark one box with an x. -->

- [ ] `feat` — new behaviour
- [ ] `fix` — corrects a fault
- [ ] `docs` — documentation only
- [ ] `chore` — build, tooling or dependency
- [ ] `refactor` — same behaviour, different code
- [ ] `test` — test only
- [ ] `ci` — pipeline only

## Which part does it touch?

- [ ] `contracts/` — Solidity
- [ ] `web/` — user interface
- [ ] `docker/`, `compose*.yaml` — containers
- [ ] `.github/` — CI
- [ ] Documentation

## Related issue

<!-- Write "Closes #123", or write "None". -->

## How did you test it?

<!-- Write the commands that you ran. Write what you saw. -->

```
```

## Checklist

Mark a box only when the item is true.

### Every pull request

- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] `npm run fmt:check` passes.
- [ ] `npm run compose:config` passes.
- [ ] The commit message follows Conventional Commits.
- [ ] The new prose follows ASD-STE100: short sentences and active voice.

### A change to a contract

- [ ] A test covers the new behaviour.
- [ ] Line coverage stays at 80% or more.
- [ ] `docs/CONTRACT_INTERFACE.md` matches the code.
- [ ] The ABI that the web workspace uses is fresh.
- [ ] The change does not break an invariant in `docs/CONTRACT_INTERFACE.md`.

### A change to the containers

- [ ] Every published port keeps the `127.0.0.1:` prefix.
- [ ] Every Dockerfile uses `npm ci` and not `npm install`.
- [ ] No bind mount for source code was added.
- [ ] No anonymous `node_modules` volume was added.
- [ ] Every new shell script uses LF line endings.
- [ ] Every new shell script gets `chmod +x` in its Dockerfile.
- [ ] `docker compose config` parses for both file sets.
- [ ] `npm run smoke` passes against a running stack.

### A change to the runtime configuration

- [ ] `docker/web-entrypoint.d/10-runtime-config.sh` and the web reader agree.
- [ ] The `import.meta.env` fallback still works in `npm run dev`.
- [ ] No address is baked into the bundle.

## Anything a reviewer should know

<!-- Name a trade-off, a known limit, or a follow-up. Write "None" if there
     is nothing. -->
