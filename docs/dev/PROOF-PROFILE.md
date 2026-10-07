# The explosion profile of the proof matrix

*Measured on 7 October 2026 on the maintainer's Mac (4.1.13, compact representation, no workers) with
`npm run prove:matrix -- --only=<ids> --time=120 --profile=<file>` (o22 to o25 with `--time=115`). One section per
instance of [PROOF-MATRIX.md](PROOF-MATRIX.md): what each abstraction did, or why it is off, then what multiplies the
states (`src/engine/tools/solve/explosion.ts`): for each family, how many of the states measured would merge without
it. The profile is taken at two minutes, not at the end of the ten-minute budget: the constrained instances, c13 and
o26 finish before; o21 to o25 are cut there (o21 finishes in 419 s with the full budget). Read the shares, not the
totals.*

## What the open instances say

- **The cost per state is the tries that change nothing.** o22 runs 215 775 no-op tries for 2 758 states (78 a
  state), o23 418 564 for 16 395, o25 332 603 for 5 686: the mobility regions of an open instance span the whole map
  (the largest region is every room), so each state tries the actions of every room for each character. The no-op
  memo refuses to keep almost all of them (137 864 refused on o22, 228 652 on o25): those runs read what the memo
  cannot value. The constrained instances, whose regions are 7 to 13 rooms, refuse 0.5 to 2 runs per state; the open
  ones 9 (o26) to 50 (o22).
- **What multiplies the states is the bags.** Inventories split 1 959 of o22's 2 758 states and 13 171 of o23's
  16 395 (517 and 526 distinct bags and pools): the canonical owner pools the free items of characters who can meet
  (43 351 to 69 548 hand-overs played), but the keys are read by the doors, so who carries which key stays in the
  state (o25 and o21 are the exceptions, where the flags and the dialogues split more). Positions split a fifth to a
  third of the states: the regions fold the rooms, not the characters' standing apart.
- **The representation is not the limit any more**: the tables hold 0.7 to 2.7 MB at two minutes.

## c11 (39 rooms, constrained): proved, 5385 states, 31.6 s

```
  canonical character   10768 switches folded, 0 kept explicit
  mobility regions      78576 macro moves, largest region 13 rooms
  no-op memo            15936 runs skipped (996 of them run anyway and identical), 863 kept, 2920 refused
  witness dominance     off (off in proofs: it changes softlock verdicts on generated games (tests/dominance.test.ts))
  canonical owner       12 item(s) pooled, 0 hand-overs played
  symmetric items       off (not asked for (--symmetry))
  representation        compact, 853 KB of tables

Explosion: what multiplies the 5385 states measured (states that would merge without it)
  positions           0  (11 distinct values over 3 dimension(s))
  inventories      1024  (149 distinct values over 3 dimension(s))
  flags            1250  (305 distinct values over 24 dimension(s))
  dialogues        4536  (27 distinct values over 6 dimension(s))
  scripts          2496  (4 distinct values over 6 dimension(s))
  symmetries   10768 character switches folded, 0 class(es) of symmetric items
  no-ops       75787 tries changed nothing (14940 of them not even run: the memo knew)
  permutations 20357 transitions landed on a state already seen
```

## c12 (37 rooms, constrained): softlock, 7333 states, 47.5 s

```
  canonical character   14664 switches folded, 0 kept explicit
  mobility regions      120840 macro moves, largest region 13 rooms
  no-op memo            18607 runs skipped (1162 of them run anyway and identical), 1004 kept, 14664 refused
  witness dominance     off (off in proofs: it changes softlock verdicts on generated games (tests/dominance.test.ts))
  canonical owner       10 item(s) pooled, 0 hand-overs played
  symmetric items       off (not asked for (--symmetry))
  representation        compact, 1176 KB of tables

Explosion: what multiplies the 7333 states measured (states that would merge without it)
  positions           0  (24 distinct values over 3 dimension(s))
  inventories      3666  (128 distinct values over 3 dimension(s))
  flags            3883  (513 distinct values over 20 dimension(s))
  dialogues        5860  (9 distinct values over 4 dimension(s))
  scripts          2532  (4 distinct values over 6 dimension(s))
  symmetries   14664 character switches folded, 0 class(es) of symmetric items
  no-ops       147439 tries changed nothing (17445 of them not even run: the memo knew)
  permutations 27317 transitions landed on a state already seen
```

