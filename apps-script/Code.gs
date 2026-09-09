// Football Pick Em — Google Apps Script backend. Paste into a Google Sheet's Apps Script editor. See SETUP.md.
const TZ = 'America/Denver';   // kickoff times are shown in this time zone
const SEASON = 2026;
const HEADERS = {
  Players: ['name', 'email', 'pin', 'joined', 'pools', 'paid'],
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
const TEXT_SETTINGS = { accessCode: '', venmo: '', leagueName: '', leagueUrl: '' };
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
function remind() {
  const players = rows_('Players'), have = new Set(rows_('Picks').map(p => p.player + '|' + p.gameId));
  const sent = rows_('Reminders'), done = new Set(sent.map(r => r.player + '|' + r.gameId));
  const now = new Date(), horizon = new Date(now.getTime() + REMIND_HOURS * 3600e3);
  const games = rows_('Games').filter(g => g.kick && g.as === '' && new Date(g.kick) > now && new Date(g.kick) <= horizon).sort((a, b) => new Date(a.kick) - new Date(b.kick));
  const name = setting_('leagueName') || LEAGUE_NAME, url = setting_('leagueUrl') || LEAGUE_URL;
  let n = 0;
  players.forEach(p => {
    const email = String(p.email || '').trim(); if (!email) return;
    const pools = split_(p.pools), miss = games.filter(g => pools.includes(g.pool) && !have.has(p.name + '|' + String(g.id)));
    if (!miss.length || miss.every(g => done.has(p.name + '|' + String(g.id)))) return;
    const lines = miss.map(g => '  • ' + g.away + ' at ' + g.home + ' — ' + Utilities.formatDate(new Date(g.kick), TZ, 'EEE h:mm a') + (g.pool === 'cfb' ? ' (College)' : ''));
    const body = 'Hey ' + p.name + ',\n\nYou have ' + miss.length + ' game' + (miss.length === 1 ? '' : 's') + ' kicking off in the next ' + REMIND_HOURS + ' hours with no pick:\n\n' + lines.join('\n') + '\n\nNo pick = automatic loss. Get in here: ' + url + '\n\n— ' + name;
    try {
      MailApp.sendEmail({ to: email, subject: name + ': ' + miss.length + ' pick' + (miss.length === 1 ? '' : 's') + ' missing before kickoff', body });
      miss.forEach(g => sent.push({ player: p.name, gameId: String(g.id), sent: new Date() })); n++;
    } catch (e) { console.warn('remind ' + email + ': ' + e); }
  });
  if (n) writeAll_('Reminders', sent.filter(r => games.some(g => String(g.id) === String(r.gameId)) || new Date(r.sent) > new Date(now.getTime() - 14 * 86400e3)));
  return n;
}

function sheet_(n) { const ss = SpreadsheetApp.getActive(); let s = ss.getSheetByName(n); if (!s) { s = ss.insertSheet(n); s.appendRow(HEADERS[n]); s.setFrozenRows(1); } return s; }
// Each request reads every tab once (memoized for the life of the execution); writes drop the memo.
// Before this, state_() re-read the Settings tab a dozen times per call — the main reason the sheet got sluggish.
const _rows = {};
function rows_(n) { if (!_rows[n]) { const v = sheet_(n).getDataRange().getValues(); const h = v.shift(); _rows[n] = v.filter(r => String(r[0]) !== '').map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); } return _rows[n].map(r => ({ ...r })); }
function append_(n, row) { sheet_(n).appendRow(row); delete _rows[n]; }
function writeAll_(n, objs) { const s = sheet_(n), H = HEADERS[n]; s.clearContents(); s.appendRow(H); if (objs.length) s.getRange(2, 1, objs.length, H.length).setValues(objs.map(o => H.map(k => o[k] == null ? '' : o[k]))); delete _rows[n]; }
function setting_(k) { const r = rows_('Settings').find(x => x.key === k); return r ? String(r.value) : ''; }
function setSetting_(k, v) { const all = rows_('Settings'); const r = all.find(x => x.key === k); if (r) r.value = v; else all.push({ key: k, value: v }); writeAll_('Settings', all); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet(e) { try { const a = (e.parameter || {}).action; if (a === 'state') return out_({ ok: true, ...state_() }); return out_({ ok: true, service: 'pickem' }); } catch (err) { return out_({ ok: false, error: String(err.message || err) }); } }
function doPost(e) {
  const b = JSON.parse(e.postData.contents || '{}'), lock = LockService.getScriptLock();
  try { if (b.action !== 'login') lock.waitLock(20000); return out_(handle_(b)); }
  catch (err) { return out_({ ok: false, error: String(err.message || err) }); }
  finally { try { lock.releaseLock(); } catch (e2) {} }
}

function state_() {
  const picks = {}; rows_('Picks').forEach(p => picks[p.player + '|' + p.gameId] = p.pick);
  const tb = {}; rows_('Tiebreaks').forEach(t => tb[t.player + '|' + t.key] = t.value);
  const roster = rows_('Players').map(p => ({ name: String(p.name), pools: split_(p.pools), paid: split_(p.paid) }));
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
  const auth = () => { const p = findEmail(b.email); if (!p || String(p.pin) !== String(b.pin)) throw new Error('Wrong email or PIN'); return p; };
  switch (b.action) {
    case 'register': {
      const name = String(b.name || '').trim(), email = norm(b.email);
      if (name.length < 2) throw new Error('Name too short');
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
    case 'savePicks': {
      const p = auth(), me = String(p.name);
      {
        const games = rows_('Games'), now = new Date();
        const all = rows_('Picks').filter(x => !(String(x.player) === me && (b.picks || {})[x.gameId] !== undefined));
        Object.entries(b.picks || {}).forEach(([gid, pick]) => {
          const g = games.find(x => String(x.id) === gid);
          if (g && (g.as !== '' || g.hs !== '')) return;   // scores in — game is locked
          if (g && g.kick && new Date(g.kick) <= now) return;   // game has kicked off
          all.push({ player: me, gameId: gid, pick, updated: new Date() });
        });
        writeAll_('Picks', all);
        const tbs = rows_('Tiebreaks').filter(x => !(String(x.player) === me && (b.tb || {})[x.key] !== undefined));
        Object.entries(b.tb || {}).forEach(([k, v]) => tbs.push({ player: me, key: k, value: v }));
        writeAll_('Tiebreaks', tbs);
      }
      return { ok: true, ...state_() };
    }
    // Head-to-head callouts: challenger names opponent + stake; opponent accepts or declines; closes at the week's first kickoff.
    case 'challenge': {
      const p = auth(), me = String(p.name), to = String(b.to || '').trim(), amt = Number(b.amount), week = Number(b.week), pool = String(b.pool);
      if (!findName(to) || norm(to) === norm(me)) throw new Error('Pick someone else to call out');
      if (!(amt > 0)) throw new Error('Amount must be more than $0');
      if (weekStarted_(pool, week)) throw new Error('Callouts closed at the first kickoff');
      const all = rows_('Challenges');
      if (all.some(c => String(c.pool) === pool && Number(c.week) === week && ['pending', 'accepted'].includes(String(c.status)) && ((String(c.from) === me && String(c.to) === to) || (String(c.from) === to && String(c.to) === me)))) throw new Error('You two already have a callout this week');
      append_('Challenges', ['c' + Date.now().toString(36), pool, week, me, to, amt, 'pending', new Date()]);
      return { ok: true, ...state_() };
    }
    case 'respond': {
      const p = auth(), me = String(p.name), all = rows_('Challenges'), c = all.find(x => String(x.id) === String(b.id)); if (!c) throw new Error('No such callout');
      const st = String(b.status);
      if (String(c.status) !== 'pending') throw new Error('That callout is already settled');
      if (!['accepted', 'declined', 'withdrawn'].includes(st)) throw new Error('Bad status');
      if ((st === 'accepted' || st === 'declined') && String(c.to) !== me) throw new Error('Only the player called out can answer');
      if (st === 'withdrawn' && String(c.from) !== me) throw new Error('Only the challenger can withdraw');
      if (weekStarted_(String(c.pool), Number(c.week))) throw new Error('Callouts closed at the first kickoff');
      c.status = st; writeAll_('Challenges', all); return { ok: true, ...state_() };
    }
    case 'admin': if (String(b.adminPin) !== setting_('adminPin')) throw new Error('Wrong admin PIN'); return admin_(b);
  }
  throw new Error('Unknown action');
}
function admin_(b) {
  switch (b.op) {
    case 'auth': return { ok: true, accessCode: setting_('accessCode') };
    case 'setPool': {
      if (b.weeks) savePool_(b.pool, b.weeks);
      if (b.settings) { Object.keys(PAYOUT_DEFAULTS).forEach(k => { if (b.settings[k] != null && b.settings[k] !== '') setSetting_(k, String(Number(b.settings[k]))); });
        Object.keys(TEXT_SETTINGS).forEach(k => { if (b.settings[k] != null) setSetting_(k, String(b.settings[k]).trim()); }); }
      return { ok: true, ...state_() };
    }
    case 'setPaid': {
      const all = rows_('Players'); const p = all.find(x => String(x.name) === b.name); if (!p) throw new Error('No such player');
      let paid = split_(p.paid).filter(x => x !== b.pool); if (b.paid) paid.push(b.pool); p.paid = paid.join(',');
      if (b.paid && !split_(p.pools).includes(b.pool)) p.pools = split_(p.pools).concat(b.pool).join(',');
      writeAll_('Players', all); return { ok: true, ...state_() };
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
    case 'pullScores': return { ok: true, updated: pull_(b.pool, b.week), ...state_() };
    case 'sendReminders': return { ok: true, sent: remind(), ...state_() };
    case 'sendResults': return { ok: true, sent: sendResults_(b.pool, Number(b.week)), ...state_() };
    case 'notify': return { ok: true, sent: notify_(String(b.to || 'all'), String(b.subject || ''), String(b.message || '')), ...state_() };
  }
  throw new Error('Unknown admin op');
}
function pull_(pool, week) {
  const P = pool_(pool), w = P.weeks[week - 1]; if (!w) return 0;
  const ev = espn_(pool, week); let n = 0;
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
    pool_(pool).weeks.forEach(w => { if (w.games.some(g => g.as == null || g.hs == null)) pull_(pool, w.n); });
  });
  try { weeklyResults_(); } catch (e) { console.warn('weeklyResults: ' + e); }
}
// After the last game of a week is scored, email everyone in that pool the results once.
function weeklyResults_() {
  ['nfl', 'cfb'].forEach(pool => pool_(pool).weeks.forEach(w => {
    if (!w.games.length || !w.games.every(g => g.as != null && g.hs != null)) return;
    if (setting_('resultsSent_' + pool + '_' + w.n)) return;
    sendResults_(pool, w.n);
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
  const weekRows = rows.slice().sort((a, b) => b.ww - a.ww || a.n.localeCompare(b.n)), best = weekRows[0].ww, wins = weekRows.filter(r => r.ww === best), worst = weekRows[weekRows.length - 1];
  const names = rows.map(r => r.n).sort((a, b) => a.localeCompare(b));
  const rivalOf = (p, n) => { const arr = names.slice(); if (arr.length % 2) arr.push(null); const m = arr.length; if (m < 2) return null; const r = (n - 1) % (m - 1), rest = arr.slice(1), rot = rest.slice(rest.length - r).concat(rest.slice(0, rest.length - r)), line = [arr[0]].concat(rot), i = line.indexOf(p); return i < 0 ? null : line[m - 1 - i]; };
  const label = pool === 'nfl' ? 'NFL' : 'College', name = setting_('leagueName') || LEAGUE_NAME, url = setting_('leagueUrl') || LEAGUE_URL;
  const L = [label + ' Week ' + weekN + ' is in the books.', ''];
  L.push('WEEK WINNER' + (wins.length > 1 ? 'S (tie)' : '') + ': ' + wins.map(r => r.n + ' (' + r.ww + '-' + r.wl + ')').join(', '));
  L.push('BASEMENT: ' + worst.n + ' (' + worst.ww + '-' + worst.wl + ')');
  L.push('', 'THIS WEEK'); weekRows.forEach((r, i) => L.push('  ' + (i + 1) + '. ' + r.n + '  ' + r.ww + '-' + r.wl));
  L.push('', 'SEASON'); rows.forEach((r, i) => L.push('  ' + (i + 1) + '. ' + r.n + '  ' + r.sw + '-' + r.sl + (i ? '  (' + (rows[0].sw - r.sw) + ' back)' : '')));
  const seen = new Set(), riv = [];
  names.forEach(n => { const r = rivalOf(n, weekN); if (!r || seen.has(n)) return; seen.add(n); seen.add(r); riv.push('  ' + n + ' ' + by[n].ww + ' – ' + by[r].ww + ' ' + r + (by[n].ww === by[r].ww ? '  (push)' : '')); });
  if (riv.length) L.push('', 'RIVALRIES', ...riv);
  const ch = rows_('Challenges').filter(c => String(c.pool) === pool && Number(c.week) === weekN && String(c.status) === 'accepted' && by[String(c.from)] && by[String(c.to)]);
  if (ch.length) { L.push('', 'CALLOUTS'); ch.forEach(c => { const a = by[String(c.from)], b = by[String(c.to)]; L.push('  ' + c.from + ' ' + a.ww + ' – ' + b.ww + ' ' + c.to + ': ' + (a.ww > b.ww ? c.from + ' wins $' + c.amount : a.ww < b.ww ? c.to + ' wins $' + c.amount : 'push')); }); }
  L.push('', 'Full results and next week\'s games: ' + url, '', '— ' + name);
  const emails = players.map(p => String(p.email || '').trim()).filter(Boolean);
  if (emails.length) MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), bcc: emails.join(','), subject: name + ': ' + label + ' Week ' + weekN + ' results — ' + wins.map(r => r.n).join(' & ') + ' take' + (wins.length > 1 ? '' : 's') + ' it', body: L.join('\n') });
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
  if (to === 'all') MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), bcc: list.join(','), subject: name + ': ' + subject.trim(), body });
  else MailApp.sendEmail({ to: list[0], subject: name + ': ' + subject.trim(), body });
  return list.length;
}
function autoImport_(pool) {
  const cur = currentWeek_(pool); if (!cur) return;
  const P = pool_(pool);
  while (P.weeks.length < cur) P.weeks.push({ n: P.weeks.length + 1, games: [] });
  const w = P.weeks[cur - 1]; if (w.games.length) return;
  espn_(pool, cur).forEach(g => { if (pool === 'cfb' && !g.ranked) return; w.games.push(g); });
  if (w.games.length) savePool_(pool, P.weeks);
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
