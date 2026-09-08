# Pick Em — connecting the Google Sheet

The page runs in two modes. With no sheet connected it's a demo on your own device. With a sheet connected, everyone shares one league: registrations, picks, games and scores all live in the sheet.

## 1. Create the sheet + backend (10 minutes, once)
1. Go to sheets.google.com → new blank spreadsheet. Name it anything (e.g. "Pick Em 2026").
2. Menu **Extensions → Apps Script**. Delete the sample code, paste in the contents of `apps-script/Code.gs`, save.
3. In the function dropdown pick **setup** → Run. Approve the permissions. (Tabs appear in the sheet: Players, Games, Picks, Tiebreaks, Settings.)
4. Pick **testEspn** → Run. Approve the permission to connect to an external service (ESPN). The log should say how many games it found.
5. Pick **installTrigger** → Run. Every hour this imports the current week's schedule (if you haven't already) and pulls final scores from ESPN.
6. Open the **Settings** tab in the sheet and change `adminPin` from 1234 to your own.
7. Back in Apps Script: **Deploy → New deployment → type: Web app**. Execute as **Me**; who has access **Anyone**. Deploy, then copy the Web app URL (ends in `/exec`).

## 2. Point the page at it
Open the page's Tweaks and paste the URL into **API URL**. Everyone who opens your page now sees the same league.

## 3. First-week setup (commissioner)
1. Open **Admin**, enter your admin PIN.
2. Pick the pool (NFL / College) and week. Click **Import Week N schedule from ESPN** — NFL brings in every game; College brings in games with a Top-25 team. Delete any you don't want, or add your own.
3. **+ Add week** as the season goes on.
4. **Pull final scores now** fills in every finished game from ESPN. The hourly auto-pull does the same in the background when Google can reach ESPN.

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
