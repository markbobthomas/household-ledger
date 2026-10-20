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
  const keys=['primaryAccountId','plannerRoutineDecisions','paymentRules','cashCushion'];
  for(const key of keys)if(saved[key]!==undefined)demoState.predictions[key]=saved[key];
 }
}catch{}
let liveState=null,liveSnapshot=null,selectedAccount=null,horizon=90,latestError='',lastSuggestions=[];
function savePlanning(){
 if(live()){window.HouseholdLiveSource.persist(liveState)}
 else {
  const p=demoState.predictions||{};
  localStorage.setItem(DEMO_SETTINGS,JSON.stringify({primaryAccountId:p.primaryAccountId,
   plannerRoutineDecisions:p.plannerRoutineDecisions,paymentRules:p.paymentRules,cashCushion:p.cashCushion}));
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
function forecastFor(s){
 if(!s||!activeAccounts(s).length)return null;
 const rows=model.records(state()),asOf=s.asOf||dateToday();
 const forecast=window.HouseholdForecastLedger.build(state(),rows,asOf,90,
  window.HouseholdForecast,model);
 const routines=window.HouseholdPlannerIntelligence.project(state(),rows,forecast.events,asOf);
 const payments=window.HouseholdPaymentObligations.build(s,rows,routines.events,state().predictions||{},{days:90});
 const suppress=new Set(payments.suppressedExpectedIds||[]);
 const cardPlans=payments.plans||[];
 const rawPlans=state().predictions?.accountMovements||[];
 const manualPlans=rawPlans.filter(p=>{
  const dates=window.HouseholdAccountForecast.occurrences(p,asOf,shiftDay(asOf,90));
  const duplicate=cardPlans.some(card=>card.fromAccountId===p.fromAccountId&&card.toAccountId===p.toAccountId&&
   dates.some(date=>Math.abs(dayDelta(date,card.anchorDate))<=3));
  return !duplicate;
 });
 const events=[...routines.events.filter(e=>!suppress.has(String(e.id))),...payments.billEvents];
 const forecastAccount=window.HouseholdAccountForecast.build(s,events,[...manualPlans,...cardPlans],
  {days:90,records:rows});
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
 const lowest=derived.minimum,lowDate=derived.lowestDate;
 const firstNegative=isCash?(derived.series||[]).find(d=>Number.isFinite(d.balance)&&d.balance<0):null;
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
  '<div class="metric"><span>'+(credit?'Lowest debt · next 90 days':'Lowest balance · next 90 days')+'</span>'+
   '<strong class="'+(below?'low':'')+'">'+(fresh?cash(lowest):'Unverified')+'</strong>'+
   '<small>'+(fresh&&lowDate?escapeHTML(dayLabel(lowDate)):'Confirm bank balance first')+'</small></div>'+
  '<div class="metric metric-wide"><span>'+(isCash?'First projected shortfall':'Projected debt · day 90')+'</span>'+
   '<strong class="'+(fresh&&firstNegative?'low':'')+'">'+
    (fresh?(isCash?(firstNegative?escapeHTML(dateLong(firstNegative.date)):'None from dated payments'):cash(derived.series.at(-1)?.balance)):'Unverified')+'</strong>'+
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
function render(){
 const root=$('planner-main'),mode=$('ledger-mode-switch'),busy=requestedReal()&&!live();
 if(!root)return;
 const s=busy?{asOf:dateToday(),accounts:[]}:snapshot();
 mode.value=requestedReal()?'real':'demo';
 $('source-type').textContent=sourceTag();
 $('refresh-bank').hidden=!live();
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
 root.innerHTML=hero(selectedSource,derived,s.asOf)+
  accountCards(s,projection,selectedSource)+
  '<section class="panel" aria-label="Projected balance curve"><div class="section-title"><h2>Balance trajectory</h2>'+
  '<p>Next '+horizon+' days · '+escapeHTML(derived?.name||selectedSource.name)+'</p></div>'+
  (derived&&fresh?miniChart(cashProjection,s.asOf):'<div class="empty-visual">The trajectory is withheld until a usable, up-to-date starting balance is available.</div>')+
  '<p class="chart-caption">An illustrative day-by-day projection from dated transactions and saved schedules. It is not a bank guarantee, and unplanned purchases can lower actual cash.</p></section>'+
  '<section class="panel timeline-panel" aria-label="Expected cash movements"><div class="section-title">'+
  '<h2>Upcoming money in and out</h2><p>'+important.length+' withdrawals · '+income.length+' deposits or transfers</p></div>'+
  movementRows(selectedSource,derived||{events:[],series:[]},s,bundle?.routines)+
  '<details class="details"><summary>What is included in this forecast?</summary>'+
  '<p>Dates and amounts come from historical recurrence detection and any previously saved planning rules. The starting balance is reported by the bank in Real mode. A credit card purchase increases card debt, not checking withdrawals. Credit card payments are transfers between accounts, not spending twice. A projected deposit is not confirmed until posted.</p>'+
  '</details></section>'+
  routineReviewPanel(bundle)+autopayPanel(s)+connectionPanel(s,bundle);
}
document.addEventListener('click',e=>{
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
 if(e.target.id==='horizon'){
  const x=Number(e.target.value);
  if([30,60,90].includes(x)){horizon=x;render()}
 }
});
if(available()){
 window.HouseholdLiveSource.bind({
  render,
  enterReal(newState,newSnapshot){liveState=newState;liveSnapshot=newSnapshot;selectedAccount=null;latestError=''},
  enterDemo(){liveState=null;liveSnapshot=null;selectedAccount=null},
  enterUnavailable(){liveState=null;liveSnapshot=null;selectedAccount=null}
 });
}else{
 $('ledger-mode-switch').querySelector('option[value="real"]').disabled=true;
}
render();
})();