# Option A rollout: backup, test, go live, roll back

What ships: the server fixes in `apps-script/Code.gs` plus a small page update in `wyo/index.html` (and its source `WYO Pick Em.dc.html`). Nobody re-registers, no picks move, the `/exec` URL stays the same.

| Change | Players notice? |
| --- | --- |
| Names, picks, tiebreakers starting with `= + - @` can't become formulas; picks must be one of the two teams | No |
| Other players' picks are hidden (`?`) until kickoff; tiebreaker guesses until the week locks | Only that the API no longer leaks them |
| Tiebreaker locks on the server when every game of the week has kicked off | No (the page already disabled it then) |
| A game with no kickoff time locks at its week's first kickoff; unknown game IDs are ignored | Only on hand-added games |
| 8 wrong PINs in 15 min blocks that sign-in for 15 min; 10 wrong admin PINs blocks admin | Only to someone guessing |
| Hourly jobs take the save lock (only while writing); tabs are overwritten in place, cache cleared after | Fewer failed Sunday saves |
| Admin save writes Settings once instead of ~12 times; empty tiebreakers don't rewrite the tab | Faster saves |
| `testMode` setting: no email is sent (for the test copy) | No |
| Favorite team (`team` column on Players): prompt on next sign-in, "Team colors" link, all 32 NFL teams, neutral by default | Yes |
| Page fetches your own picks after load (`mine`), new build stamp so open pages reload | No |

Not in Option A: tie games still count for the away team, and the tiebreaker game is still "last game listed". Both change results, so announce before changing.

## 1. Back up the live Sheet (5 min)

1. Open the live league Sheet.
2. **File → Version history → Name current version** → `Before Option A — <today's date>`. This is your one-click restore point.
3. **File → Download → Microsoft Excel (.xlsx)**. Keep the file somewhere off Google (it holds PINs, keep it private).
4. **Extensions → Apps Script → Deploy → Manage deployments**. Note the active deployment's **Version** number. **Live is on Version 11** (untitled) as of this rollout. That is what you roll back to.

## 2. Make the test copy (10 min)

1. In the live Sheet: **File → Make a copy**. Name it `WYO Pick Em — TEST (do not share)`. Leave **Share it with the same people** unchecked. The copy brings its own copy of the Apps Script; hourly triggers do **not** copy, so the test can't email anyone on a schedule.
2. In the **copy**, open the **Settings** tab and add a row: `testMode` | `1`. Do this before anything else. With it set, every email (reminders, results, notices) is logged instead of sent.
3. In the copy: **Extensions → Apps Script**. Replace all of `Code.gs` with the new version from this branch (`apps-script/Code.gs`). Save.
4. Function dropdown → **setup** → **Run**. Approve permissions. (It only adds missing tabs/settings. The new `team` column header appears the first time the Players tab is read.)
5. **Deploy → New deployment → Web app**. Execute as **Me**, access **Anyone**. Deploy and copy the URL ending in `/exec`.
6. Send me that URL. Test deployment: `https://script.google.com/macros/s/AKfycbzh7_dY0xJqpxkQlcR327rXtlGtkF6HajQH_QP3iubGBzmDisAuT_1X34g94GeV8kws/exec`. I build `wyo-test/index.html` from it (`python3 tools/make_test_page.py <url>`). The test page shows a red **TEST** tag and uses its own browser storage, so it can't mix with the real page.

## 3. Test (20 min, phone + laptop)

Sign in on the test page with your real email/PIN (the copy has the same roster).

- [ ] "Pick your team" card appears. Choosing a team previews the colors; **Save** keeps them after a reload. **Not now** hides the card on that device.
- [ ] "Team colors" link reopens it; "No team (neutral)" returns to the default look.
- [ ] Your saved picks and tiebreaker still show after a reload.
- [ ] Make and save a pick on an open game. It sticks after a reload.
- [ ] Second browser (or private window), signed in as another player (ask one person, or temporarily give a test player a PIN in the copy): your open picks are **not** visible on Everyone's picks; started/final games are.
- [ ] Standings → "Who's missing" still counts everyone correctly.
- [ ] Open `<test /exec URL>?action=state` in a browser: other players' open picks show `"?"`.
- [ ] Admin: PIN works, **Save changes to league** works, **Pull final scores now** works.
- [ ] Type a name starting with `=` in Change name: it's refused.
- [ ] Apps Script (copy) → **Executions**: no red failures.
- [ ] Optional: I can also build the *current* live page pointed at the test copy, to confirm the old page keeps working against the new server.

## 4. Go live (Tuesday or Wednesday night, ~15 min)

No game should be locked or in progress (after Monday night's final, before Thursday kickoff).

1. Live Sheet: **File → Version history → Name current version** → `Pre-go-live <date>`.
2. Live **Settings** tab: change `adminPin` to 8+ digits. Make sure there's no `testMode` row.
3. Live Sheet: **Ctrl+F**, tick **Also search within formulas**, search `=` on Players, Picks, Tiebreaks, Challenges. Expect nothing. Tell me if anything turns up.
4. **Page first**: tell me to merge, and I merge this branch to `main`. GitHub Pages updates in about a minute, and open pages reload onto the new build. The new page works with the old server (team colors stay hidden until step 5).
5. **Then the server**: live **Extensions → Apps Script**, replace `Code.gs`, Save, run **setup** once. Then **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL doesn't change.
6. Check (5 min): open the live page, sign in, see your picks and the team card. Apps Script → **Executions** shows the next calls succeeding. After the next hour, the `autoPull` / `remind` runs are green.
7. Post the league note (below).

> Heads up: the hourly triggers run whatever code is **saved** in the project, not the deployed version. So once you save the new `Code.gs`, the hourly jobs use it straight away. That's fine (it's compatible), but it matters for rollback.

## 5. Roll back (if something's wrong)

- **Server**: Deploy → Manage deployments → ✏️ → pick **Version 11** (the pre-Option A version) → Deploy. To also roll back the hourly jobs, paste the old `Code.gs` back (Apps Script → **Project history**/version list, or `git show main:apps-script/Code.gs`) and Save.
- **Page**: tell me and I revert the merge on `main`.
- **Data** (last resort): Version history → restore `Pre-go-live`. Picks made after that point are lost, so only for real damage.

## League note (draft)

> Small update to the pick'em tonight. Your picks are now private until kickoff, so nobody can copy your sheet before the games start. Next time you sign in you'll be asked to pick your favorite NFL team and the site will wear its colors (only you see them, change it anytime under Team colors, or skip it). Nothing else changes, and your picks and standings are untouched.
