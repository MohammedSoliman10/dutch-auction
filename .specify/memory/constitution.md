<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0 (MINOR — a conditional exception was added to an
  existing normative rule; the underlying pull-payment preference is retained and
  no principle was removed or removed-scope redefined)
- Modified principles: Toolchain & Safety Constraints — pull-payment preference
  amended with a conditioned exception for atomic single-transaction settlement
  (driver: spec FR-012/SC-003 same-transaction receipt; mandated mitigations:
  CEI ordering, reentrancy guard, fixed recipients, fuzz + invariant coverage)
- Added sections: none
- Removed sections: none
- Follow-up TODOs: none
-->

# Dutch Auction Constitution

## Core Principles

### I. Code Quality by Construction (NON-NEGOTIABLE)

- All Solidity code MUST compile with the compiler version pinned in `foundry.toml`
  and pass `forge fmt --check` plus the configured linter with zero warnings on
  changed files.
- Every state-changing external function MUST follow checks-effects-interactions and
  MUST be reentrancy-guarded when it transfers value.
- Every external and public function MUST carry NatSpec (`@notice`, `@param`,
  `@return`); reverts MUST use custom errors, never revert strings.
- Arithmetic MUST NOT be `unchecked` unless the block carries an explicit comment
  proving the bounds; no unexplained magic numbers — bound values MUST be named
  constants.
- Rationale: auction contracts custody user funds; readability and mechanical
  safety checks are the first line of defense for both auditors and future
  maintainers.

### II. Test-First Development (NON-NEGOTIABLE)

- Every behavior change MUST be expressed as a failing test before any
  implementation code is written (red → green → refactor).
- A test MUST NOT be deleted or weakened to make a change pass; fixing a test
  requires justification in the PR description.
- Tests and the code they cover MUST land in the same commit/PR — no untested code
  on the main branch.
- Rationale: TDD pins the intended auction behavior (pricing curve, settlement,
  refunds) before implementation details can drift.

### III. Testing Rigor & Coverage

- Every contract MUST have unit tests for normal flow, revert paths, and edge cases
  (start/end boundary timestamps, zero-value bids, double settlement, expired bids).
- Value- and time-dependent parameters (price decay, bid amounts, durations) MUST
  have fuzz tests; fund-accounting invariants MUST have invariant tests — e.g.,
  "no ETH is minted or stranded: `address(this).balance == sum of outstanding
  obligations`".
- Critical paths (bidding, settlement, refund/withdrawal) MUST reach 100% branch
  coverage; repository-wide coverage MUST meet the threshold enforced in CI
  (`forge coverage`).
- Gas snapshots MUST be updated and reviewed in any PR that changes gas costs.
- Rationale: Dutch auction bugs hide in boundary timing and accounting edge cases
  that example-based tests alone will miss.

### IV. Maintainability through Modularity

- Each contract MUST have a single, clearly stated responsibility; shared logic
  MUST live in a library or abstract contract with one purpose.
- Configuration (timing, prices, addresses) MUST be supplied via constructor
  arguments or immutables — no hard-coded deployment-specific values.
- Dependencies MUST be installed via `forge install` and pinned to an exact commit;
  new dependencies require justification and a license check in the PR.
- Merged code MUST contain no dead code, no commented-out code, and no speculative
  features — YAGNI applies.
- Rationale: a small, decomposed codebase is what makes future audits and feature
  work affordable.

### V. Refactoring & Review Discipline

- Refactoring MUST be continuous: duplication, awkward naming, and unclear control
  flow are fixed in the PR that encounters them, not deferred to a cleanup task.
- Every PR MUST receive at least one review focused on readability: names MUST
  express intent (e.g., `startTime`, `auctionDuration`, `reservePrice`), and
  reviewers MUST reject logic that requires a comment to be understood instead of
  being restructured.
- Static analysis (e.g., Slither) MUST run before merge; no new high or medium
  findings may be introduced without a documented, justified acknowledgment.
- Rationale: maintainability is enforced at review time or not at all.

## Toolchain & Safety Constraints

- Language/toolchain: Solidity with Foundry (`forge`, `cast`); compiler version,
  optimizer runs, and EVM version are pinned in `foundry.toml` and changed only via
  an explicit PR.
- No private keys, mnemonics, or tokens MUST ever be committed; `.env` and keystore
  files MUST remain gitignored, and tests MUST use Foundry cheatcodes or
  single-use test keys.
- Handling of user funds MUST prefer the pull-payment pattern (users withdraw
  refunds/winnings) over push payments in settlement logic. **Exception (v1.1.0)**:
  atomic single-transaction settlement — refund and proceeds pushed inside the same
  user-initiated transaction — is permitted where the specification requires
  same-transaction receipt, provided ALL of: checks-effects-interactions ordering;
  a reentrancy guard; transfers restricted to the immutable seller and the paying
  `msg.sender`; custom errors that revert the entire transaction on any failed
  transfer; and fuzz + invariant tests proving conservation of funds.
- External/mainnet interactions are only permitted in clearly labeled fork tests
  and MUST NOT be required for the core test suite to pass.

## Development Workflow & Quality Gates

- Work follows the spec-driven flow: `/speckit.specify` → `/speckit.plan` →
  `/speckit.tasks` → `/speckit.implement`, with the constitution governing all
  artifacts.
- Every PR MUST pass these gates before merge: `forge fmt --check`, `forge build`,
  full `forge test`, coverage thresholds, linter, and static analysis with no
  unacknowledged high/medium findings.
- Commits MUST follow Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`,
  `refactor:`, `chore:`); PR descriptions MUST reference the requirement/issue and
  note any gas or coverage delta.
- Reviewers MUST verify compliance with every principle above; untested behavior,
  missing NatSpec, or gate failures block merge.

## Governance

- This constitution supersedes all conflicting habits, conventions, and preferences
  for this repository; where it is silent, the Solidity Style Guide and prevailing
  Foundry community practice apply.
- Amendments MUST be made via a PR to `.specify/memory/constitution.md` that
  includes a Sync Impact Report, the rationale for the change, and — for removals
  or redefinitions — a migration plan for affected code and specs.
- Versioning policy (SemVer): MAJOR for principle removals or incompatible
  redefinitions; MINOR for new principles or materially expanded guidance;
  PATCH for clarifications and wording fixes.
- Compliance review: every PR review MUST check constitution compliance; violations
  MUST block merge unless a documented, temporary waiver is approved in the PR and
  tracked for removal.

**Version**: 1.1.0 | **Ratified**: 2026-09-27 | **Last Amended**: 2026-09-27
