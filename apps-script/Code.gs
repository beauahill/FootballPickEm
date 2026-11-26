// Football Pick Em — Google Apps Script backend. Paste into a Google Sheet's Apps Script editor. See SETUP.md.
const TZ = 'America/Denver';   // kickoff times are shown in this time zone
const SEASON = 2026;
const HEADERS = {
  Players: ['name', 'email', 'pin', 'joined', 'pools', 'paid', 'note', 'avatar', 'team'],
  Games: ['pool', 'week', 'id', 'away', 'home', 'when', 'as', 'hs', 'espnId', 'spread', 'kick'],
  Picks: ['player', 'gameId', 'pick', 'updated'],
  Tiebreaks: ['player', 'key', 'value'],
  Settings: ['key', 'value'],
  Reminders: ['player', 'gameId', 'sent'],
  Challenges: ['id', 'pool', 'week', 'from', 'to', 'amount', 'status', 'created']
};
// Reminder emails: a player with no pick on a game kicking off within REMIND_HOURS gets one email (per game) with a link.
// Set leagueName / leagueUrl in the Settings tab; these are the fallbacks.
const REMIND_HOURS = 24, LEAGUE_NAME = 'Pick Em', LEAGUE_URL = 'https://beauahill.github.io/FootballPickEm/';

// Run once from the editor: creates the tabs and a default admin PIN (change it in the Settings tab).
function setup() {
  Object.keys(HEADERS).forEach(n => sheet_(n));
  if (!setting_('adminPin')) setSetting_('adminPin', '1234');
  ['nfl', 'cfb'].forEach(p => { if (!setting_('weeks_' + p)) setSetting_('weeks_' + p, '1'); });
  Object.entries(PAYOUT_DEFAULTS).forEach(([k, v]) => { if (!setting_(k)) setSetting_(k, String(v)); });
}
// Payout settings (editable in the page's Admin, stored in the Settings tab): entry fee per pool, % of the pot
// reserved for weekly winners (split evenly across the season's weeks), weeks per pool, and the season split.
const PAYOUT_DEFAULTS = { entryFee: 100, weeklyShare: 50, weeksNfl: 18, weeksCfb: 14, pct1: 70, pct2: 20, pct3: 10 };
// Text settings: accessCode gates registration (blank = open); venmo is the commissioner's handle shown on the Payments tab.
const TEXT_SETTINGS = { accessCode: '', venmo: '', leagueName: '', leagueUrl: '', adminEmail: '' };
// Favorite team (drives the page's team colors). Stored as the nickname, matching the Games tab's NFL names.
const NFL_TEAMS = ['Cardinals', 'Falcons', 'Ravens', 'Bills', 'Panthers', 'Bears', 'Bengals', 'Browns', 'Cowboys', 'Broncos', 'Lions', 'Packers', 'Texans', 'Colts', 'Jaguars', 'Chiefs',
  'Raiders', 'Chargers', 'Rams', 'Dolphins', 'Vikings', 'Patriots', 'Saints', 'Giants', 'Jets', 'Eagles', 'Steelers', '49ers', 'Seahawks', 'Buccaneers', 'Titans', 'Commanders'];
