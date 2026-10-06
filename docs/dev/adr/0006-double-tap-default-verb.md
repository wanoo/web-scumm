# 0006 · A double tap acts with the verb a player means

**Context.** On a phone, choosing a verb then a target is two taps for an action a player already knows (go through
that door, talk to that person). Asked by the maintainer in 4.0.

**Decision.** A single tap keeps the classic grammar; a double tap acts with the default verb
(`src/engine/core/default-verb.ts`): through an exit, talk to a character, look at the rest, or the content's own
`defaultVerb`; an item taken from the bag without a verb is given to a character or used on anything else. The
choice is in the core, so the solver and the tests see the same verb the player gets (`npm run e2e:taps`).

**Cost.** A content author must name a `defaultVerb` where the guess would be wrong.

**Would change it.** Playtests showing players expect another verb (the field passes, `docs/en/FIELD.md`).
