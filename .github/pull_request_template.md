## What

<!-- Short description. Link the Multica issue (e.g. DEAR-12) and TDD task id (B-x / M-x / F-x). -->

## Definition of Done (TDD §8.7)

- [ ] Matches `docs/api/openapi.yaml` (contract changes go to `docs/api` first, reviewed by Tech Lead)
- [ ] Tests added/updated (money, shift and state-machine logic covered by unit tests)
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass locally
- [ ] No secrets, tokens or passwords in code, logs or fixtures
- [ ] CI green, then Multica issue moved to `In Review` and assigned to Tech Lead with a comment containing this PR link, summary and test steps (TDD §8.8, ADR-0013)

## How to verify

<!-- Commands, screenshots or mock requests -->