// Test copies: put testMode = 1 in the Settings tab and no email is sent (it's logged instead).
function mail_(o) { if (setting_('testMode')) { console.log('testMode — not sent: ' + o.subject + ' → ' + (o.bcc || o.to)); return; } MailApp.sendEmail(o); }
// Sheet cells that start with = + - @ are read as formulas. Anything typed by a player is stored as plain text.
const esc_ = v => typeof v === 'string' && (/^[=+@\t\r]/.test(v) || (/^-/.test(v) && isNaN(Number(v)))) ? "'" + v : v;
// Wrong-PIN throttle: after `max` misses in 15 minutes, that sign-in (or the admin PIN) is refused until the window passes.
function guard_(key, max) { try { if ((Number(CacheService.getScriptCache().get('fail_' + key)) || 0) >= max) throw new Error('Too many wrong PINs. Wait 15 minutes and try again.'); } catch (e) { if (/Too many/.test(e.message)) throw e; } }
function fail_(key) { try { const c = CacheService.getScriptCache(), n = (Number(c.get('fail_' + key)) || 0) + 1; c.put('fail_' + key, String(n), 900); } catch (e) {} }
function clearFails_(key) { try { CacheService.getScriptCache().remove('fail_' + key); } catch (e) {} }
// Scheduled jobs take the same lock as saves, but only around their sheet writes (ESPN fetches and emails happen outside it).
function withLock_(fn) { const l = LockService.getScriptLock(); if (!l.tryLock(30000)) { console.warn('Sheet busy — skipped this run'); return 0; } try { Object.keys(_rows).forEach(k => delete _rows[k]); return fn(); } finally { l.releaseLock(); } }
// A game is locked once it's scored or kicked off. A game with no kickoff time locks when its week's first game does.
function lockCheck_(games, now) {
  const begun = {}; games.forEach(g => { if ((g.kick && new Date(g.kick) <= now) || g.as !== '') begun[g.pool + '|' + Number(g.week)] = true; });
  return g => g.as !== '' || g.hs !== '' || (g.kick ? new Date(g.kick) <= now : !!begun[g.pool + '|' + Number(g.week)]);
}
// The tiebreaker locks when every game of the week is locked (the page disables the box at the same point).
function tbLocked_(pool, week, games, isLocked) { const wk = games.filter(g => g.pool === pool && Number(g.week) === week); return wk.length > 0 && wk.every(isLocked); }
const split_ = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
// Run once after pasting new code: makes Google ask for permission to reach ESPN, and prints how many games it sees.
function testEspn() { const n = espn_('nfl', 1).length; Logger.log('ESPN reachable — ' + n + ' NFL week 1 games'); return n; }
// Run once: pulls final scores from ESPN every hour for any week with games still unscored.
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('autoPull').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('remind').timeBased().everyHours(1).create();
}
// Hourly: email anyone missing picks on games that kick off within REMIND_HOURS. Returns how many emails went out.
function remind(locked) {
  const players = rows_('Players'), have = new Set(rows_('Picks').map(p => p.player + '|' + p.gameId));
  const sent = rows_('Reminders'), done = new Set(sent.map(r => r.player + '|' + r.gameId));
  const now = new Date(), horizon = new Date(now.getTime() + REMIND_HOURS * 3600e3);
  const games = rows_('Games').filter(g => g.kick && g.as === '' && new Date(g.kick) > now && new Date(g.kick) <= horizon).sort((a, b) => new Date(a.kick) - new Date(b.kick));
  const name = setting_('leagueName') || LEAGUE_NAME, url = setting_('leagueUrl') || LEAGUE_URL;
  let n = 0; const fresh = [];
  players.forEach(p => {
    const email = String(p.email || '').trim(); if (!email) return;
    const pools = split_(p.pools), miss = games.filter(g => pools.includes(g.pool) && !have.has(p.name + '|' + String(g.id)));
    if (!miss.length || miss.every(g => done.has(p.name + '|' + String(g.id)))) return;
    const lines = miss.map(g => '  • ' + g.away + ' at ' + g.home + ' — ' + Utilities.formatDate(new Date(g.kick), TZ, 'EEE h:mm a') + (g.pool === 'cfb' ? ' (College)' : ''));
    const body = 'Hey ' + p.name + ',\n\nYou have ' + miss.length + ' game' + (miss.length === 1 ? '' : 's') + ' kicking off in the next ' + REMIND_HOURS + ' hours with no pick:\n\n' + lines.join('\n') + '\n\nNo pick = automatic loss. Get in here: ' + url + '\n\n— ' + name;
    try {
      mail_({ to: email, subject: name + ': ' + miss.length + ' pick' + (miss.length === 1 ? '' : 's') + ' missing before kickoff', body });
      miss.forEach(g => fresh.push({ player: p.name, gameId: String(g.id), sent: new Date() })); n++;
    } catch (e) { console.warn('remind ' + email + ': ' + e); }
  });
  const save = () => { const cur = rows_('Reminders').concat(fresh); writeAll_('Reminders', cur.filter(r => games.some(g => String(g.id) === String(r.gameId)) || new Date(r.sent) > new Date(now.getTime() - 14 * 86400e3))); };
  if (n) locked === true ? save() : withLock_(save);   // the hourly trigger passes an event object, so only `true` means "already locked"
  return n;
}

function sheet_(n) { const ss = SpreadsheetApp.getActive(); let s = ss.getSheetByName(n); if (!s) { s = ss.insertSheet(n); s.appendRow(HEADERS[n]); s.setFrozenRows(1); }
  else if (HEADERS[n] && s.getLastColumn() < HEADERS[n].length) s.getRange(1, 1, 1, HEADERS[n].length).setValues([HEADERS[n]]);   // new columns added in later versions
  return s; }
