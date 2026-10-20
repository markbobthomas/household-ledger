/* Household Ledger · Planning-first UI.
 * Only read-only bank facts + derived forecasts. Saved planning settings stay in
 * the existing encrypted Real adjustments; no Real account data in localStorage.
 * Legacy spending/reporting UI remains on the separate backup branch.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const escapeHTML=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const cash=n=>n===null||n===undefined||!Number.isFinite(Number(n))?'Unavailable':
 new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(n));
const dateToday=()=>new Date().toLocaleDateString('en-CA');
const dayLabel=date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
const dateLong=date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const dayDelta=(a,b)=>Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000);
const model=window.HouseholdLedgerData;
const available=()=>Boolean(window.HouseholdLiveSource);
const rawDemo=window.createHouseholdLedgerDemo?window.createHouseholdLedgerDemo():{transactions:[],items:[]};
const demoState=model.migrate(rawDemo);
const DEMO_SETTINGS='household-planner-sample-settings-v1';
try{
 const saved=JSON.parse(localStorage.getItem(DEMO_SETTINGS)||'{}');
 if(saved&&typeof saved==='object'&&!Array.isArray(saved)){
  const keys=['primaryAccountId','plannerRoutineDecisions','paymentRules','cashCushion',
    'futureTransactionEdits','futureTransactionAdds','futureSeriesEdits'];
  for(const key of keys)if(saved[key]!==undefined)demoState.predictions[key]=saved[key];
 }
}catch{}
let liveState=null,liveSnapshot=null,selectedAccount=null,horizon=90,latestError='',lastSuggestions=[];
let activeTab='overview',transactionFilter='all',editingKey='',showNewTransaction=false,transactionNotice='';
let audit=null,auditAccount=null,auditError='',auditMeta=null;
function clearAudit(){audit=null;auditAccount=null;auditError='';auditMeta=null}
function savePlanning(){
 if(live())return window.HouseholdLiveSource.persist(liveState)
 else {
  const p=demoState.predictions||{};
  localStorage.setItem(DEMO_SETTINGS,JSON.stringify({primaryAccountId:p.primaryAccountId,
   plannerRoutineDecisions:p.plannerRoutineDecisions,paymentRules:p.paymentRules,cashCushion:p.cashCushion,
   futureTransactionEdits:p.futureTransactionEdits,futureTransactionAdds:p.futureTransactionAdds,
   futureSeriesEdits:p.futureSeriesEdits}));
  return true;
 }
}
function requestedReal(){return available()&&localStorage.getItem('household-ledger-view-mode')==='real'}
function live(){return Boolean(liveState&&liveSnapshot)}
function snapshot(){return live()?liveSnapshot:window.HouseholdBankFeed.getSnapshot(dateToday())}
function state(){return live()?liveState:demoState}
function setNotice(message){latestError=message||'';render()}
function accountType(a){return String(a.accountType||a.type||'').toLowerCase()==='credit'?'credit':'cash'}
function isChecking(a){return accountType(a)==='cash'&&
 (String(a.accountType||a.subtype||'').toLowerCase()==='checking'||
  String(a.type||'').toLowerCase()==='depository'&&String(a.subtype||'').toLowerCase()!=='savings')}
function freshness(a){const status=a.balanceStatus;return status==='fresh'||status==='simulated'}
function sourceTag(){if(requestedReal()&&!live())return window.HouseholdLiveSource?.error?'REAL · UNAVAILABLE':'CONNECTING';return live()?'REAL BANK':'DEMO DATA'}
function activeAccounts(s){return Array.isArray(s?.accounts)?s.accounts:[]}
function recurringEvents(events,s){
 const accounts=activeAccounts(s),tools=window.HouseholdPlannerTransactions,
  series=state().predictions?.futureSeriesEdits||{};
 const findAccount=raw=>{
  const value=String(raw||'');
  const options=accounts.filter(a=>[a.id,a.transactionAccount,a.name]
   .some(alias=>String(alias||'')===value));
  return options.length===1?String(options[0].id):value;
 };
 return (events||[]).map(e=>{
  const originalAccount=findAccount(e.accountId||e.account),key=tools.seriesEvent(e,originalAccount);
  return {...tools.applySeries(e,e.date,key,series),
   _seriesKey:key,_seriesDate:e.date,_forecastOriginalAccountId:originalAccount};
 });
}
function forecastForPayments(events,s){
 const accounts=activeAccounts(s),edits=state().predictions?.futureTransactionEdits||{};
 const extras=state().predictions?.futureTransactionAdds||[];
 const resolve=value=>{
  const raw=String(value||'');
  const match=accounts.filter(a=>String(a.id)===raw||String(a.name)===raw||
   String(a.transactionAccount||'')===raw);
  return match.length===1?String(match[0].id):raw;
 };
 const keyFor=e=>window.HouseholdPlannerTransactions.keyEvent(e.id,resolve(e.accountId||e.account));
 const amended=(events||[]).flatMap(e=>{
  const edit=edits[keyFor(e)];
  return edit?.skipped?[]:[edit?{...e,...edit}:e];
 });
 return [...amended,...extras.filter(e=>e.type!=='transfer')];
}
function forecastFor(s){
 if(!s||!activeAccounts(s).length)return null;
 const rows=model.records(state()),asOf=s.asOf||dateToday();
 const forecast=window.HouseholdForecastLedger.build(state(),rows,asOf,90,
  window.HouseholdForecast,model);
 const routines=window.HouseholdPlannerIntelligence.project(state(),rows,forecast.events,asOf);
 const recurring=recurringEvents(routines.events,s);
 const payments=window.HouseholdPaymentObligations.build(s,rows,forecastForPayments(recurring,s),state().predictions||{},{days:90});
 const suppress=new Set(payments.suppressedExpectedIds||[]);
 const cardPlans=payments.plans||[];
 const rawPlans=state().predictions?.accountMovements||[];
 const manualPlans=rawPlans.filter(p=>{
  const dates=window.HouseholdAccountForecast.occurrences(p,asOf,shiftDay(asOf,90));
  const duplicate=cardPlans.some(card=>card.fromAccountId===p.fromAccountId&&card.toAccountId===p.toAccountId&&
   dates.some(date=>Math.abs(dayDelta(date,card.anchorDate))<=3));
  return !duplicate;
 });
 const events=[...recurring.filter(e=>!suppress.has(String(e.id))),...recurringEvents(payments.billEvents,s)];
 const personal=state().predictions||{};
 const forecastAccount=window.HouseholdAccountForecast.build(s,events,[...manualPlans,...cardPlans],
  {days:90,records:rows,futureTransactionEdits:personal.futureTransactionEdits||{},
   futureTransactionAdds:personal.futureTransactionAdds||[],
   futureSeriesEdits:personal.futureSeriesEdits||{},seriesTools:window.HouseholdPlannerTransactions});
 return {forecast,routines,payments,projection:forecastAccount,rows,events};
}
function shiftDay(iso,n){const d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)}
function selected(s){
 const all=activeAccounts(s),cashAccounts=all.filter(a=>accountType(a)==='cash');
 const chosen=all.find(a=>String(a.id)===String(selectedAccount));
 const preferred=all.find(a=>String(a.id)===String(state().predictions?.primaryAccountId));
 return chosen||preferred||cashAccounts.find(a=>a.subtype==='checking'||a.accountType==='checking')||cashAccounts[0]||all[0]||null;
}
function textForStatus(a){
 if(a.balanceStatus==='simulated')return {label:'SAMPLE DATA',css:'warn',detail:'Fictional accounts · try the layout without connecting a bank.'};
 if(a.balanceStatus==='fresh')return {label:'BANK REPORTED',css:'good',detail:'Starting balance from the connected bank. Future balances are forecasts.'};
 if(a.balanceStatus==='stale')return {label:'OUTDATED',css:'bad',detail:'Bank balance is over two days old. Refresh before relying on the forecast.'};
 if(a.balanceStatus==='unknown-age')return {label:'UNVERIFIED',css:'bad',detail:'Bank balance observation time is unavailable; coverage cannot be trusted.'};
 if(a.balanceStatus==='unavailable')return {label:'NO BALANCE',css:'bad',detail:'This account has no usable reported starting balance.'};
 if(a.balanceStatus==='future-dated')return {label:'UNVERIFIED',css:'bad',detail:'The bank balance observation date needs verification.'};
 return {label:'REVIEW',css:'warn',detail:'Account balance or connection status needs verification.'};
}
function badge(status){return '<span class="status-tag '+escapeHTML(status.css||'')+'">'+escapeHTML(status.label)+'</span>'}
function accountCards(s,projection,chosen){
 return '<div class="section-title"><h2>Your accounts</h2><p>Select an account to see its plan</p></div>'+
  '<div class="account-strip" id="account-picker">'+activeAccounts(s).map(a=>{
   const derived=projection?.accounts.find(x=>String(x.id)===String(a.id));
   const type=accountType(a);
   const val=derived?(type==='credit'?derived.openingCurrent:derived.openingAvailable??derived.opening):type==='credit'?a.current:a.available??a.current;
   return '<button type="button" class="account-tile" data-account-id="'+escapeHTML(a.id)+'" aria-pressed="'+String(String(chosen?.id)===String(a.id))+'">'+
    '<span class="account-name">'+(String(a.id)===String(state().predictions?.primaryAccountId)?'★ ':'')+escapeHTML(a.name||'Unnamed account')+'</span>'+
    '<strong class="account-amount">'+cash(val)+'</strong>'+
    '<span class="account-type">'+(type==='credit'?'CREDIT CARD DEBT':'STARTING CASH BALANCE')+'</span></button>';
  }).join('')+'</div>';
}
function miniChart(series,asOf){
 if(!Array.isArray(series)||series.length<2)return '<div class="empty-visual">The balance graph will appear when a starting balance is available.</div>';
 const vals=series.map(x=>Number(x.balance)).filter(Number.isFinite);
 if(vals.length!==series.length)return '<div class="empty-visual">Forecast cannot be graphed without verified account values.</div>';
 const low=Math.min(...vals),high=Math.max(...vals),spread=Math.max(1,high-low);
 const w=850,h=205,px=11,top=18,base=173,inner=base-top;
 const pos=(v,i)=>[(px+i*(w-2*px)/(series.length-1)).toFixed(2),(base-(v-low)/spread*inner).toFixed(2)];
 const coords=vals.map(pos);
 const path=coords.map(([x,y],i)=>(i?'L':'M')+x+' '+y).join(' ');
 const area=path+' L '+coords.at(-1)[0]+' '+base+' L '+px+' '+base+' Z';
 const zero=low<0&&high>0?base-(0-low)/spread*inner:null;
 const zeroLine=zero===null?'':'<line x1="'+px+'" x2="'+(w-px)+'" y1="'+zero+'" y2="'+zero+'" stroke="#cf9ca3" stroke-dasharray="4 6" stroke-width="1"/>';
 return '<div class="chart-wrap"><svg viewBox="0 0 '+w+' '+h+'" role="img" aria-label="Projected daily balance from '+
  escapeHTML(dateLong(asOf))+' to '+escapeHTML(dateLong(series.at(-1).date))+'. Minimum '+escapeHTML(cash(low))+'.">'+
  '<defs><linearGradient id="balance-fill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#315ebd" stop-opacity=".15"/><stop offset="1" stop-color="#315ebd" stop-opacity="0"/></linearGradient></defs>'+
  '<line x1="'+px+'" y1="'+base+'" x2="'+(w-px)+'" y2="'+base+'" stroke="#e1e6eb"/>'+
  zeroLine+'<path d="'+area+'" fill="url(#balance-fill)"/>'+
  '<path d="'+path+'" stroke="#315ebd" stroke-width="2.8" fill="none" stroke-linejoin="round" stroke-linecap="round"/>'+
  '<circle cx="'+coords.at(-1)[0]+'" cy="'+coords.at(-1)[1]+'" r="4" fill="#315ebd"/>'+
  '</svg><div class="chart-labels"><span>'+escapeHTML(dayLabel(asOf))+'</span><span>'+escapeHTML(dayLabel(series[Math.floor(series.length/2)].date))+
  '</span><span>'+escapeHTML(dayLabel(series.at(-1).date))+'</span></div></div>';
}
function hero(a,derived,asOf){
 if(!derived)return '<section class="panel"><div class="empty-visual">Select a connected account to see its projected balance.</div></section>';
 const credit=derived.type==='credit';
 const status=textForStatus(derived),fresh=freshness(derived),isCash=!credit;
 const opening=credit?derived.openingCurrent:derived.openingAvailable??derived.openingCurrent;
 const safety=Number(state().predictions?.cashCushion??500);
 const horizonSeries=(derived.series||[]).filter(d=>d.date<=shiftDay(asOf,horizon));
 const validPoints=horizonSeries.filter(d=>Number.isFinite(d.balance));
 const lowPoint=validPoints.length?validPoints.reduce((a,b)=>a.balance<=b.balance?a:b):null;
 const lowest=lowPoint?.balance,lowDate=lowPoint?.date;
 const firstNegative=isCash?horizonSeries.find(d=>Number.isFinite(d.balance)&&d.balance<0):null;
 const year=+asOf.slice(0,4),month=+asOf.slice(5,7);
 const endOfMonth=asOf.slice(0,7)+'-'+String(new Date(Date.UTC(year,month,0)).getUTCDate()).padStart(2,'0');
 const monthPoint=(derived.series||[]).filter(d=>d.date<=endOfMonth).at(-1);
 const monthBalance=monthPoint?.balance;
 const below=fresh&&isCash&&Number.isFinite(lowest)&&lowest<safety;
 const label=credit?'Credit card debt':'Cash available';
 const summary=credit?
  'Credit purchases increase card debt without withdrawing cash from checking. Card autopay is a separate dated checking payment.':
  'Only identified repeating payments and deposits are included. Groceries, gas and other variable purchases are not guessed.';
 const main=String(a.id)===String(state().predictions?.primaryAccountId);
 return '<section class="panel hero" aria-label="Selected account projection">'+
  '<div><div class="hero-title"><div class="hero-label">'+escapeHTML(a.name||derived.name)+'</div>'+
   (main?'<span class="status-tag good">MAIN ACCOUNT</span>':'')+badge(status)+'</div>'+
  '<div class="balance-main">'+cash(opening)+'</div>'+
  '<p class="hero-footnote">'+escapeHTML(label)+' · '+escapeHTML(summary)+'</p>'+
  (!main&&isChecking(a)?'<button type="button" class="btn" data-set-main="'+escapeHTML(a.id)+'" style="margin-top:14px">Make this my main account</button>':'')+
  (!fresh?'<p class="hero-footnote" style="margin-top:9px;color:var(--red)">'+escapeHTML(status.detail)+'</p>':'')+
  '</div><div class="hero-stats">'+
  '<div class="metric"><span>'+(credit?'Projected debt at month end':"Available after this month's dated payments")+'</span>'+
   '<strong class="'+(fresh&&isCash&&monthBalance<0?'low':'')+'">'+
    (fresh?cash(monthBalance):'Unverified')+'</strong>'+
   '<small>'+escapeHTML(dayLabel(endOfMonth))+' · includes expected deposits</small></div>'+
  '<div class="metric"><span>'+(credit?'Lowest debt · next '+horizon+' days':'Lowest balance · next '+horizon+' days')+'</span>'+
   '<strong class="'+(below?'low':'')+'">'+(fresh?cash(lowest):'Unverified')+'</strong>'+
   '<small>'+(fresh&&lowDate?escapeHTML(dayLabel(lowDate)):'Confirm bank balance first')+'</small></div>'+
  '<div class="metric metric-wide"><span>'+(isCash?'First projected shortfall':'Projected debt · day '+horizon)+'</span>'+
   '<strong class="'+(fresh&&firstNegative?'low':'')+'">'+
    (fresh?(isCash?(firstNegative?escapeHTML(dateLong(firstNegative.date)):'None from dated payments'):cash(horizonSeries.at(-1)?.balance)):'Unverified')+'</strong>'+
   '<small>'+(isCash&&firstNegative?'Projected cash below $0 · not a guaranteed outcome':
    isCash?'Excludes unplanned purchases and unconfirmed costs':'Future card charges remain estimates')+'</small></div>'+
  '</div></section>';
}
function eventDirection(e){
 if(['income','refund','transfer_in','card_refund'].includes(e.kind))return 'incoming';
 if(e.kind==='card_purchase')return 'outgoing';
 return 'outgoing';
}
function movementRows(a,derived,s,routine){
 const cut=shiftDay(s.asOf,horizon);
 const tags=new Map((routine?.events||[]).map(e=>[String(e.id),e.planConfidence]));
 const records=(derived.events||[]).filter(e=>e.date>s.asOf&&e.date<=cut).sort((x,y)=>x.date.localeCompare(y.date)||x.merchant.localeCompare(y.merchant));
 if(!records.length)return '<div class="forecast-empty"><h3>No dated movements to show yet</h3>'+
  '<p>No repeating payments currently meet the stable-amount criteria for this account. Confirm a detected repeat below or add a card payment schedule.</p></div>';
 const first=records.slice(0,12),later=records.slice(12);
 const single=e=>{
  const day=derived.series.find(x=>x.date===e.date),ending=day?.balance;
  const income=eventDirection(e)==='incoming';
  const suffix=e.kind==='card_purchase'?'Expected card purchase':e.kind==='transfer_out'?'Payment or transfer':e.kind==='transfer_in'?'Payment or transfer':e.kind==='income'?'Expected deposit':e.kind==='card_refund'?'Card credit':'Expected withdrawal';
  return '<div class="payment-line" data-payment-date="'+escapeHTML(e.date)+'">'+
   '<div class="payment-date">'+escapeHTML(dayLabel(e.date))+'</div>'+
   '<div><div class="payment-name">'+escapeHTML(e.merchant||'Scheduled movement')+'</div><div class="payment-meta">'+escapeHTML(suffix)+
    (tags.get(String(e.id))==='suggested'?' · SUGGESTED · confirm below':tags.get(String(e.id))==='confirmed'?' · Confirmed':' · Planned')+'</div></div>'+
   '<div class="payment-value '+(income?'incoming':'outgoing')+'">'+(income?'+':'−')+cash(e.amount)+'</div>'+
   '<div class="after-value"><strong class="'+(!freshness(derived)||!Number.isFinite(ending)?'':derived.type!=='credit'&&ending<Number(state().predictions?.cashCushion??500)?'risk':'')+'">'+
    (freshness(derived)&&Number.isFinite(ending)?cash(ending):'Unverified')+'</strong><small>End of day</small></div></div>';
 };
 return '<div class="list-head"><span>Date</span><span>Expected movement</span><span style="text-align:right">Amount</span><span style="text-align:right">Balance after</span></div>'+
 first.map(single).join('')+
 (later.length?'<details class="details"><summary>Show '+later.length+' more expected movement'+(later.length===1?'':'s')+'</summary>'+
  later.map(single).join('')+'</details>':'');
}
function connectionPanel(s,models){
 const list=activeAccounts(s);
 const real=live(),source=available(),connected=source&&real;
 const text=real?list.length+' connected account'+(list.length===1?'':'s')+' · last sync '+(s.lastSuccessfulSync?escapeHTML(new Date(s.lastSuccessfulSync).toLocaleString()):'unknown'):
  'Fictional accounts shown. Connected bank balances appear when Real mode is selected.';
 return '<section class="small-grid" aria-label="Planning foundation">'+
  '<div class="panel mini-panel"><h3>Accounts and bank connection</h3><p>'+text+'</p>'+
  (source?'<a class="btn" href="/bank-connect">Manage bank connections</a>':'<span class="status-tag warn">PRIVATE BANK CONNECTION REQUIRED FOR REAL DATA</span>')+
  '</div><div class="panel mini-panel"><h3>Planning assumptions</h3><p>For now the model uses existing bank history and any saved payment schedules. Income is an estimate, not a confirmed future deposit. Unscheduled purchases are not included as precise withdrawals.</p>'+
  '<span class="status-tag">FOUNDATION · READY FOR YOUR DECISIONS</span></div></section>';
}

function routineReviewPanel(bundle){
 const r=bundle?.routines;if(!r)return '';
 const suggestions=r.review||[],total=r.counts||{};
 if(!suggestions.length)return '<section class="panel mini-panel" aria-label="Routine payment confirmations">'+
  '<div class="section-title"><h2>Repeating payments</h2><span class="status-tag good">NOTHING TO REVIEW</span></div>'+
  '<p>Only stable repeating bills and deposits are predicted. Unscheduled shopping and groceries are excluded.</p>'+
  '<p class="hero-footnote">'+Number(total.confirmed||0)+' confirmed upcoming movement(s).</p></section>';
 const lines=suggestions.map(s=>'<div class="routine-review-line" data-routine-key="'+escapeHTML(s.key)+'">'+
  '<div><strong>'+escapeHTML(s.merchant)+'</strong><small>'+escapeHTML(s.account)+' · '+escapeHTML(s.frequency)+
   ' · '+s.observed+' past payments · Next '+escapeHTML(dayLabel(s.next))+'</small></div>'+
  '<strong>'+cash(s.amount)+'</strong><div class="routine-actions">'+
  '<button type="button" class="btn primary" data-confirm-routine="'+escapeHTML(s.key)+'">Confirm once</button>'+
  '<button type="button" class="btn" data-reject-routine="'+escapeHTML(s.key)+'">Not repeating</button></div></div>').join('');
 return '<section class="panel" aria-label="Routine payment confirmations">'+
  '<div class="section-title"><h2>Repeating payments to confirm</h2><span class="status-tag warn">'+suggestions.length+' NEED REVIEW</span></div>'+
  '<p class="lead">These exact amounts recur on recognizable dates. They are included as estimates while you review them. A single confirmation is saved for future months; if the amount changes, the app asks again.</p>'+
  '<div class="routine-review-list">'+lines+'</div></section>';
}
function autopayPanel(s){
 const cards=activeAccounts(s).filter(a=>accountType(a)==='credit'),
  cashAccounts=activeAccounts(s).filter(a=>accountType(a)==='cash'),
  rules=state().predictions?.paymentRules||{};
 const options=value=>cashAccounts.map(a=>'<option value="'+escapeHTML(a.id)+'" '+(String(value)===String(a.id)?'selected':'')+'>'+escapeHTML(a.name)+'</option>').join('');
 const forms=cards.map(a=>{
  const v=rules[a.id]||{},configured=Boolean(rules[a.id]);
  return '<form class="card-rule-form" data-card-rule="'+escapeHTML(a.id)+'">'+
   '<div class="section-title"><h2>'+escapeHTML(a.name)+'</h2>'+
    badge({label:configured?'PAYMENT SAVED':'SETUP NEEDED',css:configured?'good':'warn'})+'</div>'+
   '<p class="lead">The next payment uses your actual issued statement balance. Later statements are estimates, not confirmed bank amounts.</p>'+
   '<div class="card-fields">'+
   '<label>Paying checking account<select name="fromAccountId" required>'+options(v.fromAccountId||state().predictions?.primaryAccountId||cashAccounts[0]?.id)+'</select></label>'+
   '<label>Latest statement close<input name="lastStatementClose" type="date" value="'+escapeHTML(v.lastStatementClose||'')+'" required></label>'+
   '<label>Latest statement balance ($)<input name="lastStatementBalance" type="number" min="0" step=".01" value="'+escapeHTML(v.lastStatementBalance??'')+'" required></label>'+
   '<label>Next checking withdrawal<input name="nextPaymentDate" type="date" value="'+escapeHTML(v.nextPaymentDate||'')+'" required></label>'+
   '<label>Credit card due date<input name="nextDueDate" type="date" value="'+escapeHTML(v.nextDueDate||v.nextPaymentDate||'')+'" required></label>'+
   '</div><div class="card-form-actions"><button type="submit" class="btn primary">'+
    (configured?'Update statement':'Save full-statement autopay')+'</button>'+
    (configured?'<button type="button" class="btn" data-remove-card-rule="'+escapeHTML(a.id)+'">Remove schedule</button>':'')+
    '<span class="status-tag">FULL STATEMENT · PLAN ONLY</span></div></form>';
 }).join('');
 const missing=cards.filter(a=>!rules[a.id]);
 return '<details class="panel planner-settings" id="card-autopay"><summary>Credit-card payment setup '+
  '<span class="status-tag '+(missing.length?'warn':'good')+'">'+(cards.length?missing.length+' NEED SETUP':'CONNECT A CARD')+'</span></summary>'+
  '<p class="lead">A purchase raises card debt, not checking withdrawals. Only the card payment reduces the paying checking account. Nothing here initiates a bank payment.</p>'+
  (cards.length?forms:'<p class="lead">No cards connected yet. Add one from Bank connections.</p>')+'</details>';
}
function auditPanel(account){
 const report=auditAccount===String(account.id)?audit:null;
 const meta=auditAccount===String(account.id)?auditMeta:null;
 const issues=report?.issues||[];
 const issueLine=item=>'<div class="audit-issue"><strong>'+escapeHTML(item.merchant||'Expected payment')+
  '</strong><span>'+escapeHTML(dateLong(item.date))+' · '+escapeHTML(item.kind)+
  (item.actual!==undefined?' · posted '+cash(item.actual):'')+
  (item.expected!==undefined?' · forecast '+cash(item.expected):'')+'</span></div>';
 const result=!report?'':report.status==='insufficient-history'?
  '<p class="audit-footnote">Not enough complete historical months to measure recurring-payment accuracy for this account. This is not a passing score.</p>':
  '<div class="audit-grid">'+
   '<div><span>Correct dated forecasts</span><strong>'+report.totals.matched+' / '+report.totals.predicted+'</strong><small>'+
    (report.matchRate===null?'Not measurable':report.matchRate+'% matched')+'</small></div>'+
   '<div><span>Eligible recurring payments found</span><strong>'+report.totals.matched+' / '+report.totals.eligible+'</strong><small>'+
    (report.coverageRate===null?'Not measurable':report.coverageRate+'% captured')+'</small></div>'+
   '<div><span>Needs investigation</span><strong>'+
    (report.totals.missed+report.totals.changed+report.totals.extra+report.totals.duplicates)+
    '</strong><small>'+report.totals.missed+' missed · '+report.totals.changed+' amount changes · '+
    report.totals.extra+' unmatched · '+report.totals.duplicates+' duplicates</small></div></div>'+
   '<p class="audit-footnote">Checked '+report.periods.map(escapeHTML).join(', ')+
   '. '+report.excludedWindows+' month(s) skipped for insufficient bank-history coverage. '+
   report.cardSettlements+' historical credit-card settlement(s) observed, but not scored without archived statement amounts.</p>'+
   (issues.length?'<div class="audit-issues"><h3>Items to review</h3>'+
    issues.map(issueLine).join('')+
    (report.issueCount>issues.length?'<p class="audit-footnote">Showing '+issues.length+' of '+report.issueCount+' issues.</p>':'')+
    '</div>':'<p class="audit-footnote">No missed or duplicate routine payments were found in the eligible history.</p>');
 return '<details class="panel planner-settings" id="accuracy-audit" aria-label="Historical prediction accuracy"'+(report||meta?' open':'')+'>'+
  '<summary>Prediction accuracy <span class="status-tag">OPTIONAL CHECK</span></summary>'+
  '<p class="lead">Test earlier forecasts against payments that later posted. Each month is tested using only transactions already known before that month.</p>'+
  (meta?'<p class="audit-run-status" role="status" aria-live="polite">'+
   escapeHTML('Check '+meta.number+(auditError?' failed':' completed')+' · '+meta.checkedAt+
    (meta.number>1&&!auditError?(meta.unchanged?' · Results unchanged':' · Results updated'):'')+'.')+'</p>':'')+
  (auditError&&auditAccount===String(account.id)?'<p class="audit-footnote">'+escapeHTML(auditError)+'</p>':'')+
  result+
  '<div class="card-form-actions"><button type="button" class="btn" data-run-backtest>'+
   (report?'Run check again':'Run historical check')+'</button></div>'+
  '<p class="audit-footnote">Checks dates and amounts, not historical bank balances. It excludes variable shopping and cannot verify old card statements without historical statement records. A recheck uses the bank history already loaded; to include new bank transactions in Real mode, use Refresh bank first. Nothing is saved or sent to another service.</p></details>';
}
function accountSelect(accounts,value,name,allowAll=false){
 return '<select name="'+escapeHTML(name)+'" '+(name==='transactionFilter'?'id="transaction-filter" data-transaction-filter':'')+'>'+
  (allowAll?'<option value="all"'+(value==='all'?' selected':'')+'>All accounts</option>':'')+
  accounts.map(a=>'<option value="'+escapeHTML(a.id)+'"'+(String(value)===String(a.id)?' selected':'')+'>'+
   escapeHTML(a.name)+'</option>').join('')+'</select>';
}
function futureRows(bundle,s){
 const accounts=activeAccounts(s),labels=new Map(accounts.map(a=>[String(a.id),a.name]));
 const rows=[],projection=bundle?.projection;
 if(!projection)return rows;
 const monthEnd=shiftDay(s.asOf,horizon);
 for(const p of projection.plans||[]){
  if(p.date<=s.asOf||p.date>monthEnd)continue;
  const key=window.HouseholdPlannerTransactions.keyMovement(p.id);
  rows.push({key,kind:'movement',id:p.id,date:p.date,amount:p.amount,
   merchant:p.merchant||(p.kind==='card_payment'?'Credit-card payment':'Account transfer'),
   fromAccountId:String(p.fromAccountId),toAccountId:String(p.toAccountId),
   from:labels.get(String(p.fromAccountId))||p.fromAccountId,
   to:labels.get(String(p.toAccountId))||p.toAccountId,
   addedId:p.id.startsWith('future|future-add|')?p.id.slice(7):null});
 }
 for(const e of projection.events||[]){
  if(e.transferGroupId||e.date<=s.asOf||e.date>monthEnd)continue;
  const accountId=String(e.accountId||'');
  const key=e.predictionKey||window.HouseholdPlannerTransactions.keyEvent(e.id,accountId);
  rows.push({key,kind:'event',id:String(e.id||''),date:e.date,amount:e.amount,
   merchant:e.merchant||'Expected transaction',accountId,account:labels.get(accountId)||accountId,
   type:e.type==='transfer'?'transfer':e.kind==='card_refund'?'refund':
    e.kind==='card_purchase'?'expense':e.type==='refund'?'refund':
    e.type==='income'?'income':'expense',
   cashDirection:e.kind==='transfer_in'?'in':'out',
   addedId:String(e.id||'').startsWith('future-add|')?String(e.id):null});
 }
 return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.merchant.localeCompare(b.merchant)||a.key.localeCompare(b.key));
}
function editorFor(row,s){
 const accounts=activeAccounts(s),isMovement=row.kind==='movement';
 const kind=row.type||'expense',date=row.date,merchant=row.merchant;
 const options=['expense','income','refund','transfer'].map(type=>
  '<option value="'+type+'"'+(kind===type?' selected':'')+'>'+
  ({expense:'Withdrawal / purchase',income:'Deposit',refund:'Refund',transfer:'Single-account transfer'}[type])+'</option>').join('');
 const keys='<input type="hidden" name="key" value="'+escapeHTML(row.key)+'">';
 const common='<label>Date<input type="date" name="date" value="'+escapeHTML(date)+'" max="'+escapeHTML(shiftDay(s.asOf,horizon))+'" min="'+
  escapeHTML(shiftDay(s.asOf,1))+'" required></label>'+
  '<label>Amount ($)<input type="number" name="amount" min="0.01" max="999999999" step="0.01" value="'+
   escapeHTML(row.amount)+'" required></label>';
 const fields=isMovement?
  '<label>From account'+accountSelect(accounts,row.fromAccountId,'fromAccountId')+'</label>'+
  '<label>To account'+accountSelect(accounts,row.toAccountId,'toAccountId')+'</label>'+
  '<label>Description<input name="merchant" maxlength="160" value="'+escapeHTML(merchant)+'" required></label>'+
  common:
  '<label>Description<input name="merchant" maxlength="160" value="'+escapeHTML(merchant)+'" required></label>'+
  '<label>Transaction type<select name="type">'+options+'</select></label>'+
  '<label>Account'+accountSelect(accounts,row.accountId,'accountId')+'</label>'+
  common+
  '<label>Transfer direction<select name="cashDirection"><option value="out"'+(row.cashDirection==='out'?' selected':'')+
   '>Money out</option><option value="in"'+(row.cashDirection==='in'?' selected':'')+'>Money in</option></select></label>';
 return '<form class="future-edit-form" data-future-edit-form="'+escapeHTML(row.key)+'">'+keys+
  '<div class="future-fields">'+fields+'</div>'+
  '<p class="audit-footnote">Changes only this predicted occurrence, not the bank transaction or repeating rule. '+
   (isMovement?'Both linked accounts update together.':'')+'</p>'+
  '<div class="future-form-actions"><button class="btn primary" type="submit">Save changes</button>'+
   '<button class="btn" type="button" data-cancel-future>Cancel</button>'+
   (row.addedId?'<button class="btn" type="button" data-remove-added="'+escapeHTML(row.addedId)+'">Remove</button>':
    '<button class="btn" type="button" data-skip-future="'+escapeHTML(row.key)+'">Skip this occurrence</button>')+
   '<button class="btn" type="button" data-restore-future="'+escapeHTML(row.key)+'">Reset</button></div></form>';
}
function newTransactionForm(s){
 const accounts=activeAccounts(s),primary=selected(s)?.id||accounts[0]?.id,
  defaultAccount=transactionFilter!=='all'?transactionFilter:primary;
 return '<form class="future-new-form panel" id="future-new-form" data-future-new-form>'+
  '<div class="section-title"><h2>Add predicted transaction</h2><span class="status-tag">FORECAST ONLY</span></div>'+
  '<p class="lead">Add a dated future expense, deposit, refund or a transfer between your accounts. No money moves.</p>'+
  '<div class="future-fields">'+
  '<label>Transaction type<select name="type" id="new-future-type">'+
   '<option value="expense">Withdrawal / purchase</option><option value="income">Deposit</option>'+
   '<option value="refund">Refund</option><option value="transfer">Transfer between accounts</option></select></label>'+
  '<label>Description<input name="merchant" maxlength="160" placeholder="e.g. Property tax" required></label>'+
  '<label class="new-standard-account">Account'+accountSelect(accounts,defaultAccount,'accountId')+'</label>'+
  '<label class="future-transfer-only" hidden>From account'+accountSelect(accounts,defaultAccount,'fromAccountId')+'</label>'+
  '<label class="future-transfer-only" hidden>To account'+accountSelect(accounts,accounts.find(a=>String(a.id)!==String(defaultAccount))?.id||defaultAccount,'toAccountId')+'</label>'+
  '<label>Date<input name="date" type="date" min="'+escapeHTML(shiftDay(s.asOf,1))+'" max="'+escapeHTML(shiftDay(s.asOf,horizon))+'" value="'+
   escapeHTML(shiftDay(s.asOf,1))+'" required></label>'+
  '<label>Amount ($)<input name="amount" type="number" min="0.01" max="999999999" step="0.01" required placeholder="0.00"></label>'+
  '</div><div class="future-form-actions"><button class="btn primary" type="submit">Add to forecast</button>'+
  '<button class="btn" type="button" data-cancel-new>Cancel</button></div></form>';
}
function transactionsPage(bundle,s){
 const accounts=activeAccounts(s),rows=futureRows(bundle,s),visible=rows.filter(r=>
  transactionFilter==='all'||(r.kind==='movement'?
   r.fromAccountId===transactionFilter||r.toAccountId===transactionFilter:
   r.accountId===transactionFilter));
 const opts=accountSelect(accounts,transactionFilter,'transactionFilter',true);
 const lines=visible.map(row=>{
  const paired=row.kind==='movement',incoming=row.type==='income'||row.type==='refund',
   desc=paired?row.from+' → '+row.to:row.account+' · '+
    (row.type==='income'?'Deposit':row.type==='refund'?'Refund':
     row.type==='transfer'?(row.cashDirection==='in'?'Transfer in':'Transfer out'):'Withdrawal / card purchase');
  const canEdit=editingKey===row.key;
  return '<article class="future-item" data-future-item="'+escapeHTML(row.key)+'">'+
   '<div class="future-row"><div class="future-date">'+escapeHTML(dayLabel(row.date))+'</div>'+
   '<div class="future-description"><strong>'+escapeHTML(row.merchant)+'</strong>'+
   '<small>'+escapeHTML(desc)+'</small></div>'+
   '<div class="future-amount '+(incoming?'incoming':'outgoing')+'">'+(incoming?'+':paired?'↔ ':'−')+cash(row.amount)+'</div>'+
   '<button type="button" class="btn" data-edit-future="'+escapeHTML(row.key)+'">'+
    (canEdit?'Close':'Edit')+'</button></div>'+
   (canEdit?editorFor(row,s):'')+'</article>';
 }).join('');
 const skipped=Object.entries(state().predictions?.futureTransactionEdits||{}).filter(([k,v])=>
  v?.skipped&&(!v.accountId||transactionFilter==='all'||String(v.accountId)===transactionFilter||
   String(v.toAccountId)===transactionFilter));
 const undo=skipped.length?'<details class="details future-skipped"><summary>'+
  skipped.length+' skipped forecast occurrence(s) — restore</summary>'+
  skipped.map(([key,v])=>'<div class="future-skip-line">'+escapeHTML(v.label||'Predicted transaction')+
   ' · '+escapeHTML(v.date||'')+' <button type="button" class="btn" data-restore-future="'+
   escapeHTML(key)+'">Restore</button></div>').join('')+'</details>':'';
 return '<div class="planner-page transactions-page">'+
  '<div class="page-heading"><div><h2>Future transactions</h2>'+
   '<p>All dated predictions for the next '+horizon+' days. Edit one occurrence at a time.</p></div>'+
   '<button type="button" class="btn primary" data-show-new>+ Add transaction</button></div>'+
  '<section class="panel transaction-panel"><div class="future-toolbar"><label>Account '+opts+'</label>'+
   '<span class="status-tag">'+visible.length+' PREDICTED</span></div>'+
   (transactionNotice?'<p class="future-notice" role="status">'+escapeHTML(transactionNotice)+'</p>':'')+
   (showNewTransaction?newTransactionForm(s):'')+
   (lines||'<div class="empty-visual">No predicted transactions for this selection. Add one or choose another account.</div>')+
   undo+
   '<p class="audit-footnote">Forecast-only changes recalculate balance predictions for affected accounts. Actual bank transactions remain untouched. Card payments and account transfers are represented once and affect both linked accounts.</p>'+
  '</section></div>';
}
function incomeStatus(bundle,s,chosen,derived){
 const through=shiftDay(s.asOf,horizon),from=shiftDay(s.asOf,-100);
 const incoming=(derived?.events||[]).filter(t=>t.kind==='income'&&t.date>s.asOf&&t.date<=through);
 const recent=(bundle?.rows||[]).filter(t=>!t.pending&&t.date>=from&&t.date<=s.asOf&&
  (String(t.accountId||'')===String(chosen.id)||
   !t.accountId&&String(t.account||'')===String(chosen.transactionAccount||chosen.name)));
 const earned=recent.filter(t=>t.type==='income');
 const unlabeled=recent.filter(t=>t.type==='transfer'&&t.cashDirection==='in');
 const amount=incoming.reduce((sum,t)=>sum+Number(t.amount||0),0);
 let detail;
 if(incoming.length){
  detail=incoming.length+' dated deposit'+(incoming.length===1?'':'s')+' · '+cash(amount)+
   ' expected through '+dateLong(through)+'. These are estimates, not bank-issued payment confirmations.';
 }else if(earned.length){
  detail=earned.length+' income deposit'+(earned.length===1?' was':'s were')+
   ' found in the last 100 days, but none qualified as a predictable future date and amount.';
 }else if(unlabeled.length){
  detail=unlabeled.length+' incoming transfer'+(unlabeled.length===1?' is':'s are')+
   ' visible in the last 100 days, but transfers are not assumed to be payroll.';
 }else{
  detail='No recognizable paychecks were found in the last 100 days for this account. Check your bank history and refresh if needed.';
 }
 return '<section class="panel income-status" aria-label="Income prediction status">'+
  '<div><div class="section-title"><h2>Expected income</h2>'+
   '<span class="status-tag '+(incoming.length?'good':'warn')+'">'+
    (incoming.length?incoming.length+' PREDICTED':'NOT DETECTED')+'</span></div>'+
   '<p>'+escapeHTML(detail)+'</p></div>'+
  '<button type="button" class="btn" data-view="transactions">Review / add income</button>'+
  '</section>';
}
function overviewPage(bundle,s,chosen,derived,fresh){
 const series=(derived?.series||[]).filter(x=>x.date<=shiftDay(s.asOf,horizon));
 const events=(derived?.events||[]).filter(x=>x.date>s.asOf&&x.date<=shiftDay(s.asOf,horizon))
  .sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);
 const notes=events.map(e=>'<div class="overview-upcoming-item"><span>'+escapeHTML(dayLabel(e.date))+
  '</span><strong>'+escapeHTML(e.merchant)+'</strong><span>'+cash(e.amount)+'</span></div>').join('');
 return '<div class="planner-page overview-page">'+
  accountCards(s,bundle?.projection,chosen)+hero(chosen,derived,s.asOf)+incomeStatus(bundle,s,chosen,derived)+
  '<section class="panel overview-chart" aria-label="Projected balance curve">'+
   '<div class="section-title"><h2>Balance trajectory</h2><p>Next '+horizon+' days</p></div>'+
   (derived&&fresh?miniChart(series,s.asOf):'<div class="empty-visual">A current account balance is required for a projection.</div>')+
   '<p class="chart-caption">This balance projection includes dated fixed recurring commitments; variable day-to-day purchases are not forecast.</p></section>'+
  '<section class="panel"><div class="section-title"><h2>Next five expected movements</h2>'+
   '<button type="button" class="btn" data-view="transactions">View all and edit</button></div>'+
   (notes||'<p class="lead">No upcoming dated transactions identified.</p>')+
   '</section></div>';
}
function settingsPage(bundle,s,chosen){
 return '<div class="planner-page settings-page"><div class="page-heading"><div>'+
  '<h2>Settings</h2><p>Review recurring payments, your cash cushion, account connections and historical accuracy.</p></div></div>'+
  '<section class="panel"><div class="section-title"><h2>Balance safety</h2></div>'+
   '<form id="cushion-form" data-cushion-form><label class="cash-cushion-label">Low-balance warning threshold ($)'+
    '<input type="number" name="cashCushion" min="0" step="1" max="999999999" value="'+
     escapeHTML(state().predictions?.cashCushion??500)+'" required></label>'+
    '<button class="btn primary" type="submit">Save threshold</button></form></section>'+
  auditPanel(chosen)+routineReviewPanel(bundle)+autopayPanel(s)+connectionPanel(s,bundle)+'</div>';
}
function render(){
 const root=$('planner-main'),mode=$('ledger-mode-switch'),busy=requestedReal()&&!live();
 if(!root)return;
 const s=busy?{asOf:dateToday(),accounts:[]}:snapshot();
 mode.value=requestedReal()?'real':'demo';
 $('source-type').textContent=sourceTag();
 $('refresh-bank').hidden=!live();
 $('audit-launch').hidden=busy||!activeAccounts(s).length||activeTab!=='settings';
 document.querySelectorAll('[data-view]').forEach(button=>{
  const active=button.dataset.view===activeTab;
  button.classList.toggle('active',active);
  if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
 });
 $('bank-connect').hidden=!available();
 $('horizon').value=String(horizon);
 if(busy){$('planner-notice').innerHTML='<div class="notice'+(window.HouseholdLiveSource?.error?' danger':'')+'"><div><strong>Real bank information is not available yet.</strong> '+
  escapeHTML(window.HouseholdLiveSource?.error||'Loading your private bank connection…')+
  ' You can manage connections without switching to fictional balances.</div><a class="btn" href="/bank-connect">Bank connections</a></div>';
  root.innerHTML='<section class="panel"><div class="empty-visual">No bank balance forecast is being displayed until the Real connection is verified.</div></section>';return}
 let bundle=null,error=null;
 try{bundle=forecastFor(s)}catch(e){error=String(e.message||e)}
 const projection=bundle?.projection||null,selectedSource=selected(s);
 lastSuggestions=bundle?.routines?.review||[];
 if(selectedSource)selectedAccount=selectedSource.id;
 const derived=projection?.accounts.find(x=>x.id===String(selectedAccount));
 const statuses=projection?.diagnostics||{};
 const missingCards=activeAccounts(s).filter(a=>accountType(a)==='credit'&&
  !state().predictions?.paymentRules?.[a.id]);
 const caution=[
  ...(missingCards.length?['Credit-card payment schedule not set for '+missingCards.map(a=>a.name).join(', ')+'. Future checking withdrawals may be incomplete.']:[]),
  ...((bundle?.payments?.warnings||[]).slice(0,3)),
  ...((bundle?.routines?.warnings||[]).slice(0,2).map(w=>
   'Possible mortgage withdrawal not included: '+w.merchant+' ('+w.reason+'). Confirm its recurrence before relying on the projected balance.')),
  ...((bundle?.forecast?.suppressedDuplicates||[]).length?['Older overlapping one-time forecasts were excluded to avoid duplicate payments.']:[]),
  ...((statuses.unassigned||[]).length?['Some expected payments lack a confirmed account, so those are not included in the balance.']:[]),
  ...((statuses.unmatchedTransfers||[]).length?['Some scheduled transfers do not have a verified counterpart; review before relying on cash coverage.']:[])
 ];
 let note='';
 if(error)note='<div class="notice danger"><strong>Forecast calculation unavailable.</strong> '+escapeHTML(error)+
  '. Your bank balances have not been changed.</div>';
 else if(latestError)note='<div class="notice danger">'+escapeHTML(latestError)+'</div>';
 else if(caution.length)note='<div class="notice danger"><div><strong>Forecast needs review.</strong> '+escapeHTML(caution.join(' '))+'</div></div>';
 else note='<div class="notice"><div><strong>'+(live()?'Read-only bank feed':'Fictional planning preview')+'.</strong> '+
  (live()?'Balances are bank-reported; future movements are estimates.':'These balances and transactions are samples, not your actual household.')+
  '</div><span class="secondary">'+escapeHTML(s.asOf||dateToday())+'</span></div>';
 $('planner-notice').innerHTML=note;
 if(!selectedSource){root.innerHTML='<section class="panel"><h2>No connected accounts</h2><p>Add a bank account to start planning.</p>'+
  (available()?'<a class="btn primary" href="/bank-connect">Connect a bank</a>':'')+'</section>';return}
 const fresh=derived&&freshness(derived);
 const cashProjection=(derived?.series||[]).filter(x=>x.date<=shiftDay(s.asOf,horizon));
 let important=(derived?.events||[]).filter(e=>['expense','transfer_out'].includes(e.kind));
 const income=(derived?.events||[]).filter(e=>['income','transfer_in'].includes(e.kind));
 root.innerHTML=activeTab==='settings'?settingsPage(bundle,s,selectedSource):
  activeTab==='transactions'?transactionsPage(bundle,s):overviewPage(bundle,s,selectedSource,derived,fresh);
}
document.addEventListener('click',async e=>{
 const view=e.target.closest('[data-view]');
 if(view){
  activeTab=view.dataset.view;
  editingKey='';showNewTransaction=false;transactionNotice='';
  render();
  window.scrollTo({top:0,behavior:'auto'});
  return;
 }
 if(e.target.closest('[data-show-new]')){
  showNewTransaction=true;editingKey='';transactionNotice='';render();
  $('future-new-form')?.scrollIntoView({behavior:'smooth',block:'center'});return;
 }
 if(e.target.closest('[data-cancel-new]')){
  showNewTransaction=false;transactionNotice='';render();return;
 }
 if(e.target.closest('[data-cancel-future]')){editingKey='';render();return}
 const edit=e.target.closest('[data-edit-future]');
 if(edit){editingKey=editingKey===edit.dataset.editFuture?'':edit.dataset.editFuture;
  showNewTransaction=false;transactionNotice='';render();return}
 const skip=e.target.closest('[data-skip-future]');
 if(skip){
  const row=futureRows(forecastFor(snapshot()),snapshot()).find(r=>r.key===skip.dataset.skipFuture);
  if(!row)return;
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.skip(state(),row.key,
    {label:row.merchant,date:row.date,accountId:row.accountId||row.fromAccountId,
     toAccountId:row.toAccountId}));
   editingKey='';transactionNotice='Skipped '+row.merchant+' on '+dateLong(row.date)+'.';render();
  }catch(err){transactionNotice=String(err.message||err);render()}
  return;
 }
 const restore=e.target.closest('[data-restore-future]');
 if(restore){
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.restore(state(),restore.dataset.restoreFuture));
   editingKey='';transactionNotice='Forecast occurrence restored.';render();
  }catch(err){transactionNotice=String(err.message||err);render()}
  return;
 }
 const removeAdded=e.target.closest('[data-remove-added]');
 if(removeAdded){
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.removeAdded(state(),removeAdded.dataset.removeAdded));
   editingKey='';transactionNotice='Added transaction removed.';render();
  }catch(err){transactionNotice=String(err.message||err);render()}
  return;
 }
 const runAudit=e.target.closest('[data-run-backtest]');
 if(runAudit){
  const s=snapshot(),chosen=selected(s);
  if(!chosen)return;
  const accountId=String(chosen.id),prior=auditAccount===accountId?audit:null;
  const previousNumber=auditAccount===accountId?Number(auditMeta?.number||0):0;
  // Tell the user the button responded before a potentially long audit
  // recalculates several months of bank transactions.
  runAudit.disabled=true;runAudit.textContent='Checking…';
  await new Promise(resolve=>setTimeout(resolve,20));
  auditAccount=accountId;
  try{
   const updated=window.HouseholdPlannerBacktest.build(state(),s.asOf||dateToday(),accountId,
    {model,forecast:window.HouseholdForecast,ledger:window.HouseholdForecastLedger,
     planner:window.HouseholdPlannerIntelligence},
    {months:6,accounts:activeAccounts(s)});
   auditMeta={number:previousNumber+1,checkedAt:new Date().toLocaleString('en-US'),
    unchanged:prior!==null&&JSON.stringify(prior)===JSON.stringify(updated)};
   audit=updated;auditError='';
  }catch(err){
   audit=null;auditError='The historical check could not be completed: '+String(err.message||err);
   auditMeta={number:previousNumber+1,checkedAt:new Date().toLocaleString('en-US'),unchanged:false};
  }
  // Update just the audit, so a rerun does not redraw the chart, reset
  // the page, or make the freshly completed result appear unresponsive.
  const existing=$('accuracy-audit');
  if(existing&&String(selected(s)?.id)===accountId){
   existing.outerHTML=auditPanel(chosen);
  }else render();
  const panel=$('accuracy-audit');
  if(panel)panel.open=true;
  if(runAudit.id==='audit-launch')panel?.scrollIntoView({behavior:'smooth',block:'start'});
  else panel?.querySelector('[data-run-backtest]')?.focus({preventScroll:true});
  return;
 }
 const main=e.target.closest('[data-set-main]');
 if(main){
  const current=activeAccounts(snapshot()).find(a=>String(a.id)===main.dataset.setMain);
  if(!current||!isChecking(current)){setNotice('Choose a checking account as your main account');return}
  state().predictions.primaryAccountId=current.id;selectedAccount=current.id;savePlanning();render();return;
 }
 const confirm=e.target.closest('[data-confirm-routine],[data-reject-routine]');
 if(confirm){
  const key=confirm.dataset.confirmRoutine||confirm.dataset.rejectRoutine;
  const candidate=lastSuggestions.find(x=>x.key===key);
  if(!candidate){setNotice('That suggested payment changed. Refresh the plan and try again.');return}
  try{window.HouseholdPlannerIntelligence.saveDecision(state(),candidate,
   confirm.hasAttribute('data-confirm-routine')?'confirmed':'excluded');savePlanning();render()}
  catch(err){setNotice(err.message)}
  return;
 }
 const remove=e.target.closest('[data-remove-card-rule]');
 if(remove){
  window.HouseholdLedgerData.removeCardPaymentRule(state(),remove.dataset.removeCardRule);
  savePlanning();render();document.getElementById('card-autopay')?.setAttribute('open','');return;
 }
 const account=e.target.closest('[data-account-id]');
 if(account){selectedAccount=account.dataset.accountId;render();return}
 if(e.target.closest('#refresh-bank')){window.HouseholdLiveSource?.refresh();return}
});
async function commitForecastChange(action){
 const current=state(),before=JSON.stringify(current.predictions||{});
 try{
  const result=action();
  const saved=await savePlanning();
  if(live()&&!saved)throw Error('Could not save your changes on the private bank server. Try again.');
  return result;
 }catch(err){current.predictions=JSON.parse(before);throw err}
}
document.addEventListener('submit',async e=>{
 const form=e.target.closest('[data-future-edit-form],[data-future-new-form],[data-cushion-form]');
 if(!form)return;
 e.preventDefault();
 const button=form.querySelector('button[type="submit"]');
 if(button)button.disabled=true;
 const fields=Object.fromEntries(new FormData(form));
 try{
  const s=snapshot(),accounts=activeAccounts(s),asOf=s.asOf||dateToday(),planner=window.HouseholdPlannerTransactions;
  if(form.hasAttribute('data-future-new-form')||form.hasAttribute('data-future-edit-form')){
   if(fields.date>shiftDay(asOf,horizon))throw Error('Choose a date within the next '+horizon+' forecast days.');
  }
  if(form.hasAttribute('data-future-edit-form')){
   const key=form.dataset.futureEditForm;
   await commitForecastChange(()=>planner.saveEdit(state(),key,fields,accounts,asOf));
   editingKey='';transactionNotice='Forecast transaction updated.';
  }else if(form.hasAttribute('data-future-new-form')){
   await commitForecastChange(()=>planner.add(state(),fields,accounts,asOf));
   showNewTransaction=false;transactionNotice='Future transaction added to the selected account.';
  }else{
   await commitForecastChange(()=>model.setCashCushion(state(),fields.cashCushion));
   transactionNotice='Safety threshold saved.';
  }
  render();
 }catch(err){
  if(button)button.disabled=false;
  let error=form.querySelector('.future-form-error');
  if(!error){error=document.createElement('p');error.className='future-form-error';error.setAttribute('role','alert');form.appendChild(error)}
  error.textContent=String(err.message||err);
 }
});
document.addEventListener('submit',e=>{
 const form=e.target.closest('[data-card-rule]');
 if(!form)return;
 e.preventDefault();
 try{
  const cardId=form.dataset.cardRule,fields=Object.fromEntries(new FormData(form));
  const banks=activeAccounts(snapshot());
  const card=banks.find(a=>String(a.id)===cardId&&accountType(a)==='credit');
  const from=banks.find(a=>String(a.id)===fields.fromAccountId&&accountType(a)==='cash');
  if(!card||!from)throw Error('Select a linked card and a checking payment source');
  if(fields.nextPaymentDate<=dateToday())throw Error('The next withdrawal date must be in the future');
  if(fields.nextPaymentDate>fields.nextDueDate)throw Error('The planned withdrawal should not be after the card due date');
  const rule={...fields,closingDay:Number(fields.lastStatementClose.slice(-2)),method:'statement'};
  window.HouseholdLedgerData.setCardPaymentRule(state(),cardId,rule);
  savePlanning();render();document.getElementById('card-autopay')?.setAttribute('open','');
 }catch(err){setNotice(err.message);document.getElementById('card-autopay')?.setAttribute('open','')}
});
document.addEventListener('change',e=>{
 if(e.target.id==='transaction-filter'){
  transactionFilter=e.target.value;editingKey='';showNewTransaction=false;render();return;
 }
 if(e.target.id==='new-future-type'){
  const transfer=e.target.value==='transfer',form=e.target.closest('form');
  form?.querySelectorAll('.future-transfer-only').forEach(el=>el.hidden=!transfer);
  const ordinary=form?.querySelector('.new-standard-account');if(ordinary)ordinary.hidden=transfer;
  return;
 }
 if(e.target.id==='horizon'){
  const x=Number(e.target.value);
  if([30,60,90].includes(x)){horizon=x;render()}
 }
});
if(available()){
 window.HouseholdLiveSource.bind({
  render,
  enterReal(newState,newSnapshot){liveState=newState;liveSnapshot=newSnapshot;selectedAccount=null;latestError='';clearAudit()},
  enterDemo(){liveState=null;liveSnapshot=null;selectedAccount=null;clearAudit()},
  enterUnavailable(){liveState=null;liveSnapshot=null;selectedAccount=null;clearAudit()}
 });
}else{
 $('ledger-mode-switch').querySelector('option[value="real"]').disabled=true;
}
render();
})();