## c13 (20 rooms, constrained): softlock, 341 states, 0.9 s

```
  canonical character   680 switches folded, 0 kept explicit
  mobility regions      3192 macro moves, largest region 7 rooms
  no-op memo            2175 runs skipped (135 of them run anyway and identical), 378 kept, 700 refused
  witness dominance     off (off in proofs: it changes softlock verdicts on generated games (tests/dominance.test.ts))
  canonical owner       7 item(s) pooled, 0 hand-overs played
  symmetric items       off (not asked for (--symmetry))
  representation        compact, 66 KB of tables

Explosion: what multiplies the 341 states measured (states that would merge without it)
  positions           0  (5 distinct values over 3 dimension(s))
  inventories        40  (12 distinct values over 3 dimension(s))
  flags              79  (41 distinct values over 12 dimension(s))
  dialogues         240  (9 distinct values over 4 dimension(s))
  scripts           200  (4 distinct values over 6 dimension(s))
  symmetries   680 character switches folded, 0 class(es) of symmetric items
  no-ops       5831 tries changed nothing (2040 of them not even run: the memo knew)
  permutations 769 transitions landed on a state already seen
```

## c14 (25 rooms, constrained): proved, 1871 states, 6.5 s

```
  canonical character   3740 switches folded, 0 kept explicit
  mobility regions      23052 macro moves, largest region 9 rooms
  no-op memo            5534 runs skipped (345 of them run anyway and identical), 854 kept, 2750 refused
  witness dominance     off (off in proofs: it changes softlock verdicts on generated games (tests/dominance.test.ts))
  canonical owner       7 item(s) pooled, 0 hand-overs played
  symmetric items       off (not asked for (--symmetry))
  representation        compact, 238 KB of tables

Explosion: what multiplies the 1871 states measured (states that would merge without it)
  positions           0  (18 distinct values over 3 dimension(s))
  inventories         0  (24 distinct values over 3 dimension(s))
  flags             527  (193 distinct values over 14 dimension(s))
  dialogues        1520  (9 distinct values over 4 dimension(s))
  scripts           974  (8 distinct values over 9 dimension(s))
  symmetries   3740 character switches folded, 0 class(es) of symmetric items
  no-ops       28464 tries changed nothing (5189 of them not even run: the memo knew)
  permutations 5497 transitions landed on a state already seen
```

## c15 (37 rooms, constrained): proved, 1605 states, 8 s

```
  canonical character   3208 switches folded, 0 kept explicit
  mobility regions      25424 macro moves, largest region 13 rooms
  no-op memo            6879 runs skipped (429 of them run anyway and identical), 864 kept, 1320 refused
  witness dominance     off (off in proofs: it changes softlock verdicts on generated games (tests/dominance.test.ts))
  canonical owner       11 item(s) pooled, 0 hand-overs played
  symmetric items       off (not asked for (--symmetry))
  representation        compact, 229 KB of tables

Explosion: what multiplies the 1605 states measured (states that would merge without it)
  positions           0  (25 distinct values over 3 dimension(s))
  inventories       196  (92 distinct values over 3 dimension(s))
  flags             365  (457 distinct values over 20 dimension(s))
  dialogues         504  (3 distinct values over 2 dimension(s))
  scripts           868  (4 distinct values over 6 dimension(s))
  symmetries   3208 character switches folded, 0 class(es) of symmetric items
  no-ops       24193 tries changed nothing (6450 of them not even run: the memo knew)
  permutations 4829 transitions landed on a state already seen
```

## c16 (21 rooms, constrained): softlock, 259 states, 0.6 s

