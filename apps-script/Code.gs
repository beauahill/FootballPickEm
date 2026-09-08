// Football Pick Em — Google Apps Script backend. Paste into a Google Sheet's Apps Script editor. See SETUP.md.
const TZ = 'America/Denver';   // kickoff times are shown in this time zone
const SEASON = 2026;
const HEADERS = {
  Players: ['name', 'email', 'pin', 'joined', 'pools', 'paid'],
  Games: ['pool', 'week', 'id', 'away', 'home', 'when', 'as', 'hs', 'espnId', 'spread'],
  Picks: ['player', 'gameId', 'pick', 'updated'],
  Tiebreaks: ['player', 'key', 'value'],
  Settings: ['key', 'value']
};

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
const TEXT_SETTINGS = { accessCode: '', venmo: '' };
const split_ = v => String(v || '').split(',').map(x => x.trim()).filter(Boolean);
// Run once after pasting new code: makes Google ask for permission to reach ESPN, and prints how many games it sees.
function testEspn() { const n = espn_('nfl', 1).length; Logger.log('ESPN reachable — ' + n + ' NFL week 1 games'); return n; }
// Run once: pulls final scores from ESPN every hour for any week with games still unscored.
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('autoPull').timeBased().everyHours(1).create();
}

function sheet_(n) { const ss = SpreadsheetApp.getActive(); let s = ss.getSheetByName(n); if (!s) { s = ss.insertSheet(n); s.appendRow(HEADERS[n]); s.setFrozenRows(1); } return s; }
function rows_(n) { const v = sheet_(n).getDataRange().getValues(); const h = v.shift(); return v.filter(r => String(r[0]) !== '').map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))); }
function writeAll_(n, objs) { const s = sheet_(n), H = HEADERS[n]; s.clearContents(); s.appendRow(H); if (objs.length) s.getRange(2, 1, objs.length, H.length).setValues(objs.map(o => H.map(k => o[k] == null ? '' : o[k]))); }
function setting_(k) { const r = rows_('Settings').find(x => x.key === k); return r ? String(r.value) : ''; }
function setSetting_(k, v) { const all = rows_('Settings'); const r = all.find(x => x.key === k); if (r) r.value = v; else all.push({ key: k, value: v }); writeAll_('Settings', all); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet(e) { try { const a = (e.parameter || {}).action; if (a === 'state') return out_({ ok: true, ...state_() }); return out_({ ok: true, service: 'pickem' }); } catch (err) { return out_({ ok: false, error: String(err.message || err) }); } }
function doPost(e) { try { return out_(handle_(JSON.parse(e.postData.contents || '{}'))); } catch (err) { return out_({ ok: false, error: String(err.message || err) }); } }

function state_() {
  const picks = {}; rows_('Picks').forEach(p => picks[p.player + '|' + p.gameId] = p.pick);
  const tb = {}; rows_('Tiebreaks').forEach(t => tb[t.player + '|' + t.key] = t.value);
  const roster = rows_('Players').map(p => ({ name: String(p.name), pools: split_(p.pools), paid: split_(p.paid) }));
  const settings = {}; Object.keys(PAYOUT_DEFAULTS).forEach(k => { const v = setting_(k); settings[k] = v === '' ? PAYOUT_DEFAULTS[k] : Number(v); });
  settings.venmo = setting_('venmo');   // accessCode is deliberately NOT sent — admins see it via the 'auth' op
  return { data: { nfl: pool_('nfl'), cfb: pool_('cfb') }, players: roster.map(p => p.name), roster, settings, picks, tb };
}
function pool_(pool) {
  const gs = rows_('Games').filter(g => g.pool === pool);
  const n = Math.max(Number(setting_('weeks_' + pool)) || 1, ...gs.map(g => Number(g.week)));
  const weeks = [];
  for (let i = 1; i <= n; i++) weeks.push({ n: i, games: gs.filter(g => Number(g.week) === i).map(g => ({ id: String(g.id), away: String(g.away), home: String(g.home), when: String(g.when), as: g.as === '' ? null : Number(g.as), hs: g.hs === '' ? null : Number(g.hs), espnId: String(g.espnId || ''), spread: g.spread === '' || g.spread == null ? null : Number(g.spread) })) });
  return { label: pool === 'nfl' ? 'NFL' : 'College', weeks };
}
function savePool_(pool, weeks) {
  const others = rows_('Games').filter(g => g.pool !== pool), mine = [];
  weeks.forEach(w => w.games.forEach(g => mine.push({ pool, week: w.n, id: g.id, away: g.away, home: g.home, when: g.when, as: g.as == null ? '' : g.as, hs: g.hs == null ? '' : g.hs, espnId: g.espnId || '', spread: g.spread == null ? '' : g.spread })));
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
      sheet_('Players').appendRow([name, email, String(b.pin), new Date(), pools.join(','), '']);
      return { ok: true, name, email };
    }
    case 'login': { const p = auth(); return { ok: true, name: String(p.name), email: String(p.email) }; }
    case 'savePicks': {
      const p = auth(), me = String(p.name), lock = LockService.getScriptLock(); lock.waitLock(10000);
      try {
        const games = rows_('Games');
        const all = rows_('Picks').filter(x => !(String(x.player) === me && (b.picks || {})[x.gameId] !== undefined));
        Object.entries(b.picks || {}).forEach(([gid, pick]) => {
          const g = games.find(x => String(x.id) === gid);
          if (g && (g.as !== '' || g.hs !== '')) return;   // scores in — game is locked
          all.push({ player: me, gameId: gid, pick, updated: new Date() });
        });
        writeAll_('Picks', all);
        const tbs = rows_('Tiebreaks').filter(x => !(String(x.player) === me && (b.tb || {})[x.key] !== undefined));
        Object.entries(b.tb || {}).forEach(([k, v]) => tbs.push({ player: me, key: k, value: v }));
        writeAll_('Tiebreaks', tbs);
      } finally { lock.releaseLock(); }
      return { ok: true, ...state_() };
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
      return { ok: true, ...state_() };
    case 'importWeek': {
      const P = pool_(b.pool), w = P.weeks[b.week - 1]; if (!w) throw new Error('No such week');
      const have = new Set(w.games.map(g => g.espnId)); let added = 0;
      espn_(b.pool, b.week).forEach(g => { if (b.pool === 'cfb' && !g.ranked) return; if (have.has(g.espnId)) return; w.games.push(g); added++; });
      savePool_(b.pool, P.weeks);
      return { ok: true, added, ...state_() };
    }
    case 'pullScores': return { ok: true, updated: pull_(b.pool, b.week), ...state_() };
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
    return { id: 'e' + e.id, espnId: String(e.id), away: name(away), home: name(home), when: Utilities.formatDate(new Date(e.date), TZ, 'EEE h:mm a'), spread, as: final ? Number(away.score) : null, hs: final ? Number(home.score) : null, final, ranked: rk(home) || rk(away) };
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
