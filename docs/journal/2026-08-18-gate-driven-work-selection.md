# Gate-driven Work Selection for Autonomous Sessions

## What changed and why

Updated work selection directives in `AGENTS.md` §5, `.github/workflows/jules-scheduled-session.yml`, and `.github/workflows/opencode-audit.yml` to require autonomous engineering sessions to select work based on the v1.0 gate conditions in `docs/GATE.md` (addressing issue #58).

Previously, sessions selected work by priority (`p1` before `p2` before `p3`) without reference to what would advance the product toward v1.0 readiness. This resulted in sessions working on peripheral documentation and test refactoring rather than feature implementation and gate closure.

Work selection now explicitly follows these steps:
1. Read `docs/GATE.md` to review the status of the ten v1.0 gate conditions.
2. Identify the gate condition closest to green (fewest missing pieces).
3. Select the `ready` issue that closes part of that condition (`p1` before `p2` before `p3`).
4. State in the pull request body which gate condition is being moved and by how much.
5. If no issue serves the nearest gate condition, specify one from `docs/ROADMAP-V1.md` Part 2 per `docs/SPECIFYING.md`.

## Verification

Verified that `AGENTS.md` §5 and the workflow default prompts in `jules-scheduled-session.yml` and `opencode-audit.yml` accurately convey the gate-driven selection logic. Verified with `npm test` that all codebase integrity and hygiene checks pass.
