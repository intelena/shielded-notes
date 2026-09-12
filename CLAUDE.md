# CLAUDE.md — shielded-notes

pnpm monorepo: `packages/core` (`@intelena/shielded-notes`, only dep `@noble/hashes`) + reference `contracts/ShieldedPool.sol` + `circuits/spend.circom` + `examples/`. Tests with vitest; CI in `.github/workflows/ci.yml`.

- `SPEC.md` is normative. A change to a hash shape, the tree, or a spend check must update SPEC.md, `pool.ts` (`checkSpendWitness`), the `.sol` and `.circom` files together.
- Keep core runtime-agnostic (browser / Workers / Node); no Node-only APIs.
- Rejection reasons are a closed string union in `types.ts` — add there first, then in the contract `require` messages.
- The Solidity/circom files are documentation-grade references, not compiled in CI. Mark anything unaudited as such.
- Commit messages: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, …), English, single line.