```
  canonical character   516 switches folded, 0 kept explicit
  mobility regions      2868 macro moves, largest region 7 rooms
  no-op memo            1777 runs skipped (111 of them run anyway and identical), 309 kept, 478 refused
  witness dominance     off (off in proofs: it changes softlock verdicts on generated games (tests/dominance.test.ts))
  canonical owner       8 item(s) pooled, 0 hand-overs played
  symmetric items       off (not asked for (--symmetry))
  representation        compact, 53 KB of tables

Explosion: what multiplies the 259 states measured (states that would merge without it)
  positions           0  (5 distinct values over 3 dimension(s))
  inventories       110  (13 distinct values over 3 dimension(s))
  flags             129  (37 distinct values over 12 dimension(s))
  dialogues         192  (9 distinct values over 4 dimension(s))
  scripts             0  (1 distinct values over 0 dimension(s))
  symmetries   516 character switches folded, 0 class(es) of symmetric items
  no-ops       3708 tries changed nothing (1666 of them not even run: the memo knew)
  permutations 483 transitions landed on a state already seen
```

## o21 (26 rooms, open): unknown, 14902 states, 120.5 s

```
  canonical character   29658 switches folded, 0 kept explicit
  mobility regions      177563 macro moves, largest region 26 rooms
  no-op memo            11917 runs skipped (744 of them run anyway and identical), 888 kept, 241392 refused
  witness dominance     off (off in proofs: it changes softlock verdicts on generated games (tests/dominance.test.ts))
  canonical owner       8 item(s) pooled, 77775 hand-overs played
  symmetric items       off (not asked for (--symmetry))
  representation        compact, 1862 KB of tables
  stopped by            the time limit (--time)

Explosion: what multiplies the 14902 states measured (states that would merge without it)
  positions        5274  (83 distinct values over 3 dimension(s))
  inventories      3526  (257 distinct values over 7 dimension(s))
  flags           10979  (295 distinct values over 16 dimension(s))
  dialogues       12208  (9 distinct values over 4 dimension(s))
  scripts          2013  (2 distinct values over 3 dimension(s))
  symmetries   29658 character switches folded, 0 class(es) of symmetric items
  no-ops       455317 tries changed nothing (11173 of them not even run: the memo knew)
  permutations 56614 transitions landed on a state already seen
```

## o22 (39 rooms, open): unknown, 2758 states, 115.2 s

```
  canonical character   5170 switches folded, 0 kept explicit
  mobility regions      71730 macro moves, largest region 39 rooms
  no-op memo            4015 runs skipped (250 of them run anyway and identical), 966 kept, 137864 refused
  witness dominance     off (off in proofs: it changes softlock verdicts on generated games (tests/dominance.test.ts))
  canonical owner       14 item(s) pooled, 43351 hand-overs played
  symmetric items       off (not asked for (--symmetry))
  representation        compact, 711 KB of tables
  stopped by            the time limit (--time)

Explosion: what multiplies the 2758 states measured (states that would merge without it)
  positions         601  (83 distinct values over 3 dimension(s))
  inventories      1959  (517 distinct values over 7 dimension(s))
  flags            1538  (157 distinct values over 26 dimension(s))
  dialogues          67  (13 distinct values over 6 dimension(s))
  scripts            32  (4 distinct values over 6 dimension(s))
  symmetries   5170 character switches folded, 0 class(es) of symmetric items
  no-ops       215775 tries changed nothing (3765 of them not even run: the memo knew)
  permutations 10162 transitions landed on a state already seen
```

## o23 (27 rooms, open): unknown, 16395 states, 115.7 s

```
  canonical character   31740 switches folded, 0 kept explicit
  mobility regions      182131 macro moves, largest region 27 rooms
  no-op memo            5097 runs skipped (318 of them run anyway and identical), 892 kept, 210939 refused
  witness dominance     off (off in proofs: it changes softlock verdicts on generated games (tests/dominance.test.ts))
  canonical owner       9 item(s) pooled, 69548 hand-overs played
  symmetric items       off (not asked for (--symmetry))
  representation        compact, 2657 KB of tables
  stopped by            the time limit (--time)

Explosion: what multiplies the 16395 states measured (states that would merge without it)
  positions        5898  (67 distinct values over 3 dimension(s))
  inventories     13171  (526 distinct values over 7 dimension(s))
  flags           11705  (155 distinct values over 16 dimension(s))
  dialogues       10496  (14 distinct values over 6 dimension(s))
  scripts          1650  (2 distinct values over 3 dimension(s))
  symmetries   31740 character switches folded, 0 class(es) of symmetric items
  no-ops       418564 tries changed nothing (4779 of them not even run: the memo knew)
  permutations 64562 transitions landed on a state already seen
```

