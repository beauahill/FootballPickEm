# Plan: move WYO Pick Em to Railway for the 2027 season

## Why move
The Google Sheet + Apps Script setup got the league through 2026, but its limits are now the source of most bugs:
- One global script lock and whole-tab rewrites. Sunday-morning saves queue and can fail.
- A 5-minute cache in front of a spreadsheet, plus race conditions between the hourly jobs and saves.
- Google's servers are blocked by ESPN, so score pulls depend on third-party relays.
- PINs live in plain text in a spreadsheet, and the page re-sends them on every call.
- The page is a 766 KB export from a design tool. Every change means patching the source and the bundle in step.

Railway gives a real server, a Postgres database, scheduled jobs and logs, for roughly $5–10/month for a league this size (Hobby plan plus a small Postgres; confirm current pricing when signing up).

## Target setup
| Piece | Choice | Notes |
| --- | --- | --- |
| App | Node + TypeScript (Fastify or Express) | One service serves the API and the page |
| Page | Vite + React, plain repo files | Rebuilt with the refreshed UI (logos, team colors, tabs). No more bundle patching |
| Database | Railway Postgres | Tables mirror today's tabs: players, games, picks, tiebreaks, challenges, settings, reminders |
| Sign-in | Email + PIN, PINs hashed (bcrypt/argon2), session cookie | Existing PINs are hashed during import, so nobody resets anything |
| Scheduled jobs | Railway cron service (same code, different start command) | Hourly ESPN import/scores, reminder emails, weekly results |
| Email | Transactional provider (Resend or Postmark) | Replaces MailApp. Needs a sending domain with SPF/DKIM |
| Logos | ESPN logo URLs from the scoreboard data, cached | NFL and college |
| Domain | Custom domain on Railway (optional) | Or keep GitHub Pages pointing at the API |
| Backups | Railway Postgres backups + nightly CSV export to Drive (optional) | Keeps a spreadsheet view for the commissioner |

### Keep the same API shape at first
Today the page POSTs `{ action: ..., email, pin, ... }` to one URL and GETs `?action=state`. The new server answers the same actions at `/api`, with the same JSON. Then:
- The current page can be pointed at Railway by changing its API URL, which is a safe first test.
- The new page can be built against a contract that's already proven.
- The hidden-picks and lock rules from Option A carry straight over.

After cutover, the PIN-in-every-call pattern is replaced by a session cookie.

## Rule decisions to settle before 2027 (announce with the new site)
- [ ] Tie games: push (no one gets the point) instead of counting for the away team.
- [ ] Tiebreaker game: the week's last kickoff instead of "last game listed".
- [ ] Kickoff times shown in each viewer's time zone.
- [ ] Should College stay Top-25 only?
- [ ] Payouts and fees for 2027.

## Timeline
| When | Step |
| --- | --- |
| Feb 2027 (after the Super Bowl) | Freeze 2026: name a final Sheet version, export .xlsx, write down the final standings and payouts |
| Mar | Set up the Railway project, Postgres, repo structure, CI. Port the data model and the action API, with tests from today's backend behavior (the Option A test cases are a start) |
| Apr | Import script: Sheet → Postgres, including 2026 history (so Past Weeks and the season archive work) and hashed PINs. Run it repeatedly until it's clean |
| May | Point a copy of the current page at Railway. Test with a few league members. Set up the email provider and domain |
| Jun–Jul | Build the refreshed page (mockup v2: logos, Your Team, tabs, compact layout) on the new API. Admin screens: games, scores, payments, notices |
| Early Aug | Preseason dry run with the whole league on a fake week: registration, picks, reminders, results email |
| 2 weeks before Week 1 | Cutover: final import, switch the league URL, Apps Script set to read-only (it can stay up as an archive) |
| Weeks 1–3 | Watch logs and errors. Keep the old Sheet untouched as a fallback |

## Cutover and rollback
- Cut over before any 2027 picks exist, so there's no live data to sync between two systems.
- Rollback before Week 1 is just pointing the URL back. After Week 1, the fallback is a database export rather than going back to the Sheet.

## Costs and accounts needed
- Railway account (Hobby plan) and a payment card.
- Email provider account plus DNS access for the sending domain.
- Optional: a domain name.
- The GitHub repo stays the source of truth. Railway deploys from it.

## Risks
- **ESPN's unofficial scoreboard API** could change. Keep a manual score entry screen, as today.
- **Email deliverability**: set up SPF/DKIM early, and send test reminders in the preseason.
- **One maintainer**: keep a README with deploy, restore and "start a new season" steps.

## Next steps (no rush, after this season)
1. Decide on the rule changes above.
2. Choose Node/TypeScript vs another stack (recommended: Node/TS, since the current logic is JavaScript and ports directly).
3. I can scaffold the repo (server, database schema, import script, tests) on a branch whenever you're ready.
