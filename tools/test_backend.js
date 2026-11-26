// Backend checks against an in-memory fake Sheet. Run: node tools/test_backend.js
const fs=require('fs'), vm=require('vm');
const sheets={}; let formulas=0;
const store=v=>{ if(typeof v==='string'&&v[0]==="'") return v.slice(1); if(typeof v==='string'&&/^[=+@]/.test(v)) {formulas++; return 'FORMULA:'+v;} return v; };
function mk(name){ const rows=[]; return { rows,
  appendRow(r){rows.push(r.map(store))}, setFrozenRows(){}, getLastColumn(){return Math.max(0,...rows.map(r=>r.length))}, getLastRow(){return rows.length},
  getDataRange(){return {getValues:()=>rows.map(r=>{const w=this.getLastColumn();return Array.from({length:w},(_,i)=>r[i]===undefined?'':r[i])})}},
  getRange(r,c,nr,nc){return { setValues:(v)=>{v.forEach((row,i)=>{rows[r-1+i]=rows[r-1+i]||[];row.forEach((x,j)=>rows[r-1+i][c-1+j]=store(x))})}, clearContent:()=>{rows.splice(r-1,nr)} }} } }
const ss={getSheetByName:n=>sheets[n],insertSheet:n=>sheets[n]=mk(n)};
const cache={}; const C={get:k=>cache[k]??null,put:(k,v)=>cache[k]=v,remove:k=>delete cache[k],getAll:ks=>Object.fromEntries(ks.filter(k=>k in cache).map(k=>[k,cache[k]])),putAll:m=>Object.assign(cache,m)};
const mails=[];
const ctx={console,Date,JSON,Math,Number,String,Object,Array,Set,isNaN,
 SpreadsheetApp:{getActive:()=>ss,flush(){}}, CacheService:{getScriptCache:()=>C}, LockService:{getScriptLock:()=>({waitLock(){},tryLock(){return true},releaseLock(){}})},
 ContentService:{createTextOutput:t=>({t,setMimeType(){return this}}),MimeType:{JSON:1}}, MailApp:{sendEmail:o=>mails.push(o)},
 Utilities:{formatDate:d=>String(d)}, Logger:{log(){}}, Session:{getEffectiveUser:()=>({getEmail:()=>'x@y.z'})}};
vm.createContext(ctx); vm.runInContext(fs.readFileSync(__dirname + '/../apps-script/Code.gs','utf8'),ctx);
const post=b=>JSON.parse(ctx.doPost({postData:{contents:JSON.stringify(b)}}).t), get=()=>JSON.parse(ctx.doGet({parameter:{action:'state'}}).t);
let ok=0,bad=0; const t=(name,c)=>{ if(c){ok++;console.log('PASS',name)} else {bad++;console.log('FAIL',name)} };
ctx.setup();
const H=new Date(Date.now()-3600e3).toISOString(), F=new Date(Date.now()+86400e3).toISOString(), F2=new Date(Date.now()+2*86400e3).toISOString();
// week 5: g1 started, g2/g3 future, g4 no kick
ctx.writeAll_('Games',[{pool:'nfl',week:5,id:'g1',away:'Steelers',home:'Browns',when:'',as:'',hs:'',kick:H},{pool:'nfl',week:5,id:'g2',away:'Colts',home:'Cowboys',when:'',as:'',hs:'',kick:F},{pool:'nfl',week:5,id:'g3',away:'Chiefs',home:'Bills',when:'',as:'',hs:'',kick:F2},
 {pool:'nfl',week:6,id:'g4',away:'Jets',home:'Dolphins',when:'',as:'',hs:'',kick:''},{pool:'nfl',week:6,id:'g5',away:'Bears',home:'Lions',when:'',as:'',hs:'',kick:F}]);
