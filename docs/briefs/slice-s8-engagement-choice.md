# Slice S8 — the defender's pre-battle choice is stolen by the attacker's "Fight"

**Ledger row 14.** Board line: the `IN-FLIGHT` row for `engagement-choice`. **The owner hit this
live, mid-game, and it is a RULES bug, so it outranks everything else.**

## The owner's report, verbatim

> "I am just doing my first fight, starting it. I clicked on fight and got the battleground
> immediately. But the other player needs to get the option to give up before fighting starts."

## Confirmed, in the code and in his game

**His live game shows it.** His snapshot `snap.test-s-game-2-7b33a1b2.0005.011.i9pgq7wi` is
`phase=Battle` with `pendingEngagements=[{attackerId: leg-1, defenderId: leg-5}]` and
`activeEngagement=null` — and the log runs straight from
`Engagement Rd01=[…] vs Bu03=[…]` to `Battle on 1: Rd01 vs Bu03`. **No flee/concede decision exists
anywhere in the log.**

**The mechanism is one block.** `GameEngine.ts:578-587`:

```ts
case 'proposeAgreement': {
  eng.proposal = command.kind
  eng.proposedBy = activePlayer(state).id
  if (command.kind === 'fight') {
    startBattleFromEngagement(state, rng)   // ← starts the battle UNILATERALLY
    break
  }
  …
}
```

`acceptAgreement` (`:588-590`) then explicitly refuses `'fight'` ("No agreement pending"), so
`'fight'` is deliberately a unilateral start. The defender's own options — `case 'flee'` (`:562`,
half points) and `case 'concedeEngagement'` (`:569`, full points) — exist and work, but with the
attacker able to start the battle in one command, **the defender's window never opens.** In hotseat
one person holds both sides so this is invisible; in a multiplayer game it takes the defender's
decision away. That is exactly what the owner saw.

## What to build

**The defender chooses, and the battle starts only once they have.** An engagement is not resolved
by the attacker's command. Concretely:

1. **The attacker's `'fight'` must not start a battle on its own** while the defender has not
   decided. Whether it becomes a proposal the defender must answer, or is simply not offered, is
   YOUR call (see below) — but the battle must not begin until the defender's choice is in.
2. **The defender gets their choice, in their own client**: fight, flee (half points to the
   attacker) or concede (full points) — the three outcomes the engine already implements. In
   multiplayer the defender's client must present it and the attacker's must show that it is
   WAITING on the other player, rather than appearing to be able to proceed.
3. **The rules are the authority, not this brief.** Settle the exact semantics from
   `docs/rules/` (its README sets the authority order: Colossus Java behaviour when it intentionally
   differs → official Titan rules → noted MVP simplifications) and the Java reference
   (`Colossus/**/*.java` — reference only, not buildable here). **Say in your report what you
   established**, with `file:line` for the Java behaviour and the rule text you relied on. If the
   written rules make the ATTACKER the deciding party, say so plainly and implement THAT instead —
   this brief may be wrong about whose choice it is, and proving that is a good outcome.
4. **Hotseat must still be playable.** If the attacker's fight no longer resolves the engagement,
   the same user must still be able to get through the defender's choice in one sitting. Check it,
   do not assume it.
5. **The non-active client must not be able to move the battle along** — S7 just established ONE
   authority for who may act on the board; an engagement's two parties are already both "may act"
   (`actingPlayerIds`, `sync.ts`), so do not widen that gate. A third party (a spectator) must not
   be able to answer for the defender.

## Pins — each phrased as a statement

- **An engagement does NOT start a battle on the attacker's command alone.** (The owner's bug: this
  must fail without the fix.)
- **The defender's flee, concede and fight each produce their own outcome**, and the battle starts
  ONLY for fight — with the attacker having no way to force it past the defender.
- **A battle does not start while the defender has not decided, in a two-human game**, and the state
  says the engagement is WAITING (so a UI can say so).
- **A hotseat two-human game can still complete an engagement** in one sitting (no deadlock).
- **A spectator cannot answer for the defender** (they may not act at all).

## Verification (yours)

1. The ONE gate command from the **root of your worktree**: `bash scripts/gate.sh`. A fresh worktree
   needs `(cd web && npm ci)` ONCE first or it exits 1 at preflight. Exit `9` = lock busy → retry.
2. Your **own differential**: arms with PRINTED hashes, lock held, restore from `HEAD` in a `trap`.
   **COMMIT BEFORE YOU INJECT**, and **Arm A must be the defect itself** — restore the unilateral
   start and watch the named pin go RED.
3. **A browser check is REQUIRED** — this is a flow the owner watches. `scripts/browser-check/`
   holds a working CDP harness (README records the method); note that its S7 script needs its bundle
   built by hand first, a gap recorded on the board.
4. Commit, rebase on `origin/master`, push your branch.
5. **If you cannot finish, COMMIT the coherent partial state and report BLOCKED.**

**Do not seek or use a real access key, and add no test that calls the live service.**

## Note on the owner's current game

His game is ALREADY PAST the engagement and into the battle, and the state is consistent, so **do
not try to unwind it** — the fix applies to the next engagement. He can finish this fight.

## Docs to amend in the SAME commit

`docs/DECISION-LEDGER.md` row **14** (including what the rules actually say); `docs/BOARD.md` (turn
the `IN-FLIGHT` line into `LANDED`); `docs/ARCHITECTURE.md` (the engagement seam: who decides what,
and in which client); carry the `COPIES:` line.

## Your report (short)

LANDED or BLOCKED, then: sha; gate exit + counts + peak; each arm with its printed hash and what
went red; the `COPIES:` line; **what the rules say about whose choice it is, with evidence**; how the
defender's choice now reaches them in multiplayer and what the attacker sees while waiting; the
hotseat check; your judgement calls; the docs you amended; and anything this brief got wrong.

Report NOTHING in between — silence until LANDED or BLOCKED.