## o24 (38 rooms, open): unknown, 3295 states, 115.2 s

```
  canonical character   5654 switches folded, 0 kept explicit
  mobility regions      79059 macro moves, largest region 38 rooms
  no-op memo            8996 runs skipped (562 of them run anyway and identical), 906 kept, 88673 refused
  witness dominance     off (off in proofs: it changes softlock verdicts on generated games (tests/dominance.test.ts))
  canonical owner       13 item(s) pooled, 28016 hand-overs played
  symmetric items       off (not asked for (--symmetry))
  representation        compact, 948 KB of tables
  stopped by            the time limit (--time)

Explosion: what multiplies the 3295 states measured (states that would merge without it)
  positions         548  (75 distinct values over 3 dimension(s))
  inventories      2611  (487 distinct values over 7 dimension(s))
  flags             967  (119 distinct values over 22 dimension(s))
  dialogues        1091  (13 distinct values over 6 dimension(s))
  scripts           382  (2 distinct values over 3 dimension(s))
  symmetries   5654 character switches folded, 0 class(es) of symmetric items
  no-ops       161465 tries changed nothing (8434 of them not even run: the memo knew)
  permutations 9906 transitions landed on a state already seen
```

## o25 (29 rooms, open): unknown, 5686 states, 115.2 s

```
  canonical character   11184 switches folded, 0 kept explicit
  mobility regions      115648 macro moves, largest region 29 rooms
  no-op memo            11340 runs skipped (708 of them run anyway and identical), 713 kept, 228652 refused
  witness dominance     off (off in proofs: it changes softlock verdicts on generated games (tests/dominance.test.ts))
  canonical owner       8 item(s) pooled, 67473 hand-overs played
  symmetric items       off (not asked for (--symmetry))
  representation        compact, 865 KB of tables
  stopped by            the time limit (--time)

Explosion: what multiplies the 5686 states measured (states that would merge without it)
  positions         922  (23 distinct values over 3 dimension(s))
  inventories      1405  (138 distinct values over 7 dimension(s))
  flags            4224  (181 distinct values over 16 dimension(s))
  dialogues        4927  (15 distinct values over 6 dimension(s))
  scripts             0  (1 distinct values over 0 dimension(s))
  symmetries   11184 character switches folded, 0 class(es) of symmetric items
  no-ops       332603 tries changed nothing (10632 of them not even run: the memo knew)
  permutations 26931 transitions landed on a state already seen
```

## o26 (22 rooms, open): softlock, 8638 states, 57.4 s

```
  canonical character   17256 switches folded, 0 kept explicit
  mobility regions      112404 macro moves, largest region 22 rooms
  no-op memo            5581 runs skipped (348 of them run anyway and identical), 852 kept, 75692 refused
  witness dominance     off (off in proofs: it changes softlock verdicts on generated games (tests/dominance.test.ts))
  canonical owner       8 item(s) pooled, 36144 hand-overs played
  symmetric items       off (not asked for (--symmetry))
  representation        compact, 1539 KB of tables

Explosion: what multiplies the 8638 states measured (states that would merge without it)
  positions        1248  (32 distinct values over 3 dimension(s))
  inventories      6355  (160 distinct values over 7 dimension(s))
  flags            8020  (267 distinct values over 14 dimension(s))
  dialogues           0  (1 distinct values over 0 dimension(s))
  scripts          4204  (2 distinct values over 3 dimension(s))
  symmetries   17256 character switches folded, 0 class(es) of symmetric items
  no-ops       203181 tries changed nothing (5233 of them not even run: the memo knew)
  permutations 42414 transitions landed on a state already seen
```
