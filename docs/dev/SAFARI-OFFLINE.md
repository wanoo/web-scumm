# Safari offline (manual, before a release)

Playwright cannot navigate WebKit offline, so CI only proves the offline game in Chromium (`npm run e2e:pwa`); the
WebKit run reports "skipped". Once per release, a person checks it on a real iPhone or iPad (Safari), and writes the
result in `docs/dev/passes/<version>.md` (device, iOS and Safari versions, what failed). A release whose pass is not
done says so in its notes (D12).

1. **First visit, online.** Open the game's URL, start a new game, play until the pause menu says the offline copy is
   complete (Pause › "Offline: n/n files").
2. **Add to the Home Screen** (optional, the usual way players install it), open it from there once, online.
3. **Airplane mode.** Close Safari (or the installed app) completely, turn airplane mode on, open the game again: the
   title loads, Continue resumes the save.
4. **A room never visited.** Go somewhere the first visit did not reach (the map, another room): its backdrop,
   characters and sounds are there.
5. **Reload offline.** Pull to reload: the game comes back, the save is intact.
6. **Seven days.** Safari may evict the storage of a site not opened for seven days; that is said in ENGINE "Cache",
   not tested here.

Anything that fails is a bug with its step, the device, and what happened instead.