// Each request reads every tab once (memoized for the life of the execution); writes drop the memo.
// Before this, state_() re-read the Settings tab a dozen times per call — the main reason the sheet got sluggish.
const _rows = {};
function rows_(n) { if (!_rows[n]) { const v = sheet_(n).getDataRange().getValues(); const h = v.shift(); _rows[n] = v.filter(r => String(r[0]) !== '').map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); } return _rows[n].map(r => ({ ...r })); }
function append_(n, row) { sheet_(n).appendRow(row.map(esc_)); delete _rows[n]; SpreadsheetApp.flush(); bust_(); }
// League state is cached for 5 minutes so page loads skip re-reading every tab. Any write busts it.
function bust_() { try { CacheService.getScriptCache().remove('st_n'); } catch (e) {} }
function cachedState_() {
  const c = CacheService.getScriptCache();
  try { const n = Number(c.get('st_n')); if (n) { const parts = c.getAll(Array.from({ length: n }, (_, i) => 'st_' + i)); const str = Array.from({ length: n }, (_, i) => parts['st_' + i]).join(''); if (str.length && Object.keys(parts).length === n) return str; } } catch (e) {}
  const str = JSON.stringify({ ok: true, ...state_() });
  try { const size = 90000, map = {}; let i = 0; for (; i * size < str.length; i++) map['st_' + i] = str.slice(i * size, (i + 1) * size); c.putAll(map, 300); c.put('st_n', String(i), 300); } catch (e) {}
  return str;
}
// Overwrites the tab in place, then clears leftover rows. (It used to clear the whole tab first, so a page load in that
// gap could read — and cache for 5 minutes — an empty tab.)
function writeAll_(n, objs) {
  const s = sheet_(n), H = HEADERS[n], vals = [H].concat(objs.map(o => H.map(k => esc_(o[k] == null ? '' : o[k]))));
  s.getRange(1, 1, vals.length, H.length).setValues(vals);
  const extra = s.getLastRow() - vals.length; if (extra > 0) s.getRange(vals.length + 1, 1, extra, Math.max(H.length, s.getLastColumn())).clearContent();
  delete _rows[n]; SpreadsheetApp.flush(); bust_();
}
function setting_(k) { const r = rows_('Settings').find(x => x.key === k); return r ? String(r.value) : ''; }
function setSettings_(m) { const all = rows_('Settings'); Object.entries(m).forEach(([k, v]) => { const r = all.find(x => x.key === k); if (r) r.value = v; else all.push({ key: k, value: v }); }); writeAll_('Settings', all); }
function setSetting_(k, v) { setSettings_({ [k]: v }); }
// The commissioner's address for the To line on BCC blasts. Set 'adminEmail' in Settings; Session.* is a fallback
// (it needs a permission scope Google only grants after re-running a function in the editor).
function me_() { const e = setting_('adminEmail'); if (e) return String(e).trim(); try { return Session.getEffectiveUser().getEmail(); } catch (x) { throw new Error('Add an adminEmail row to the Settings tab (your email) so results can be sent'); } }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet(e) { try { const a = (e.parameter || {}).action; if (a === 'state') return ContentService.createTextOutput(cachedState_()).setMimeType(ContentService.MimeType.JSON); return out_({ ok: true, service: 'pickem' }); } catch (err) { return out_({ ok: false, error: String(err.message || err) }); } }
function doPost(e) {
  const b = JSON.parse(e.postData.contents || '{}'), lock = LockService.getScriptLock();
  try { if (b.action !== 'login' && b.action !== 'mine') lock.waitLock(20000); return out_(handle_(b)); }
  catch (err) { return out_({ ok: false, error: String(err.message || err) }); }
  finally { try { lock.releaseLock(); } catch (e2) {} }
}

// viewer = the signed-in player's name on authenticated calls; the public (cached) state has no viewer.
// Other players' picks on games that haven't locked come back as '?' (so "who still owes picks" keeps working), and
// their tiebreaker guesses stay out until the week's tiebreaker locks.
function state_(viewer) {
  const games = rows_('Games'), isLocked = lockCheck_(games, new Date()), byId = {}; games.forEach(g => byId[String(g.id)] = g);
  const picks = {}; rows_('Picks').forEach(p => { const g = byId[String(p.gameId)]; picks[p.player + '|' + p.gameId] = (viewer && String(p.player) === viewer) || !g || isLocked(g) ? p.pick : '?'; });
  const tb = {}; rows_('Tiebreaks').forEach(t => { const m = /^(nfl|cfb)-(\d+)$/.exec(String(t.key)); if ((viewer && String(t.player) === viewer) || !m || tbLocked_(m[1], Number(m[2]), games, isLocked)) tb[t.player + '|' + t.key] = t.value; });
  const roster = rows_('Players').map(p => ({ name: String(p.name), pools: split_(p.pools), paid: split_(p.paid), note: String(p.note || ''), avatar: String(p.avatar || ''), team: String(p.team || '') }));
  const settings = {}; Object.keys(PAYOUT_DEFAULTS).forEach(k => { const v = setting_(k); settings[k] = v === '' ? PAYOUT_DEFAULTS[k] : Number(v); });
  settings.venmo = setting_('venmo');   // accessCode is deliberately NOT sent — admins see it via the 'auth' op
  const challenges = rows_('Challenges').map(c => ({ id: String(c.id), pool: String(c.pool), week: Number(c.week), from: String(c.from), to: String(c.to), amount: Number(c.amount), status: String(c.status), created: c.created ? new Date(c.created).toISOString() : '' }));
  return { data: { nfl: pool_('nfl'), cfb: pool_('cfb') }, players: roster.map(p => p.name), roster, settings, picks, tb, challenges };
}
// True once any game of the week has kicked off or been scored — callouts close then.
function weekStarted_(pool, week) { const now = new Date(); return rows_('Games').some(g => g.pool === pool && Number(g.week) === week && ((g.kick && new Date(g.kick) <= now) || g.as !== '')); 
}
function pool_(pool) {
  const gs = rows_('Games').filter(g => g.pool === pool);
  const n = Math.max(Number(setting_('weeks_' + pool)) || 1, ...gs.map(g => Number(g.week)));
  const weeks = [];
  for (let i = 1; i <= n; i++) weeks.push({ n: i, games: gs.filter(g => Number(g.week) === i).map(g => ({ id: String(g.id), away: String(g.away), home: String(g.home), when: String(g.when), as: g.as === '' ? null : Number(g.as), hs: g.hs === '' ? null : Number(g.hs), espnId: String(g.espnId || ''), spread: g.spread === '' || g.spread == null ? null : Number(g.spread), kick: g.kick ? new Date(g.kick).toISOString() : null })) });
  return { label: pool === 'nfl' ? 'NFL' : 'College', weeks };
}
function savePool_(pool, weeks) {
  const others = rows_('Games').filter(g => g.pool !== pool), mine = [];
  weeks.forEach(w => w.games.forEach(g => mine.push({ pool, week: w.n, id: g.id, away: g.away, home: g.home, when: g.when, as: g.as == null ? '' : g.as, hs: g.hs == null ? '' : g.hs, espnId: g.espnId || '', spread: g.spread == null ? '' : g.spread, kick: g.kick || '' })));
  writeAll_('Games', others.concat(mine));
  setSetting_('weeks_' + pool, String(weeks.length));
}

