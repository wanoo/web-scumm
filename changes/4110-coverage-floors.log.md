## `fix/4110-coverage-floors`: the floors the candidate's strict ratchet refused

- The `v4.1.10-rc.1` tag's `coverage` job failed on `coverage-ratchet --strict`: five floors three points or more below
  the measure (lines 64 vs 67.91, statements 63 vs 67.21, functions 59 vs 63.31, branches 61 vs 64.09, `protocol.ts`
  branches 95 vs 98.75). On #45 and #47 the same ratchet was a warning (lot 0), and main's run of the merge commit was
  cancelled by the next merge before its coverage job ran. Raised to 66 / 65 / 61 / 62 and 96 (the values Viewport's
  branch already carries). The unpublished candidate tag is deleted and made again on the merge of this fix.
- Lesson for the cadence: a tag's strict ratchet can refuse what a pull request only warned about; the release branch
  runs `coverage-ratchet --strict` locally before its pull request from now on (the method of a lot, point 6).
→ next: Claude · `v4.1.10-rc.1` again on this merge, then `v4.1.10`
