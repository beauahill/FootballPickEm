# Pick Em — connecting the Google Sheet

The page runs in two modes. With no sheet connected it's a demo on your own device. With a sheet connected, everyone shares one league: registrations, picks, games and scores all live in the sheet.

## 1. Create the sheet + backend (10 minutes, once)
1. Go to sheets.google.com → new blank spreadsheet. Name it anything (e.g. "Pick Em 2026").
2. Menu **Extensions → Apps Script**. Delete the sample code, paste in the contents of `apps-script/Code.gs`, save.
3. In the function dropdown pick **setup** → Run. Approve the permissions. (Tabs appear in the sheet: Players, Games, Picks, Tiebreaks, Settings.)
4. Pick **testEspn** → Run. Approve the permission to connect to an external service (ESPN). The log should say how many games it found.
5. Pick **installTrigger** → Run. Every hour this imports the current week's schedule (if you haven't already), pulls final scores from ESPN, and emails anyone missing picks on a game kicking off within 24 hours (one email per game, sent from your Google account).
6. Open the **Settings** tab in the sheet and change `adminPin` from 1234 to your own.
7. Back in Apps Script: **Deploy → New deployment → type: Web app**. Execute as **Me**; who has access **Anyone**. Deploy, then copy the Web app URL (ends in `/exec`).

## 2. Point the page at it
Open the page's Tweaks and paste the URL into **API URL**. Everyone who opens your page now sees the same league.

## 3. First-week setup (commissioner)
1. Open **Admin**, enter your admin PIN.
2. Pick the pool (NFL / College) and week. Click **Import Week N schedule from ESPN** — NFL brings in every game; College brings in games with a Top-25 team. Delete any you don't want, or add your own.
3. **+ Add week** as the season goes on.
4. **Pull final scores now** fills in every finished game from ESPN. The hourly auto-pull does the same in the background when Google can reach ESPN.

## Money
Players choose their pools when they register (entry fee per pool, default $100). Admin marks each player Paid / Unpaid per pool and sets the payout structure: a share of the pot goes to weekly winners (split evenly over the season's weeks), the rest to the season's top three (default 70 / 20 / 10). The page shows the pot and payouts based on money actually collected.

## Access code
Admin → Money & payouts → **League access code**. When set, nobody can register without it (blank = open). Text it to the group with the link.

## Pick reminders
The hourly `remind` trigger emails a player once per game they haven't picked when kickoff is under 24 hours away. Set `leagueName` and `leagueUrl` rows in the Settings tab so the email names your league and links to the right page (WYO: add `wyo/` to the URL). Admin → **Email pick reminders now** sends immediately. Gmail allows ~100 emails/day, plenty for a league. The Standings tab also shows who still owes picks for the week.

## If it gets slow
Apps Script sometimes answers with a "busy" page instead of data; the page now retries twice automatically. Google allows ~30 simultaneous requests and 90 minutes of script time a day for a free account — fine for a league of 50 if the hourly triggers aren't doubled up. Check Apps Script → Triggers and make sure `autoPull` and `remind` appear once each (run `installTrigger` again to reset them).

## Side action
Three side games run off the same picks, no extra entry:
- **Weekly rival** — every player is paired with someone new each week (round-robin over the roster, so keep the roster stable after Week 1 or pairings reshuffle). Most correct picks wins; the season W-L-T shows in the Standings "Rival" column.
- **Callouts** — a player calls out anyone for a dollar amount; the other player accepts or declines. Most correct picks that week wins, ties push. Callouts open and close at the week's first kickoff. Stored in the `Challenges` tab (created automatically). Net winnings show in the "Side $" column. The league doesn't hold the money — players settle directly.
- **Consensus** — once a game kicks off, each card shows what % of the league took each side. Informational only.

## Players
Everyone registers once with their name, email and a 4+ digit PIN; after that they sign in with email + PIN. The name is what shows on the board. PINs are stored plainly in the Players tab — the commissioner can look one up if someone forgets. Admin can remove a player.

## Notes
- Picks can't be changed once a game has a score entered.
- Scores come from ESPN's public scoreboard feed. It's unofficial but has been stable for years; if it ever changes, scores can still be typed in by hand in Admin.
- Kickoff times are shown in Mountain time (`TZ` at the top of `Code.gs`).
- If you edit `Code.gs` later, you must **Deploy → Manage deployments → ✎ edit → Version: New version → Deploy** for changes to go live. Just saving the code is not enough — the page keeps talking to the old version.

## Troubleshooting
- **testEspn says "HTTP 403":** ESPN blocks requests coming from Google's servers. The Admin **Import** and **Pull scores** buttons don't depend on this — they fetch ESPN from your own browser, then save to the sheet. The hourly auto-pull tries a public relay; if that's blocked too, just hit **Pull final scores now** on Monday.
- **Admin PIN rejected:** the PIN is the `adminPin` row in the sheet's Settings tab, not the one in the page's Tweaks.
- **Old behaviour after changing Code.gs:** you didn't deploy a new version (see above).