function handle_(b) {
  const players = rows_('Players');
  const norm = v => String(v || '').trim().toLowerCase();
  const findName = n => players.find(p => norm(p.name) === norm(n));
  const findEmail = e => players.find(p => norm(p.email) === norm(e));
  const pin = v => String(v == null ? '' : v).trim().replace(/\.0+$/, '').replace(/^0+(?=\d)/, '');
  const auth = () => { const key = 'p_' + norm(b.email); guard_(key, 8); const p = findEmail(b.email); if (!p) { fail_(key); throw new Error('Wrong email or PIN'); } if (pin(p.pin) !== pin(b.pin)) { fail_(key); throw new Error('Wrong email or PIN — sign out and back in if your PIN changed'); } clearFails_(key); return p; };
  const okName = n => { if (n.length < 2) throw new Error('Name too short'); if (n.length > 40) throw new Error('Name too long'); if (/^[=+\-@]/.test(n)) throw new Error('Names can\'t start with = + - or @'); };
  switch (b.action) {
    case 'register': {
      const name = String(b.name || '').trim(), email = norm(b.email);
      okName(name);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That email doesn\'t look right');
      if (!/^\d{4,}$/.test(String(b.pin))) throw new Error('PIN must be at least 4 digits');
      const code = setting_('accessCode'); if (code && norm(b.code) !== norm(code)) throw new Error('Wrong league access code. Ask the commissioner.');
      if (findName(name)) throw new Error('That name is taken — add a last initial');
      if (findEmail(email)) throw new Error('That email is already registered. Sign in instead.');
      const pools = (Array.isArray(b.pools) ? b.pools : ['nfl', 'cfb']).filter(p => p === 'nfl' || p === 'cfb');
      if (!pools.length) throw new Error('Pick at least one pool');
      append_('Players', [name, email, String(b.pin), new Date(), pools.join(','), '']);
      return { ok: true, name, email };
    }
    case 'login': { const p = auth(); return { ok: true, name: String(p.name), email: String(p.email) }; }
    // The signed-in player's own picks and tiebreakers (the public state hides unlocked ones). Read-only, no lock.
    case 'mine': {
      const p = auth(), me = String(p.name), picks = {}, tb = {};
      rows_('Picks').forEach(x => { if (String(x.player) === me) picks[me + '|' + x.gameId] = x.pick; });
      rows_('Tiebreaks').forEach(t => { if (String(t.player) === me) tb[me + '|' + t.key] = t.value; });
      return { ok: true, name: me, picks, tb };
    }
    case 'setTeam': {
      const p = auth(), t = String(b.team || '').trim();
      if (t && NFL_TEAMS.indexOf(t) < 0) throw new Error('Pick a team from the list');
      p.team = t; writeAll_('Players', players);
      return { ok: true, ...state_(String(p.name)) };
    }
    // Rename: names key Picks/Tiebreaks/Reminders/Challenges, so every tab is rewritten with the new name.
    case 'avatar': {
      const p = auth(), img = String(b.avatar || '');
      if (img && (!/^data:image\/(jpeg|png|webp);base64,/.test(img) || img.length > 30000)) throw new Error('Image too large — try another photo');
      p.avatar = img; writeAll_('Players', players);
      return { ok: true, ...state_(String(p.name)) };
    }
    case 'rename': {
      const p = auth(), old = String(p.name), name = String(b.name || '').trim();
      okName(name);
      if (norm(name) === norm(old)) return { ok: true, name: old, ...state_(old) };
      if (findName(name)) throw new Error('That name is taken — add a last initial');
      p.name = name; writeAll_('Players', players);
      const fix = (tab, keys) => { const all = rows_(tab); let hit = false; all.forEach(r => keys.forEach(k => { if (String(r[k]) === old) { r[k] = name; hit = true; } })); if (hit) writeAll_(tab, all); };
      fix('Picks', ['player']); fix('Tiebreaks', ['player']); fix('Reminders', ['player']); fix('Challenges', ['from', 'to']);
      return { ok: true, name, ...state_(name) };
    }
    case 'savePicks': {
      const p = auth(), me = String(p.name);
      {
        const games = rows_('Games'), isLocked = lockCheck_(games, new Date());
        // Only games that are still open may change. Locked games (kicked off or scored) are left exactly as they are —
        // an earlier version deleted the old pick before checking the lock, which wiped picks on games already played.
        // Anything that isn't one of the game's two teams (unknown game, '?', a formula) is skipped and the stored pick kept.
        const open = {};
        Object.entries(b.picks || {}).forEach(([gid, pick]) => {
          const g = games.find(x => String(x.id) === String(gid)); if (!g || isLocked(g)) return;
          const v = String(pick); if (v !== String(g.away) && v !== String(g.home)) return;
          open[String(g.id)] = v;
        });
        if (Object.keys(open).length) {
          const all = rows_('Picks').filter(x => !(String(x.player) === me && open[String(x.gameId)] !== undefined));
          Object.entries(open).forEach(([gid, pick]) => all.push({ player: me, gameId: gid, pick, updated: new Date() }));
          writeAll_('Picks', all);
        }
        // Tiebreaker: whole points 0-999 for a real pool-week, and only until that week's tiebreaker locks.
        const tbIn = {};
        Object.entries(b.tb || {}).forEach(([k, v]) => {
          const m = /^(nfl|cfb)-(\d+)$/.exec(String(k)), t = String(v).trim();
          if (!m || !/^\d{1,3}$/.test(t) || tbLocked_(m[1], Number(m[2]), games, isLocked)) return;
          tbIn[String(k)] = Number(t);
        });
        if (Object.keys(tbIn).length) {
          const tbs = rows_('Tiebreaks').filter(x => !(String(x.player) === me && tbIn[String(x.key)] !== undefined));
          Object.entries(tbIn).forEach(([k, v]) => tbs.push({ player: me, key: k, value: v }));
          writeAll_('Tiebreaks', tbs);
        }
      }
      return { ok: true, ...state_(me) };
    }
    // Head-to-head callouts: challenger names opponent + stake; opponent accepts or declines; closes at the week's first kickoff.
    case 'challenge': {
      const p = auth(), me = String(p.name), to = String(b.to || '').trim(), amt = Number(b.amount), week = Number(b.week), pool = String(b.pool);
      if (!findName(to) || norm(to) === norm(me)) throw new Error('Pick someone else to call out');
      if (!(amt > 0)) throw new Error('Amount must be more than $0');
      if (weekStarted_(pool, week)) throw new Error('Callouts closed at the first kickoff');
      const all = rows_('Challenges');
      if (all.some(c => String(c.pool) === pool && Number(c.week) === week && ['pending', 'accepted'].includes(String(c.status)) && ((String(c.from) === me && String(c.to) === to) || (String(c.from) === to && String(c.to) === me)))) throw new Error('You two already have a callout this week');
      if (pool !== 'nfl' && pool !== 'cfb') throw new Error('Bad pool');
      append_('Challenges', ['c' + Date.now().toString(36), pool, week, me, to, amt, 'pending', new Date()]);
      return { ok: true, ...state_(me) };
    }
    case 'respond': {
      const p = auth(), me = String(p.name), all = rows_('Challenges'), c = all.find(x => String(x.id) === String(b.id)); if (!c) throw new Error('No such callout');
      const st = String(b.status);
      if (String(c.status) !== 'pending') throw new Error('That callout is already settled');
      if (!['accepted', 'declined', 'withdrawn'].includes(st)) throw new Error('Bad status');
      if ((st === 'accepted' || st === 'declined') && String(c.to) !== me) throw new Error('Only the player called out can answer');
      if (st === 'withdrawn' && String(c.from) !== me) throw new Error('Only the challenger can withdraw');
      if (weekStarted_(String(c.pool), Number(c.week))) throw new Error('Callouts closed at the first kickoff');
      c.status = st; writeAll_('Challenges', all); return { ok: true, ...state_(me) };
    }
    case 'admin': guard_('admin', 10); if (String(b.adminPin) !== setting_('adminPin')) { fail_('admin'); throw new Error('Wrong admin PIN'); } clearFails_('admin'); return admin_(b);
  }
  throw new Error('Unknown action');
}
function admin_(b) {
  switch (b.op) {
    case 'auth': return { ok: true, accessCode: setting_('accessCode') };
    case 'setPool': {
      if (b.weeks) savePool_(b.pool, b.weeks);
      if (b.settings) { const m = {}; Object.keys(PAYOUT_DEFAULTS).forEach(k => { if (b.settings[k] != null && b.settings[k] !== '') m[k] = String(Number(b.settings[k])); });
        Object.keys(TEXT_SETTINGS).forEach(k => { if (b.settings[k] != null) m[k] = String(b.settings[k]).trim(); }); if (Object.keys(m).length) setSettings_(m); }
      return { ok: true, ...state_() };
    }
    case 'setPaid': {
      const all = rows_('Players'); const p = all.find(x => String(x.name) === b.name); if (!p) throw new Error('No such player');
      let paid = split_(p.paid).filter(x => x !== b.pool); if (b.paid) paid.push(b.pool); p.paid = paid.join(',');
      if (b.paid && !split_(p.pools).includes(b.pool)) p.pools = split_(p.pools).concat(b.pool).join(',');
      writeAll_('Players', all); return { ok: true, ...state_() };
    }
    case 'setNote': {
      const all = rows_('Players'); const p = all.find(x => String(x.name) === b.name); if (!p) throw new Error('No such player');
      p.note = String(b.note || '').trim().slice(0, 200); writeAll_('Players', all); return { ok: true, ...state_() };
    }
    case 'setPools': {
      const all = rows_('Players'); const p = all.find(x => String(x.name) === b.name); if (!p) throw new Error('No such player');
      p.pools = (b.pools || []).filter(x => x === 'nfl' || x === 'cfb').join(','); writeAll_('Players', all); return { ok: true, ...state_() };
    }
    case 'removePlayer':
      writeAll_('Players', rows_('Players').filter(p => String(p.name) !== b.name));
      writeAll_('Picks', rows_('Picks').filter(p => String(p.player) !== b.name));
      writeAll_('Challenges', rows_('Challenges').filter(c => String(c.from) !== b.name && String(c.to) !== b.name));
      return { ok: true, ...state_() };
    case 'importWeek': {
      const P = pool_(b.pool), w = P.weeks[b.week - 1]; if (!w) throw new Error('No such week');
      const have = new Set(w.games.map(g => g.espnId)); let added = 0;
      espn_(b.pool, b.week).forEach(g => { if (b.pool === 'cfb' && !g.ranked) return; if (have.has(g.espnId)) return; w.games.push(g); added++; });
      savePool_(b.pool, P.weeks);
      return { ok: true, added, ...state_() };
    }
    case 'pullScores': return { ok: true, updated: pull_(b.pool, b.week, true), ...state_() };
    case 'sendReminders': return { ok: true, sent: remind(true), ...state_() };
    case 'sendResults': return { ok: true, sent: sendResults_(b.pool, Number(b.week)), ...state_() };
    case 'notify': return { ok: true, sent: notify_(String(b.to || 'all'), String(b.subject || ''), String(b.message || '')), ...state_() };
  }
  throw new Error('Unknown admin op');
}
function pull_(pool, week, locked) {
  const ev = espn_(pool, week);   // network first, outside the lock
  return locked === true ? applyPull_(pool, week, ev) : withLock_(() => applyPull_(pool, week, ev));
}
function applyPull_(pool, week, ev) {
  const P = pool_(pool), w = P.weeks[week - 1]; if (!w) return 0;
  let n = 0;
  w.games.forEach(g => {
    const m = ev.find(e => (g.espnId && e.espnId === g.espnId) || (e.away.toLowerCase() === g.away.toLowerCase() && e.home.toLowerCase() === g.home.toLowerCase()));
    if (m && g.spread == null && m.spread != null) { g.spread = m.spread; n++; }
    if (m && m.final && (g.as !== m.as || g.hs !== m.hs)) { g.as = m.as; g.hs = m.hs; g.espnId = m.espnId; n++; }
  });
  if (n) savePool_(pool, P.weeks);
  return n;
}
// Hourly: import the current week's schedule if it hasn't been set up yet, then pull any final scores.
function autoPull() {
  ['nfl', 'cfb'].forEach(pool => {
    try { autoImport_(pool); } catch (e) { console.warn('autoImport ' + pool + ': ' + e); }
    pool_(pool).weeks.forEach(w => { if (w.games.some(g => g.as == null || g.hs == null)) { try { pull_(pool, w.n); } catch (e) { console.warn('pull ' + pool + ' wk' + w.n + ': ' + e); } } });
  });
  withLock_(weeklyResults_);
}
// After the last game of a week is scored, email everyone in that pool the results once.
function weeklyResults_() {
  ['nfl', 'cfb'].forEach(pool => pool_(pool).weeks.forEach(w => {
    if (!w.games.length || !w.games.every(g => g.as != null && g.hs != null)) return;
    if (setting_('resultsSent_' + pool + '_' + w.n)) return;
    try { const n = sendResults_(pool, w.n); console.log('results ' + pool + ' wk' + w.n + ': sent to ' + n); }
    catch (e) { console.warn('results ' + pool + ' wk' + w.n + ': ' + e); }
  }));
}
function sendResults_(pool, weekN) {
  const P = pool_(pool), w = P.weeks[weekN - 1]; if (!w || !w.games.length) throw new Error('No games in that week');
  if (!w.games.every(g => g.as != null && g.hs != null)) throw new Error('Week ' + weekN + ' still has unscored games');
  const players = rows_('Players').filter(p => split_(p.pools).includes(pool));
  const picks = {}; rows_('Picks').forEach(p => picks[p.player + '|' + p.gameId] = String(p.pick));
  const winnerOf = g => Number(g.hs) > Number(g.as) ? g.home : g.away;
  const rec = (name, wk) => { let x = 0, y = 0; wk.games.forEach(g => { if (g.as == null || g.hs == null) return; picks[name + '|' + g.id] === winnerOf(g) ? x++ : y++; }); return [x, y]; };
  const finals = P.weeks.filter(x => x.n <= weekN && x.games.length && x.games.every(g => g.as != null && g.hs != null));
  const rows = players.map(p => { const n = String(p.name), wk = rec(n, w); let sw = 0, sl = 0; finals.forEach(f => { const r = rec(n, f); sw += r[0]; sl += r[1]; }); return { n, ww: wk[0], wl: wk[1], sw, sl }; }).sort((a, b) => b.sw - a.sw || b.ww - a.ww || a.n.localeCompare(b.n));
  if (!rows.length) return 0;
  const by = {}; rows.forEach(r => by[r.n] = r);
  const weekRows = rows.slice().sort((a, b) => b.ww - a.ww || a.n.localeCompare(b.n)), best = weekRows[0].ww, worst = weekRows[weekRows.length - 1];
  let wins = weekRows.filter(r => r.ww === best);
  // tie → closest guess at total points in the week's last game
  const lg = w.games[w.games.length - 1], totalPts = lg && lg.as != null && lg.hs != null ? lg.as + lg.hs : null;
  const tied = wins.length, tbs = {}; rows_('Tiebreaks').forEach(t => tbs[t.player + '|' + t.key] = t.value);
  const tbVal = r => { const v = tbs[r.n + '|' + pool + '-' + weekN]; return v === '' || v == null || isNaN(Number(v)) ? null : Number(v); };
  if (wins.length > 1 && totalPts != null) { const guess = r => { const v = tbVal(r); return v == null ? Infinity : Math.abs(v - totalPts); }; const bd = Math.min.apply(null, wins.map(guess)); if (bd !== Infinity) wins = wins.filter(r => guess(r) === bd); }
  const tbWon = tied > 1 && wins.length === 1, tbSplit = tied > 1 && wins.length > 1;
  const names = rows.map(r => r.n).sort((a, b) => a.localeCompare(b));
  const rivalOf = (p, n) => { const arr = names.slice(); if (arr.length % 2) arr.push(null); const m = arr.length; if (m < 2) return null; const r = (n - 1) % (m - 1), rest = arr.slice(1), rot = rest.slice(rest.length - r).concat(rest.slice(0, rest.length - r)), line = [arr[0]].concat(rot), i = line.indexOf(p); return i < 0 ? null : line[m - 1 - i]; };
  const label = pool === 'nfl' ? 'NFL' : 'College', name = setting_('leagueName') || LEAGUE_NAME, url = setting_('leagueUrl') || LEAGUE_URL;
  const L = [label + ' Week ' + weekN + ' is in the books.', ''];
  L.push('WEEK WINNER' + (wins.length > 1 ? 'S (tie)' : '') + ': ' + wins.map(r => r.n + ' (' + r.ww + '-' + r.wl + ')').join(', '));
  if (tbWon) { const g = tbVal(wins[0]); L.push('  Won on the tiebreaker — ' + tied + ' tied at ' + best + ' correct. Total points in ' + lg.away + ' at ' + lg.home + ': ' + totalPts + (g != null ? '. ' + wins[0].n + ' guessed ' + g + '.' : '.')); }
  else if (tbSplit) L.push('  ' + tied + ' tied at ' + best + ' correct and the tiebreaker didn\'t settle it — prize split.');
  L.push('BASEMENT: ' + worst.n + ' (' + worst.ww + '-' + worst.wl + ')');
  const rk = (arr, key) => { let rank = 0, prev = null; return arr.map((r, i) => { if (r[key] !== prev) { rank = i + 1; prev = r[key]; } const tie = arr.filter(x => x[key] === r[key]).length > 1; return (tie ? 'T' : '') + rank + '.'; }); };
  const wr = rk(weekRows, 'ww'), sr = rk(rows, 'sw');
  L.push('', 'THIS WEEK'); weekRows.forEach((r, i) => L.push('  ' + wr[i] + ' ' + r.n + '  ' + r.ww + '-' + r.wl + (tbWon && r.n === wins[0].n ? '  (tiebreaker)' : '')));
  L.push('', 'SEASON'); rows.forEach((r, i) => L.push('  ' + sr[i] + ' ' + r.n + '  ' + r.sw + '-' + r.sl + (rows[0].sw - r.sw ? '  (' + (rows[0].sw - r.sw) + ' back)' : '')));
  const seen = new Set(), riv = [];
  names.forEach(n => { const r = rivalOf(n, weekN); if (!r || seen.has(n)) return; seen.add(n); seen.add(r); riv.push('  ' + n + ' ' + by[n].ww + ' – ' + by[r].ww + ' ' + r + (by[n].ww === by[r].ww ? '  (push)' : '')); });
  if (riv.length) L.push('', 'RIVALRIES', ...riv);
  const ch = rows_('Challenges').filter(c => String(c.pool) === pool && Number(c.week) === weekN && String(c.status) === 'accepted' && by[String(c.from)] && by[String(c.to)]);
  if (ch.length) { L.push('', 'CALLOUTS'); ch.forEach(c => { const a = by[String(c.from)], b = by[String(c.to)]; L.push('  ' + c.from + ' ' + a.ww + ' – ' + b.ww + ' ' + c.to + ': ' + (a.ww > b.ww ? c.from + ' wins $' + c.amount : a.ww < b.ww ? c.to + ' wins $' + c.amount : 'push')); }); }
  L.push('', 'Full results and next week\'s games: ' + url, '', '— ' + name);
  const emails = players.map(p => String(p.email || '').trim()).filter(Boolean);
  if (emails.length) mail_({ to: me_(), bcc: emails.join(','), subject: name + ': ' + label + ' Week ' + weekN + ' results — ' + wins.map(r => r.n).join(' & ') + ' take' + (wins.length > 1 ? '' : 's') + ' it', body: L.join('\n') });
  setSetting_('resultsSent_' + pool + '_' + weekN, new Date().toISOString());
  return emails.length;
}
// Admin notice: to = 'all' or a player name.
function notify_(to, subject, message) {
  const name = setting_('leagueName') || LEAGUE_NAME, players = rows_('Players');
  const list = (to === 'all' ? players : players.filter(p => String(p.name) === to)).map(p => String(p.email || '').trim()).filter(Boolean);
  if (!list.length) throw new Error('No email on file for that player');
  if (!String(subject || '').trim() || !String(message || '').trim()) throw new Error('Need a subject and a message');
  const body = String(message).trim() + '\n\n— ' + name;
  if (to === 'all') mail_({ to: me_(), bcc: list.join(','), subject: name + ': ' + subject.trim(), body });
  else mail_({ to: list[0], subject: name + ': ' + subject.trim(), body });
  return list.length;
}
function autoImport_(pool) {
  const cur = currentWeek_(pool); if (!cur) return;
  { const P = pool_(pool), w = P.weeks[cur - 1]; if (w && w.games.length) return; }
  const ev = espn_(pool, cur);   // network first, outside the lock
  withLock_(() => {
    const P = pool_(pool);
    while (P.weeks.length < cur) P.weeks.push({ n: P.weeks.length + 1, games: [] });
    const w = P.weeks[cur - 1]; if (w.games.length) return;
    ev.forEach(g => { if (pool === 'cfb' && !g.ranked) return; w.games.push(g); });
    if (w.games.length) savePool_(pool, P.weeks);
  });
}
function currentWeek_(pool) {
  const url = 'https://site.api.espn.com/apis/site/v2/sports/football/' + (pool === 'nfl' ? 'nfl' : 'college-football') + '/scoreboard';
  const j = fetchJson_(url);
  return j.week && j.week.number ? Number(j.week.number) : 0;
}
// ESPN's public scoreboard feed (unofficial, but stable for years). NFL team = nickname ("Cowboys"); college = school ("Texas").
function espn_(pool, week) {
  if (!week) throw new Error('No week');
  const base = 'https://site.api.espn.com/apis/site/v2/sports/football/' + (pool === 'nfl' ? 'nfl' : 'college-football') + '/scoreboard';
  const url = base + '?dates=' + SEASON + '&seasontype=2&week=' + week + (pool === 'cfb' ? '&groups=80&limit=400' : '');
  const j = fetchJson_(url);
  return (j.events || []).map(e => {
    const c = e.competitions[0], home = c.competitors.find(x => x.homeAway === 'home'), away = c.competitors.find(x => x.homeAway === 'away');
    const name = t => pool === 'nfl' ? t.team.name : t.team.location, rk = t => !!(t.curatedRank && t.curatedRank.current <= 25);
    const final = !!(c.status && c.status.type && c.status.type.completed);
    const spread = homeLine_(c.odds && c.odds[0], home, away);
    return { id: 'e' + e.id, espnId: String(e.id), away: name(away), home: name(home), when: Utilities.formatDate(new Date(e.date), TZ, 'EEE h:mm a'), kick: new Date(e.date).toISOString(), spread, as: final ? Number(away.score) : null, hs: final ? Number(home.score) : null, final, ranked: rk(home) || rk(away) };
  });
}
// ESPN blocks Google's servers directly (HTTP 403), so try a couple of public relays. The page's Admin buttons
// fetch ESPN straight from the commissioner's browser and never hit this path.
function fetchJson_(url) {
  const tries = [url, 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url), 'https://corsproxy.io/?' + encodeURIComponent(url)];
  let last = '';
  for (const u of tries) {
    try {
      const r = UrlFetchApp.fetch(u, { muteHttpExceptions: true, headers: { 'Accept': 'application/json' } });
      const code = r.getResponseCode(), t = r.getContentText();
      if (code >= 400) { last = 'HTTP ' + code; continue; }
      return JSON.parse(t);
    } catch (e) { last = String(e.message || e); }
  }
  throw new Error('Could not reach ESPN from Google (' + last + '). Use the Import / Pull buttons in Admin instead.');
}
// Home-team line as a number (negative = home favored). ESPN's "details" reads like "KC -6.5".
function homeLine_(o, home, away) {
  if (!o) return null;
  const m = /^([A-Z&]+)\s([+-]?\d+(?:\.\d+)?)$/.exec(String(o.details || '').trim());
  if (m) { const n = Number(m[2]); if (m[1] === home.team.abbreviation) return n; if (m[1] === away.team.abbreviation) return -n; }
  if (/EVEN|PK/i.test(String(o.details || ''))) return 0;
  return typeof o.spread === 'number' ? o.spread : null;
}