t('register', post({action:'register',name:'Beau',email:'b@x.com',pin:'1234',code:''}).ok);
t('register 2', post({action:'register',name:'Dusty',email:'d@x.com',pin:'5555'}).ok);
t('formula name rejected', !post({action:'register',name:'=Settings!B1',email:'e@x.com',pin:'1111'}).ok);
let r=post({action:'savePicks',email:'b@x.com',pin:'1234',picks:{g1:'Browns',g2:'Cowboys',g3:'=Settings!B2',g4:'Jets',gX:'Colts'},tb:{'nfl-5':'47','nfl-6':'=1+1','bad':'3'}});
t('save ok', r.ok);
const P=sheets.Picks.rows.slice(1); t('locked g1 skipped', !P.some(p=>p[1]==='g1')); t('g2 saved', P.some(p=>p[1]==='g2'&&p[2]==='Cowboys'));
t('formula pick skipped', !P.some(p=>p[1]==='g3')); t('unknown game skipped', !P.some(p=>p[1]==='gX'));
t('kickless g4 open while week 6 not started', P.some(p=>p[1]==='g4'));
t('tb saved numeric', sheets.Tiebreaks.rows.slice(1).some(x=>x[1]==='nfl-5'&&x[2]===47)); t('bad tb skipped', sheets.Tiebreaks.rows.length===2);
t('own picks visible in authed state', r.picks['Beau|g2']==='Cowboys');
post({action:'savePicks',email:'d@x.com',pin:'5555',picks:{g2:'Colts'},tb:{'nfl-5':50}});
let s=get(); t('others hidden publicly', s.picks['Beau|g2']==='?' && s.picks['Dusty|g2']==='?');
t('others tb hidden', s.tb['Beau|nfl-5']===undefined);
t('team in roster', s.roster[0].team==='');
r=post({action:'mine',email:'d@x.com',pin:'5555'}); t('mine returns own', r.picks['Dusty|g2']==='Colts' && r.tb['Dusty|nfl-5']===50 && !r.picks['Beau|g2']);
r=post({action:'savePicks',email:'d@x.com',pin:'5555',picks:{}}); t('dusty sees beau hidden', r.picks['Beau|g2']==='?' && r.picks['Dusty|g2']==='Colts');
t('setTeam bad', !post({action:'setTeam',email:'b@x.com',pin:'1234',team:'Huskies'}).ok);
r=post({action:'setTeam',email:'b@x.com',pin:'1234',team:'Broncos'}); t('setTeam ok', r.ok && r.roster.find(p=>p.name==='Beau').team==='Broncos');
// old client sends '?' for a hidden pick: stored pick must survive
post({action:'savePicks',email:'b@x.com',pin:'1234',picks:{g2:'?'}}); t('? keeps stored pick', sheets.Picks.rows.some(p=>p[0]==='Beau'&&p[1]==='g2'&&p[2]==='Cowboys'));
// lock g2 by kickoff → revealed
const g=sheets.Games.rows.find(x=>x[2]==='g2'); g[10]=H; delete ctx._rows; 
vm.runInContext("Object.keys(_rows).forEach(k=>delete _rows[k]); bust_();",ctx);
s=get(); t('revealed after kickoff', s.picks['Beau|g2']==='Cowboys');
t('late change rejected', (post({action:'savePicks',email:'b@x.com',pin:'1234',picks:{g2:'Colts'}}), sheets.Picks.rows.some(p=>p[0]==='Beau'&&p[1]==='g2'&&p[2]==='Cowboys')));
// all wk5 locked → tb locked & revealed
const g3=sheets.Games.rows.find(x=>x[2]==='g3'); g3[10]=H; vm.runInContext("Object.keys(_rows).forEach(k=>delete _rows[k]); bust_();",ctx);
post({action:'savePicks',email:'b@x.com',pin:'1234',picks:{},tb:{'nfl-5':99}}); t('tb locked server-side', sheets.Tiebreaks.rows.some(x=>x[0]==='Beau'&&x[2]===47));
s=get(); t('tb revealed when locked', s.tb['Beau|nfl-5']===47);
// week 6 starts (g5 kicks) → kickless g4 locks
const g5=sheets.Games.rows.find(x=>x[2]==='g5'); g5[10]=H; vm.runInContext("Object.keys(_rows).forEach(k=>delete _rows[k]); bust_();",ctx);
post({action:'savePicks',email:'b@x.com',pin:'1234',picks:{g4:'Dolphins'}}); t('kickless locks at week start', sheets.Picks.rows.some(p=>p[0]==='Beau'&&p[1]==='g4'&&p[2]==='Jets'));
// throttle
for(let i=0;i<8;i++) post({action:'login',email:'d@x.com',pin:'0000'});
r=post({action:'login',email:'d@x.com',pin:'5555'}); t('throttled after 8 misses', !r.ok && /Too many/.test(r.error));
r=post({action:'login',email:'b@x.com',pin:'1234'}); t('other player unaffected', r.ok);
for(let i=0;i<10;i++) post({action:'admin',op:'auth',adminPin:'x'}); t('admin throttled', /Too many/.test(post({action:'admin',op:'auth',adminPin:'1234'}).error));
delete cache['fail_admin'];
// setPool settings batching + testMode
t('admin save', post({action:'admin',op:'setPool',adminPin:'1234',pool:'nfl',settings:{entryFee:120,venmo:'=HYPERLINK("x")'}}).ok);
t('venmo stored as text', sheets.Settings.rows.some(r=>r[0]==='venmo'&&r[1]==='=HYPERLINK("x")'));
ctx.setSetting_('testMode','1'); post({action:'admin',op:'notify',adminPin:'1234',to:'all',subject:'hi',message:'yo'}); t('testMode blocks mail', mails.length===0);
t('no formulas ever stored', formulas===0);
t('remind via trigger signature', typeof ctx.remind({})==='number');
console.log(ok,'passed',bad,'failed');
