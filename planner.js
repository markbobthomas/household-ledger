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
    'futureTransactionEdits','futureTransactionAdds','futureSeriesEdits','futureRecurringRules','futureRecurrenceExclusions','mortgageReviewDismissals','historyPatternDecisions'];
  for(const key of keys)if(saved[key]!==undefined)demoState.predictions[key]=saved[key];
 }
}catch{}
let liveState=null,liveSnapshot=null,selectedAccount=null,horizon=90,latestError='',lastSuggestions=[];
let activeTab='overview',transactionFilter='all',editingKey='',showNewTransaction=false,transactionNotice='',mortgageDraft=null;
let lastMissingMortgages=[],lastHistoryRows=[],lastReviewCandidates=[];
let historyAccount='all',historySearch='',historyLimit=90,recurringDraft=null,reviewNotice='';
let audit=null,auditAccount=null,auditError='',auditMeta=null;
function clearAudit(){audit=null;auditAccount=null;auditError='';auditMeta=null}
function savePlanning(){
 if(live())return window.HouseholdLiveSource.persistForecast(liveState.predictions||{})
 else {
  const p=demoState.predictions||{};
  localStorage.setItem(DEMO_SETTINGS,JSON.stringify({primaryAccountId:p.primaryAccountId,
   plannerRoutineDecisions:p.plannerRoutineDecisions,paymentRules:p.paymentRules,cashCushion:p.cashCushion,
   futureTransactionEdits:p.futureTransactionEdits,futureTransactionAdds:p.futureTransactionAdds,
   futureSeriesEdits:p.futureSeriesEdits,futureRecurringRules:p.futureRecurringRules,
   futureRecurrenceExclusions:p.futureRecurrenceExclusions,mortgageReviewDismissals:p.mortgageReviewDismissals,historyPatternDecisions:p.historyPatternDecisions}));
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
   _seriesKey:key,_seriesDate:e.date,_forecastOriginalAccountId:originalAccount,
   _forecastOriginalMerchant:e.merchant,_forecastOriginalAmount:e.amount};
 });
}
function forecastForPayments(events,s,additions){
 const accounts=activeAccounts(s),edits=state().predictions?.futureTransactionEdits||{};
 const extras=additions||state().predictions?.futureTransactionAdds||[];
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
 // The only planning entry point: normalize Plaid history, materialize one
 // editable future ledger, then calculate all balances from those entries.
 // Older inference and category forecast engines do not feed balances.
 return window.HouseholdFutureLedger.materialize(
  s,model.records(state()),state().predictions||{},
  window.HouseholdPlannerTransactions,window.HouseholdPaymentObligations,90);
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
function cardStatementPreview(s,bundle,cardId){
 const next=(bundle?.payments?.statements||[]).filter(x=>String(x.cardId)===String(cardId))
  .sort((a,b)=>a.withdrawalDate.localeCompare(b.withdrawalDate)).slice(0,2);
 if(!next.length)return '<p class="card-preview-placeholder">Save the billing period and payment dates to see posted spending and projected card payments.</p>';
 return '<div class="card-statement-previews">'+next.map((p,i)=>
  '<div class="card-statement-preview" aria-label="'+escapeHTML(p.cardName)+' statement estimate">'+
   '<div class="card-preview-top"><span>'+(i===0?'NEXT CARD BILL':'FOLLOWING CARD BILL')+
    '</span><span class="status-tag '+(p.confirmed?'good':'warn')+'">'+
    (p.confirmed?'ISSUED AMOUNT ENTERED':'PAYMENT ESTIMATE')+'</span></div>'+
   '<strong class="card-preview-amount">'+cash(p.statementBalance)+'</strong>'+
   '<div class="card-preview-line"><span>Billing period</span><strong>'+
    escapeHTML(dayLabel(p.periodStart))+' – '+escapeHTML(dayLabel(p.periodEnd))+'</strong></div>'+
   '<div class="card-preview-line"><span>Period status</span><strong>'+
    (p.periodComplete?'Closed · all retrieved posted charges':'Open · posted charges to date')+'</strong></div>'+
   '<div class="card-preview-line"><span>Actual posted purchases</span><strong>'+cash(p.purchases)+'</strong></div>'+
   '<div class="card-preview-line"><span>Actual posted refunds</span><strong>−'+cash(p.refunds)+'</strong></div>'+
   '<div class="card-preview-line"><span>Actual net period spending</span><strong>'+cash(p.actualPeriodNet)+'</strong></div>'+
   '<div class="card-preview-line"><span>Unposted predicted card spending</span><strong>'+
    cash(p.estimatedCharges)+'</strong></div>'+
   '<div class="card-preview-line"><span>Payment due date</span><strong>'+
    escapeHTML(dateLong(p.dueDate))+'</strong></div>'+
   '<div class="card-preview-line"><span>Payment status</span><strong>'+
    (p.alreadyPaid?'Actual posted '+escapeHTML(dayLabel(p.actualPaymentDate))+' · '+cash(p.actualPaymentAmount):
     p.autopayEnabled?'Planned '+escapeHTML(dayLabel(p.withdrawalDate))+' · '+escapeHTML(p.fromName):
     'No autopay · no withdrawal planned')+'</strong></div>'+
   (p.alreadyPaid&&Math.abs(p.actualPaymentAmount-p.amount)>.011?
    '<p class="card-preview-caveat">Posted payment differs from the estimate. Review any remaining balance on the card.</p>':'')+
   (!p.alreadyPaid&&p.lastPostedPayment?
    '<p class="card-preview-caveat">Last actual card payment: '+
     escapeHTML(dayLabel(p.lastPostedPayment.date))+' · '+cash(p.lastPostedPayment.amount)+
     ' from '+escapeHTML(p.fromName)+'.</p>':'')+
   '<details class="card-actual-transactions"><summary>Review '+p.postedTransactions.length+
    ' actual card transactions in this period</summary>'+
    (p.postedTransactions.length?p.postedTransactions.map(t=>
     '<div class="card-actual-line"><span>'+escapeHTML(dayLabel(t.date))+
      ' · '+escapeHTML(t.merchant)+'</span><strong>'+
      (t.type==='refund'?'−':'')+cash(t.amount)+'</strong></div>').join(''):
     '<p>No settled card purchases or refunds found for this cycle.</p>')+
    '</details>'+
   (p.pendingExcluded?'<p class="card-preview-caveat">'+p.pendingExcluded+
    ' pending card transaction(s) excluded until posted.</p>':'')+
   '<p class="card-preview-caveat">'+(p.confirmed?
    'Issued statement amount supplied by you. Actual card purchases are listed separately.':
    'The actual net charges are based on retrieved posted bank transactions. The payment estimate can differ due to prior balances, fees, interest or unplanned future card purchases.')+
   ' Future autopay dates are user-entered plans; actual dates become known when the bank posts the payment.</p>'+
  '</div>').join('')+'</div>';
}
function autopayPanel(s,bundle){
 const cards=activeAccounts(s).filter(a=>accountType(a)==='credit'),
  cashAccounts=activeAccounts(s).filter(a=>accountType(a)==='cash'),
  rules=state().predictions?.paymentRules||{};
 const options=value=>cashAccounts.map(a=>'<option value="'+escapeHTML(a.id)+'" '+
  (String(value)===String(a.id)?'selected':'')+'>'+escapeHTML(a.name)+'</option>').join('');
 const forms=cards.map(a=>{
  const v=rules[a.id]||{},configured=Boolean(rules[a.id]);
  const oldClose=v.billingEndDate||v.lastStatementClose||'';
  const oldStart=v.billingStartDate||(oldClose?
   shiftDay(window.HouseholdPaymentObligations.closeFor(
    window.HouseholdPaymentObligations.plus(oldClose,-1).slice(0,7),
    Number(v.closingDay||oldClose.slice(8,10))),1):'');
  const paying=v.fromAccountId||state().predictions?.primaryAccountId||cashAccounts[0]?.id;
  return '<form class="card-rule-form" data-card-rule="'+escapeHTML(a.id)+'">'+
   '<div class="section-title"><h2>'+escapeHTML(a.name)+'</h2>'+
    badge({label:configured?(v.autopayEnabled===false?'STATEMENT ONLY':'AUTOPAY PLANNED'):'SETUP NEEDED',
     css:configured?'good':'warn'})+'</div>'+
   '<p class="lead">Enter the start and end of one full billing cycle. We estimate this card’s next bill from posted card purchases, refunds, and known recurring charges.</p>'+
   '<div class="card-fields">'+
   '<label>Billing period starts<input name="billingStartDate" type="date" value="'+escapeHTML(oldStart)+'" required></label>'+
   '<label>Billing period ends / statement closes<input name="billingEndDate" type="date" value="'+escapeHTML(oldClose)+'" required></label>'+
   '<label>Statement payment due date<input name="nextDueDate" type="date" value="'+escapeHTML(v.nextDueDate||v.nextPaymentDate||'')+'" required></label>'+
   '<label>Planned autopay withdrawal date (until bank posts it)<input name="nextPaymentDate" type="date" value="'+escapeHTML(v.nextPaymentDate||'')+'" required></label>'+
   '<label>Autopay status<select name="autopayEnabled"><option value="yes"'+(v.autopayEnabled!==false?' selected':'')+'>Full-statement autopay</option>'+
    '<option value="no"'+(v.autopayEnabled===false?' selected':'')+'>Not on autopay · estimate only</option></select></label>'+
   '<label>Autopay funding account<select name="fromAccountId">'+options(paying)+'</select></label>'+
   '<label>Issued statement balance (optional, $)<input name="lastStatementBalance" type="number" min="0" step=".01" value="'+escapeHTML(v.lastStatementBalance??'')+'" placeholder="Calculated automatically"></label>'+
   '</div>'+
   cardStatementPreview(s,bundle,a.id)+
   '<div class="card-form-actions"><button type="submit" class="btn primary">'+
    (configured?'Update billing cycle':'Save billing cycle')+'</button>'+
    (configured?'<button type="button" class="btn" data-remove-card-rule="'+escapeHTML(a.id)+'">Remove schedule</button>':'')+
    '<span class="status-tag">FORECAST ONLY · NO BANK PAYMENT INITIATED</span></div></form>';
 }).join('');
 const missing=cards.filter(a=>!rules[a.id]);
 return '<details class="panel planner-settings" id="card-autopay"><summary>Credit-card statements & autopay '+
  '<span class="status-tag '+(missing.length?'warn':'good')+'">'+
   (cards.length?missing.length+' NEED SETUP':'CONNECT A CARD')+'</span></summary>'+
  '<p class="lead">Configure each card separately. The selected account funds only that card’s predicted autopay. Transactions already on the card affect card debt; the checking withdrawal is added only when its card payment is due.</p>'+
  (cards.length?forms:'<p class="lead">No credit cards connected yet. Add one from Bank connections.</p>')+'</details>';
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
   seriesKey:p.seriesKey||null,baseDate:p.baseDate||p.date,cadence:p.cadence||null,
   recurringRuleId:p.recurringRuleId||null,
   sourceAccountId:String(p.sourceAccountId||p.fromAccountId||''),
   sourceMerchant:p.sourceMerchant||p.merchant,
   sourceType:p.sourceType||'transfer',
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
   seriesKey:e.seriesKey||null,baseDate:e.baseDate||e.date,cadence:e.cadence||null,
   recurringRuleId:e.recurringRuleId||null,
   sourceAccountId:String(e.sourceAccountId||e.accountId||''),
   sourceMerchant:e.sourceMerchant||e.merchant,
   sourceType:e.sourceType||e.type,
   addedId:String(e.id||'').startsWith('future-add|')?String(e.id):null});
 }
 return rows.sort((a,b)=>a.date.localeCompare(b.date)||a.merchant.localeCompare(b.merchant)||a.key.localeCompare(b.key));
}
function cadenceOption(cadence){
 return {'weekly':'weekly','every 2 weeks':'biweekly',biweekly:'biweekly',
  'every 4 weeks':'every-4-weeks','every-4-weeks':'every-4-weeks',monthly:'monthly',
  'twice monthly':'twice-monthly','twice-monthly':'twice-monthly',quarterly:'quarterly',
  semiannual:'semiannual',annual:'annual'}[String(cadence||'').toLowerCase()]||'monthly';
}
function frequencyChoices(value,includeOnce=false){
 const labels={once:'One time',weekly:'Every week',biweekly:'Every 2 weeks',
  'every-4-weeks':'Every 4 weeks (28 days)',
  'twice-monthly':'Twice monthly (two dates)',monthly:'Every month',
  quarterly:'Every 3 months',semiannual:'Every 6 months',annual:'Every year'};
 return '<select name="frequency" data-frequency>'+Object.entries(labels)
  .filter(([key])=>includeOnce||key!=='once')
  .map(([key,label])=>'<option value="'+key+'"'+(key===value?' selected':'')+'>'+
    escapeHTML(label)+'</option>').join('')+'</select>';
}
function historicalExamples(row,records,s){
 const examples=window.HouseholdPlannerTransactions.findExamples(records,row,activeAccounts(s));
 if(!examples.length)return '<p class="audit-footnote">No clear historical examples were matched. Select a frequency and the app will use your schedule and merchant/amount instead.</p>';
 return '<details class="future-examples"><summary>Help identify the matching past payments ('+
  examples.length+' found)</summary><p>Select examples belonging to this same recurring payment. They help the app recognize the correct merchant and amount.</p>'+
  examples.map(t=>'<label><input type="checkbox" name="examples" value="'+escapeHTML(t.id)+'"> '+
   escapeHTML(dayLabel(t.date))+' · '+escapeHTML(t.merchant)+' · '+cash(t.amount)+'</label>').join('')+
  '</details>';
}
function editorFor(row,s,records){
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
 const currentSeries=row.seriesKey?state().predictions?.futureSeriesEdits?.[row.seriesKey]:null;
 const selectedRule=(state().predictions?.futureRecurringRules||[]).find(r=>r.id===row.recurringRuleId);
 const cadence=selectedRule?.frequency||cadenceOption(row.cadence);
 const scope='<fieldset class="future-scope"><legend>Apply changes to</legend>'+
  '<label><input type="radio" name="scope" value="one" checked> This payment only</label>'+
  '<label><input type="radio" name="scope" value="all"> This and all future payments</label>'+
  '<p>Even if this payment was not detected as recurring, you can define its schedule. We will predict matching future payments by account, merchant, amount and frequency.</p>'+
  '</fieldset>'+
  '<div class="future-repeat-fields" hidden>'+
   '<div class="future-fields"><label>Repeat frequency'+frequencyChoices(cadence)+'</label>'+
   '<label class="future-second-day"'+(cadence==='twice-monthly'?'':' hidden')+'>Second day of month (1–31)'+
    '<input type="number" name="secondDay" min="1" max="31" value="'+escapeHTML(selectedRule?.secondDay||15)+'"></label></div>'+
   (!row.seriesKey?historicalExamples(row,records,s):'')+
  '</div>';
 return '<form class="future-edit-form" data-future-edit-form="'+escapeHTML(row.key)+'">'+keys+
  scope+
  '<div class="future-fields">'+fields+'</div>'+
  '<p class="audit-footnote">Individual exceptions and repeating rules are separate. '+
   (isMovement?'Both linked accounts update together. ':'')+
   'Forecast edits never change actual bank transactions.</p>'+
  '<div class="future-form-actions"><button class="btn primary" type="submit">Save changes</button>'+
   '<button class="btn" type="button" data-cancel-future>Cancel</button>'+
   (row.addedId?'<button class="btn" type="button" data-remove-added="'+escapeHTML(row.addedId)+'">Remove</button>':
    '<button class="btn" type="button" data-skip-future="'+escapeHTML(row.key)+'">Skip this occurrence</button>')+
   '<button class="btn" type="button" data-restore-future="'+escapeHTML(row.key)+'">Reset this occurrence</button>'+
   (currentSeries?'<button class="btn" type="button" data-reset-series="'+escapeHTML(row.seriesKey)+'">Reset all future changes</button>':'')+
   ((row.seriesKey||selectedRule)&&!(row.seriesKey||'').startsWith('autopay|')?
    '<button class="btn" type="button" data-remove-recurring="'+escapeHTML(row.key)+'">Not recurring</button>':'')+
   '</div></form>';
}
function missingMortgagePanel(bundle){
 const missing=bundle?.missingMortgages||[];
 if(!missing.length)return '';
 return '<section class="panel missing-mortgages" aria-label="Mortgage payments missing from forecast">'+
  '<div class="section-title"><h2>Possible missing mortgage payment'+(missing.length>1?'s':'')+
   '</h2><span class="status-tag warn">NOT IN FORECAST</span></div>'+
  '<p class="lead">Bank history shows a possible mortgage missing from the plan. '+
   'Review the next date, amount and paying account before it affects projected balances.</p>'+
  missing.map(m=>'<div class="mortgage-review" data-mortgage-review="'+escapeHTML(m.id)+'">'+
    '<div class="mortgage-review-info"><strong>'+escapeHTML(m.merchant)+' · '+cash(m.amount)+'</strong>'+
     '<small>'+escapeHTML(m.account)+' · Last posted '+escapeHTML(dayLabel(m.lastDate))+
      ' · Suggested next '+escapeHTML(dayLabel(m.nextDate))+'</small>'+
     '<small>'+m.observed+' actual payment example'+(m.observed===1?'':'s')+' found</small>'+
     '<details class="mortgage-examples"><summary>View posted examples</summary>'+
      m.examples.map(t=>'<div>'+escapeHTML(dayLabel(t.date))+' · '+
       escapeHTML(t.merchant)+' · '+cash(t.amount)+'</div>').join('')+'</details></div>'+
    '<div class="mortgage-review-actions"><button type="button" class="btn primary" data-review-mortgage="'+
     escapeHTML(m.id)+'">Review and schedule</button>'+
     '<button type="button" class="btn" data-dismiss-mortgage="'+escapeHTML(m.id)+
     '">Not recurring</button></div></div>').join('')+
  '<p class="audit-footnote">Suggested next date uses the last bank posting day, not the lender’s due date. Confirm it before saving. Bank records are never changed.</p></section>';
}
function newTransactionForm(s){
 const accounts=activeAccounts(s),primary=selected(s)?.id||accounts[0]?.id,
  defaultAccount=mortgageDraft?.accountId||(transactionFilter!=='all'?transactionFilter:primary),
  preset=mortgageDraft;
 return '<form class="future-new-form panel" id="future-new-form" data-future-new-form>'+
  '<div class="section-title"><h2>Add predicted transaction</h2><span class="status-tag">FORECAST ONLY</span></div>'+
  '<p class="lead">Add a dated future expense, deposit, refund or a transfer between your accounts. No money moves.</p>'+
  '<div class="future-fields">'+
  '<label>Transaction type<select name="type" id="new-future-type">'+
   '<option value="expense">Withdrawal / purchase</option><option value="income">Deposit</option>'+
   '<option value="refund">Refund</option><option value="transfer">Transfer between accounts</option></select></label>'+
  '<label>Description<input name="merchant" maxlength="160" placeholder="e.g. Property tax" value="'+escapeHTML(preset?.merchant||'')+'" required></label>'+
  '<label class="new-standard-account">Account'+accountSelect(accounts,defaultAccount,'accountId')+'</label>'+
  '<label class="future-transfer-only" hidden>From account'+accountSelect(accounts,defaultAccount,'fromAccountId')+'</label>'+
  '<label class="future-transfer-only" hidden>To account'+accountSelect(accounts,accounts.find(a=>String(a.id)!==String(defaultAccount))?.id||defaultAccount,'toAccountId')+'</label>'+
  '<label>Date<input name="date" type="date" min="'+escapeHTML(shiftDay(s.asOf,1))+'" max="'+escapeHTML(shiftDay(s.asOf,horizon))+'" value="'+
   escapeHTML(preset?.nextDate||shiftDay(s.asOf,1))+'" required></label>'+
  '<label>Amount ($)<input name="amount" type="number" min="0.01" max="999999999" step="0.01" required placeholder="0.00" value="'+escapeHTML(preset?.amount??'')+'"></label>'+
  '<label>Repeat'+frequencyChoices(preset?'monthly':'once',true)+'</label>'+
  '<label class="future-second-day" hidden>Second day of month (1–31)<input type="number" name="secondDay" min="1" max="31" value="15"></label>'+
  '</div><p class="audit-footnote">'+(preset?'Verify the proposed next due date against your mortgage documents. ': '')+
   'If auto-detection missed a bill or paycheck, select a frequency here to add every future occurrence, not just one date.</p>'+
  '<div class="future-form-actions"><button class="btn primary" type="submit">Add to forecast</button>'+
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
   '<small>'+escapeHTML(desc)+(row.seriesKey?' · Recurring':'')+
    (row.seriesKey&&state().predictions?.futureSeriesEdits?.[row.seriesKey]?' · SERIES EDITED':'')+'</small>'+
   '</div>'+
   '<div class="future-amount '+(incoming?'incoming':'outgoing')+'">'+(incoming?'+':paired?'↔ ':'−')+cash(row.amount)+'</div>'+
   '<button type="button" class="btn" data-edit-future="'+escapeHTML(row.key)+'">'+
    (canEdit?'Close':'Edit')+'</button></div>'+
   (canEdit?editorFor(row,s,bundle?.rows||[]):'')+'</article>';
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
   '<p>All dated predictions for the next '+horizon+' days. Select Edit to change a payment or choose Not recurring to remove an incorrectly detected repeating payment.</p></div>'+
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

function repeatingReviewForm(s){
 if(!recurringDraft)return '';
 const d=recurringDraft,accounts=activeAccounts(s),
  date=d.nextDate&&d.nextDate>s.asOf?d.nextDate:shiftDay(s.asOf,1),
  transfer=d.type==='transfer',
  otherAccount=accounts.find(a=>String(a.id)!==String(d.accountId))?.id||d.accountId;
 const from=d.fromAccountId||d.accountId,to=d.toAccountId&&d.toAccountId!==from?
  d.toAccountId:otherAccount;
 return '<form class="panel history-schedule-form" data-history-recurring-form>'+
  '<div class="section-title"><h2>Confirm recurring transaction</h2><span class="status-tag">FORECAST ONLY</span></div>'+
  '<p class="lead">Every bank transaction can become a repeating forecast, even if the bank assigned the wrong transaction type. Choose how it should affect future account balances.</p>'+
  (d.sourceRow?.type==='transfer'&&!transfer?
   '<p class="history-type-explanation">The bank labeled this as a transfer without a confirmed matching household account. An outgoing ACH debit, such as a mortgage, is proposed as an expense. Change the future type if needed.</p>':'')+
  (d.sourcePending?'<p class="history-type-explanation">This bank transaction is pending; its date or amount may change. Review both before scheduling.</p>':'')+
  '<div class="future-fields">'+
  '<label>Merchant<input name="merchant" maxlength="160" required value="'+escapeHTML(d.merchant)+'"></label>'+
  '<label>Future transaction type<select name="type" id="history-recurrence-type">'+
   '<option value="expense"'+(d.type==='expense'?' selected':'')+'>Expense / checking withdrawal</option>'+
   '<option value="income"'+(d.type==='income'?' selected':'')+'>Deposit / income</option>'+
   '<option value="refund"'+(d.type==='refund'?' selected':'')+'>Refund / account credit</option>'+
   '<option value="transfer"'+(transfer?' selected':'')+'>Transfer between my connected accounts</option>'+
   '</select></label>'+
  '<label class="history-single-account"'+(transfer?' hidden':'')+'>Account'+accountSelect(accounts,d.accountId,'accountId')+'</label>'+
  '<label class="history-transfer-only"'+(!transfer?' hidden':'')+'>From account'+
   accountSelect(accounts,from,'fromAccountId')+'</label>'+
  '<label class="history-transfer-only"'+(!transfer?' hidden':'')+'>To account'+
   accountSelect(accounts,to,'toAccountId')+'</label>'+
  '<label>Next expected date<input name="date" type="date" min="'+escapeHTML(shiftDay(s.asOf,1))+
   '" max="'+escapeHTML(shiftDay(s.asOf,90))+'" required value="'+escapeHTML(date)+'"></label>'+
  '<label>Amount ($)<input name="amount" type="number" min=".01" max="999999999" step=".01" required value="'+
   escapeHTML(d.amount||'')+'"></label>'+
  '<label>Repeat'+frequencyChoices(d.frequency||'monthly')+'</label>'+
  '<label class="future-second-day" hidden>Second day of month (1–31)<input name="secondDay" type="number" min="1" max="31" value="15"></label>'+
  '</div>'+
  '<p class="audit-footnote">For actual account-to-account transfers, select Transfer and two connected accounts. Otherwise use Expense or Deposit. Only the future forecast changes; the original bank record is never edited or duplicated.</p>'+
  '<div class="future-form-actions"><button type="submit" class="btn primary">Save recurring forecast</button>'+
  '<button type="button" class="btn" data-cancel-review-form>Cancel</button></div></form>';
}
function historyPage(bundle,s){
 const accounts=activeAccounts(s),records=(bundle?.rows||[]).filter(x=>x.date&&x.date<=s.asOf)
  .sort((a,b)=>b.date.localeCompare(a.date)||String(b.id).localeCompare(String(a.id)));
 const filtered=records.filter(t=>{
  const aid=window.HouseholdPlannerHistory.accountOf(t,accounts);
  if(historyAccount!=='all'&&historyAccount!==aid)return false;
  if(!historySearch)return true;
  return [t.merchant,t.description,t.date,t.category,t.account,t.amount]
   .some(v=>String(v||'').toLowerCase().includes(historySearch.toLowerCase()));
 });
 const visible=filtered.slice(0,historyLimit),label=id=>accounts.find(a=>String(a.id)===id)?.name||id;
 const savedRules=state().predictions?.futureRecurringRules||[];
 const rows=visible.map(t=>{
  const aid=window.HouseholdPlannerHistory.accountOf(t,accounts);
  const incoming=['income','refund'].includes(t.type)||
   t.type==='transfer'&&t.cashDirection==='in';
  const linked=savedRules.some(r=>String(r.originalAccountId)===aid&&
   r.originalType===t.type&&Math.abs(Number(r.matchAmount)-Number(t.amount))<.011&&
   (r.matchNames||[]).includes(String(t.merchant||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()));
  const kind=t.type==='transfer'&&!t.pairedTransactionId?
   (t.cashDirection==='out'?'expense':t.cashDirection==='in'?'income':'transfer'):t.type;
  const tools=window.HouseholdPlannerTransactions;
  const rejectedKey=tools.recurrenceKey(aid,kind,t.merchant);
  const rejected=Boolean(state().predictions?.futureRecurrenceExclusions?.[rejectedKey]);
  const predicted=futureRows(bundle,s).some(r=>r.kind==='event'&&
   String(r.sourceAccountId||r.accountId)===aid&&r.sourceType===kind&&
   tools.recurrenceKey(aid,kind,r.sourceMerchant)===rejectedKey&&r.seriesKey);
  const action='<button class="btn" type="button" data-history-plan="'+escapeHTML(String(t.id))+
   '" data-history-account="'+escapeHTML(aid)+'">'+(linked?'Edit forecast':'Make recurring')+'</button>'+
   (rejected?'<button class="btn" type="button" data-restore-recurrence="'+escapeHTML(rejectedKey)+
    '">Allow predictions</button>':linked||predicted?
    '<button class="btn" type="button" data-stop-history-recurrence="'+escapeHTML(String(t.id))+
    '" data-history-account="'+escapeHTML(aid)+'">Not recurring</button>':'');
  return '<div class="history-actual-row" data-historical-transaction="'+escapeHTML(String(t.id))+'">'+
   '<span class="history-actual-date">'+escapeHTML(dayLabel(t.date))+'</span>'+
   '<div class="history-actual-description"><strong>'+escapeHTML(t.merchant||'Bank transaction')+'</strong>'+
   '<small>'+escapeHTML(label(aid))+' · '+escapeHTML(t.type||'Unclassified')+
    (t.pending?' · Pending':' · Posted')+(linked?' · Recurring confirmed':'')+
    (rejected?' · NOT RECURRING':'')+'</small></div>'+
   '<strong class="history-actual-amount '+(incoming?'incoming':'outgoing')+'">'+(incoming?'+':'−')+cash(t.amount)+'</strong>'+
   action+'</div>';
 }).join('');
 return '<div class="planner-page history-page"><div class="page-heading"><div><h2>Actual transaction history</h2>'+
  '<p>Every transaction retrieved from your connected accounts. These are bank records—not predictions.</p></div>'+
  '<span class="status-tag">'+records.length+' TRANSACTIONS</span></div>'+
  (reviewNotice?'<p class="future-notice" role="status">'+escapeHTML(reviewNotice)+'</p>':'')+
  (recurringDraft?repeatingReviewForm(s):'')+
  '<section class="panel"><form class="history-filters" data-history-filter>'+
   '<label>Account'+accountSelect(accounts,historyAccount,'historyAccount',true)+'</label>'+
   '<label>Search transactions<input name="search" type="search" value="'+escapeHTML(historySearch)+
    '" placeholder="Merchant, date, amount"></label>'+
   '<button class="btn" type="submit">Search</button>'+
   (historySearch?'<button type="button" class="btn" data-clear-history-search>Clear</button>':'')+
   '</form><p class="history-count">'+filtered.length+' actual records match. Showing '+visible.length+
    ' newest '+(filtered.length>historyLimit?'— load older records below.':'records.')+'</p>'+
   (rows||'<div class="empty-visual">No bank transactions match this filter. Try another account or search.</div>')+
   (filtered.length>historyLimit?'<div class="history-more"><button type="button" class="btn" data-history-more>Show older transactions</button></div>':'')+
   '<p class="audit-footnote">Every historical transaction, including transfers, refunds and pending bank entries, can be turned into a proposed future schedule. Review its type, amount, and date. No bank transaction is changed and no payment is initiated.</p></section></div>';
}
function reviewsPage(bundle,s){
 const regular=bundle?.routines?.review||[],mortgages=bundle?.missingMortgages||[],
  accounts=activeAccounts(s),normalize=t=>String(t||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const weak=(bundle?.historyCandidates||[]).filter(p=>
  !mortgages.some(m=>m.accountId===p.accountId&&normalize(m.merchant)===normalize(p.merchant)&&
   Math.abs(m.amount-p.amount)<.011)&&
  !regular.some(r=>{
   const aid=accounts.find(a=>[a.id,a.name,a.transactionAccount].some(k=>String(k)===String(r.account)))?.id;
   return String(aid||r.account)===p.accountId&&normalize(r.merchant)===normalize(p.merchant)&&
    Math.abs(r.amount-p.amount)<.011;
  }));
 const autoLow=(bundle?.automaticRecurrence?.review||[]).filter(a=>
  !weak.some(w=>w.accountId===a.accountId&&normalize(w.merchant)===normalize(a.merchant))&&
  !mortgages.some(w=>w.accountId===a.accountId&&normalize(w.merchant)===normalize(a.merchant)));
 const duplicates=bundle?.duplicateConflicts||[];
 const count=regular.length+mortgages.length+weak.length+autoLow.length+duplicates.length;
 const cards=weak.map(p=>
  '<article class="review-candidate" data-review-item="'+escapeHTML(p.key)+'">'+
   '<div class="review-candidate-main"><strong>'+escapeHTML(p.merchant)+'</strong>'+
   '<small>'+escapeHTML(p.accountName)+' · '+escapeHTML(p.frequency)+
    ' · '+p.occurrences+' actual payment'+(p.occurrences===1?'':'s')+
    ' · Next suggested '+escapeHTML(dayLabel(p.nextDate))+'</small>'+
   '<small>'+escapeHTML(p.reason)+' · '+escapeHTML(p.confidence==='Needs confirmation'?'Needs confirmation':p.confidence+' confidence')+'</small>'+
   '<details class="review-examples"><summary>View matching bank transactions</summary>'+
    p.examples.map(t=>'<div>'+escapeHTML(dayLabel(t.date))+' · '+escapeHTML(t.merchant)+
     ' · '+cash(t.amount)+'</div>').join('')+'</details></div>'+
   '<strong class="review-candidate-amount">'+cash(p.amount)+'</strong>'+
   '<div class="review-candidate-actions"><button class="btn primary" type="button" data-review-candidate="'+
     escapeHTML(p.key)+'">Review and confirm</button>'+
    '<button class="btn" type="button" data-dismiss-candidate="'+escapeHTML(p.key)+
     '">Not recurring</button></div></article>').join('');
 const concerns=(bundle?.payments?.warnings||[]).slice(0,8);
 return '<div class="planner-page reviews-page"><div class="page-heading"><div><h2>Needs review</h2>'+
  '<p>We check bank history aggressively, but uncertain patterns need your decision before becoming future bills.</p></div>'+
  '<span class="status-tag">'+count+' PAYMENT'+(count===1?'':'S')+' TO REVIEW</span></div>'+
  (reviewNotice?'<p class="future-notice" role="status">'+escapeHTML(reviewNotice)+'</p>':'')+
  (recurringDraft?repeatingReviewForm(s):'')+
  ((bundle?.duplicateChecks||[]).length?'<p class="audit-footnote">Duplicate protection: '+
    (bundle.duplicateChecks.length)+' overlapping forecast entr'+
    (bundle.duplicateChecks.length===1?'y was':'ies were')+
    ' automatically consolidated. Bank transactions were not changed.</p>':'')+
  (mortgages.length?missingMortgagePanel(bundle):'')+
  (regular.length?routineReviewPanel(bundle):'')+
  (autoLow.length?'<section class="panel"><div class="section-title"><h2>Uncertain repeating payments</h2>'+
   '<span class="status-tag warn">'+autoLow.length+' NEEDS REVIEW</span></div>'+
   '<p class="lead">Two matching withdrawals were observed, but the merchant is not clearly a fixed monthly bill. These are not yet deducted from predicted balances. Open History to confirm a recurring schedule.</p>'+
   autoLow.map(p=>'<div class="review-candidate"><div class="review-candidate-main"><strong>'+
    escapeHTML(p.merchant)+'</strong><small>'+cash(p.amount)+' · '+escapeHTML(p.reason)+
    '</small></div><button type="button" class="btn" data-view="history">Review in History</button></div>').join('')+
   '</section>':'')+
  (duplicates.length?'<section class="panel"><div class="section-title"><h2>Ambiguous predicted payments</h2>'+
   '<span class="status-tag warn">'+duplicates.length+' NEEDS REVIEW</span></div>'+
   '<p class="lead">Possible duplicate predictions cannot be matched confidently. Review them before relying on the projected balance.</p>'+
   duplicates.map(d=>'<div class="review-candidate"><span>'+escapeHTML(d.merchant||d.reason||'Competing forecast payments')+
    '</span><button type="button" class="btn" data-view="transactions">Review predicted payments</button></div>').join('')+
   '</section>':'')+
  (weak.length?'<section class="panel"><div class="section-title"><h2>Potential recurring payments</h2>'+
   '<span class="status-tag">'+weak.length+' TO CONFIRM</span></div>'+
   '<p class="lead">All recent payments are checked, including unfamiliar merchants and outgoing ACH debits. A single payment is a possibility, not proof of recurrence. Confirm amount, frequency and next date before uncertain items affect your balance.</p>'+
   cards+'</section>':'')+
  (!count?'<section class="panel"><div class="section-title"><h2>All caught up</h2></div>'+
   '<p class="lead">No uncertain recurring payment patterns currently need a decision. You can still review any posted transaction in History and make it recurring.</p>'+
   '<button type="button" class="btn" data-view="history">View actual transactions</button></section>':'')+
  (concerns.length?'<section class="panel"><div class="section-title"><h2>Other planning alerts</h2></div>'+
    concerns.map(x=>'<p class="review-warning">'+escapeHTML(x)+'</p>').join('')+'</section>':'')+
  '</div>';
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
function upcomingCardBills(bundle,s){
 const all=(bundle?.payments?.statements||[]),cards=activeAccounts(s).filter(a=>accountType(a)==='credit');
 if(!cards.length)return '';
 const earliest=cards.map(c=>all.find(p=>String(p.cardId)===String(c.id))).filter(Boolean)
  .sort((a,b)=>a.withdrawalDate.localeCompare(b.withdrawalDate));
 return '<section class="panel upcoming-card-bills" aria-label="Upcoming credit card statements">'+
  '<div class="section-title"><h2>Upcoming credit-card bills</h2>'+
   '<button type="button" class="btn" data-view="settings">Set billing dates and autopay</button></div>'+
  (earliest.map(p=>'<div class="card-bill-row"><div><strong>'+escapeHTML(p.cardName)+
    '</strong><small>Cycle closes '+escapeHTML(dayLabel(p.closingDate))+
    ' · Due '+escapeHTML(dayLabel(p.dueDate))+
    (p.alreadyPaid?' · Paid '+escapeHTML(dayLabel(p.actualPaymentDate))+
      ' · '+cash(p.actualPaymentAmount)+' from '+escapeHTML(p.fromName):
     p.autopayEnabled?' · Planned '+escapeHTML(dayLabel(p.withdrawalDate))+
      ' from '+escapeHTML(p.fromName):' · No autopay')+
    (p.estimated?' · Estimated':' · Entered statement')+'</small></div>'+
    '<strong>'+cash(p.statementBalance)+'</strong></div>').join('')||
    '<p class="lead">No card statement forecasts are configured yet. Set up each card in Settings.</p>')+
  '<p class="audit-footnote">Based on posted and known future charges only. Unplanned card spending, interest, fees and carried balances may change the actual bill.</p></section>';
}
function overviewPage(bundle,s,chosen,derived,fresh){
 const series=(derived?.series||[]).filter(x=>x.date<=shiftDay(s.asOf,horizon));
 const events=(derived?.events||[]).filter(x=>x.date>s.asOf&&x.date<=shiftDay(s.asOf,horizon))
  .sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);
 const notes=events.map(e=>'<div class="overview-upcoming-item"><span>'+escapeHTML(dayLabel(e.date))+
  '</span><strong>'+escapeHTML(e.merchant)+'</strong><span>'+cash(e.amount)+'</span></div>').join('');
 return '<div class="planner-page overview-page">'+
  accountCards(s,bundle?.projection,chosen)+hero(chosen,derived,s.asOf)+
  ((bundle?.missingMortgages?.length||bundle?.historyCandidates?.length||bundle?.routines?.review?.length||bundle?.automaticRecurrence?.review?.length||bundle?.duplicateConflicts?.length)?
    '<section class="panel review-spotlight"><div><strong>Recurring payments may need review</strong>'+
    '<p>Recent bank transactions may repeat. Confirm uncertain patterns before they affect your balance.</p></div>'+
    '<button type="button" class="btn" data-view="reviews">Review suggestions</button></section>':'')+
  incomeStatus(bundle,s,chosen,derived)+upcomingCardBills(bundle,s)+
  '<section class="panel overview-chart" aria-label="Projected balance curve">'+
   '<div class="section-title"><h2>Balance trajectory</h2><p>Next '+horizon+' days</p></div>'+
   (derived&&fresh?miniChart(series,s.asOf):'<div class="empty-visual">A current account balance is required for a projection.</div>')+
   '<p class="chart-caption">This balance projection includes evidenced recurring payments and confirmed schedules. One-off purchases are not projected automatically.</p></section>'+
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
  '<section class="panel mini-panel" aria-label="Not recurring decisions">'+
   '<div class="section-title"><h2>Not recurring</h2><span class="status-tag">'+
    Object.keys(state().predictions?.futureRecurrenceExclusions||{}).length+' EXCLUDED</span></div>'+
   '<p>These merchants are excluded from automatic recurring predictions for the selected account and direction. Your actual bank transactions are unchanged. Choose Allow predictions to undo a mistake; manually created schedules can be added again from History or Transactions.</p>'+
   Object.entries(state().predictions?.futureRecurrenceExclusions||{}).map(([key,item])=>
    '<div class="future-skip-line"><strong>'+escapeHTML(item.merchant)+'</strong> · '+
     escapeHTML(activeAccounts(s).find(a=>String(a.id)===String(item.accountId))?.name||item.accountId)+
     ' · '+escapeHTML(item.type)+
     ' <button type="button" class="btn" data-restore-recurrence="'+escapeHTML(key)+
     '">Allow predictions</button></div>').join('')+
   (!Object.keys(state().predictions?.futureRecurrenceExclusions||{}).length?
     '<p class="audit-footnote">No recurring patterns have been excluded.</p>':'')+
   '</section>'+
  '<section class="panel mini-panel" aria-label="Recurring forecast changes">'+
   '<div class="section-title"><h2>Recurring payment changes</h2>'+
    '<span class="status-tag">'+Object.keys(state().predictions?.futureSeriesEdits||{}).length+' CUSTOMIZED</span></div>'+
   '<p>To change a mortgage, bill, paycheck, or card payment across future months, open Transactions, click <strong>Edit</strong>, and select <strong>This and all future payments</strong>.</p>'+
   '<button type="button" class="btn" data-view="transactions">Manage future payments</button>'+
   '</section>'+
  auditPanel(chosen)+autopayPanel(s,bundle)+connectionPanel(s,bundle)+'</div>';
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
 // Actual bank history must remain usable even if the separate future
 // balance projection cannot be calculated or needs a repaired account.
 if(!bundle&&['history','reviews'].includes(activeTab)){
  try{
   const rows=model.records(state()),accounts=activeAccounts(s),asOf=s.asOf||dateToday();
   const candidates=window.HouseholdFutureLedger.analyze(
    rows,accounts,asOf,state().predictions||{},90);
   bundle={rows,historyCandidates:candidates.review,
    routines:{review:[]},missingMortgages:[],
    automaticRecurrence:{review:[]},duplicateConflicts:candidates.conflicts};
  }catch(_error){/* The visible forecast error remains available above. */}
 }
 const projection=bundle?.projection||null,selectedSource=selected(s);
 lastSuggestions=bundle?.routines?.review||[];
 lastMissingMortgages=bundle?.missingMortgages||[];
 lastHistoryRows=bundle?.rows||[];
 lastReviewCandidates=bundle?.historyCandidates||[];
 if(selectedSource)selectedAccount=selectedSource.id;
 const derived=projection?.accounts.find(x=>x.id===String(selectedAccount));
 const statuses=projection?.diagnostics||{};
 const missingCards=activeAccounts(s).filter(a=>accountType(a)==='credit'&&
  !state().predictions?.paymentRules?.[a.id]);
 const caution=[
  ...(missingCards.length?['Credit-card payment schedule not set for '+missingCards.map(a=>a.name).join(', ')+'. Future checking withdrawals may be incomplete.']:[]),
  ...((bundle?.payments?.warnings||[]).slice(0,3)),
  ...((bundle?.missingMortgages||[]).slice(0,2).map(m=>
   'An actual '+cash(m.amount)+' mortgage payment from '+m.account+' is not in the forecast. Review its proposed recurring schedule below.')),
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
  activeTab==='history'?historyPage(bundle,s):
  activeTab==='reviews'?reviewsPage(bundle,s):
  activeTab==='transactions'?transactionsPage(bundle,s):overviewPage(bundle,s,selectedSource,derived,fresh);
}
document.addEventListener('click',async e=>{
 const view=e.target.closest('[data-view]');
 if(view){
  activeTab=view.dataset.view;
  editingKey='';showNewTransaction=false;transactionNotice='';recurringDraft=null;
  render();
  window.scrollTo({top:0,behavior:'auto'});
  return;
 }
 const fromHistory=e.target.closest('[data-history-plan]');
 if(fromHistory){
  const account=fromHistory.dataset.historyAccount;
  const row=lastHistoryRows.find(t=>String(t.id)===fromHistory.dataset.historyPlan&&
   window.HouseholdPlannerHistory.accountOf(t,activeAccounts(snapshot()))===account);
  if(!row||!window.HouseholdPlannerHistory.canPlan(row)){
   setNotice('That bank transaction is no longer available for review.');return;
  }
  try{
   recurringDraft=window.HouseholdPlannerHistory.draftFor(
    row,lastHistoryRows,activeAccounts(snapshot()),snapshot().asOf);
   reviewNotice='';
  }catch(error){setNotice(String(error.message||error));return}
  reviewNotice='';render();
  document.querySelector('[data-history-recurring-form]')?.scrollIntoView({behavior:'smooth',block:'start'});
  return;
 }
 const restorePattern=e.target.closest('[data-restore-recurrence]');
 if(restorePattern){
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.restoreRecurrence(
    state(),restorePattern.dataset.restoreRecurrence));
   recurringDraft=null;
   reviewNotice='Automatic recurrence detection is allowed again for this merchant.';
   transactionNotice=reviewNotice;
   render();
  }catch(err){setNotice(String(err.message||err))}
  return;
 }
 const stopHistory=e.target.closest('[data-stop-history-recurrence]');
 if(stopHistory){
  const aid=stopHistory.dataset.historyAccount;
  const row=lastHistoryRows.find(t=>String(t.id)===stopHistory.dataset.stopHistoryRecurrence&&
   window.HouseholdPlannerHistory.accountOf(t,activeAccounts(snapshot()))===aid);
  if(!row){setNotice('That bank transaction is no longer available.');return}
  const kind=row.type==='transfer'?
   (row.cashDirection==='out'?'expense':row.cashDirection==='in'?'income':'transfer'):row.type;
  const saved=(state().predictions?.futureRecurringRules||[]).find(r=>
   String(r.originalAccountId||r.accountId||r.fromAccountId)===aid&&
   String(r.originalMerchant||r.merchant).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()===
    String(row.merchant).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()&&
   (r.kind==='movement'?'transfer':r.type)===kind);
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.stopRecurrence(state(),{
    kind:saved?.kind==='movement'?'movement':'event',accountId:aid,type:kind,
    merchant:row.merchant,recurringRuleId:saved?.id||null
   }));
   recurringDraft=null;reviewNotice='Marked '+row.merchant+
    ' as not recurring. All future predictions were removed.';
   render();
  }catch(err){setNotice(String(err.message||err))}
  return;
 }
 const reviewCandidate=e.target.closest('[data-review-candidate]');
 if(reviewCandidate){
  const candidate=lastReviewCandidates.find(x=>x.key===reviewCandidate.dataset.reviewCandidate);
  if(!candidate){setNotice('Review candidates changed. Refresh bank history.');return}
  const source=lastHistoryRows.find(t=>String(t.id)===candidate.examples[0]?.id);
  recurringDraft={accountId:candidate.accountId,merchant:candidate.merchant,
   type:candidate.type,amount:candidate.amount,frequency:candidate.frequency,
   nextDate:candidate.nextDate,sourceRow:source,
   examples:candidate.examples.map(x=>x.id)};
  reviewNotice='';render();
  document.querySelector('[data-history-recurring-form]')?.scrollIntoView({behavior:'smooth',block:'start'});
  return;
 }
 const dismissCandidate=e.target.closest('[data-dismiss-candidate]');
 if(dismissCandidate){
  const item=lastReviewCandidates.find(x=>x.key===dismissCandidate.dataset.dismissCandidate);
  if(!item){setNotice('This suggestion is no longer available.');return}
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.stopRecurrence(state(),{
    kind:'event',accountId:item.accountId,type:item.type,merchant:item.merchant
   }));
   recurringDraft=null;reviewNotice='Marked '+item.merchant+
    ' as not recurring. You can reverse this in Settings.';render();
  }catch(err){setNotice(String(err.message||err))}
  return;
 }
 if(e.target.closest('[data-cancel-review-form]')){
  recurringDraft=null;render();return;
 }
 if(e.target.closest('[data-history-more]')){
  historyLimit+=90;render();return;
 }
 if(e.target.closest('[data-clear-history-search]')){
  historySearch='';historyLimit=90;render();return;
 }
 const mortgageReview=e.target.closest('[data-review-mortgage]');
 if(mortgageReview){
  const m=lastMissingMortgages.find(x=>x.id===mortgageReview.dataset.reviewMortgage);
  if(!m){setNotice('Mortgage history changed. Refresh and try again.');return}
  mortgageDraft={...m};activeTab='transactions';transactionFilter=m.accountId;
  showNewTransaction=true;editingKey='';transactionNotice='';
  render();
  $('future-new-form')?.scrollIntoView({behavior:'smooth',block:'center'});
  return;
 }
 const mortgageDismiss=e.target.closest('[data-dismiss-mortgage]');
 if(mortgageDismiss){
  const m=lastMissingMortgages.find(x=>x.id===mortgageDismiss.dataset.dismissMortgage);
  if(!m){setNotice('Mortgage history changed. Refresh and try again.');return}
  try{
   await commitForecastChange(()=>{
    state().predictions.mortgageReviewDismissals??=[];
    if(!state().predictions.mortgageReviewDismissals.includes(m.id))
     state().predictions.mortgageReviewDismissals.push(m.id);
   });
   mortgageDraft=null;render();
  }catch(err){setNotice(String(err.message||err))}
  return;
 }
 if(e.target.closest('[data-show-new]')){
  showNewTransaction=true;mortgageDraft=null;editingKey='';transactionNotice='';render();
  $('future-new-form')?.scrollIntoView({behavior:'smooth',block:'center'});return;
 }
 if(e.target.closest('[data-cancel-new]')){
  showNewTransaction=false;mortgageDraft=null;transactionNotice='';render();return;
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
 const removeRecurring=e.target.closest('[data-remove-recurring]');
 if(removeRecurring){
  const row=futureRows(forecastFor(snapshot()),snapshot())
   .find(r=>r.key===removeRecurring.dataset.removeRecurring);
  if(!row){setNotice('The recurring schedule changed. Open Transactions and try again.');return}
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.stopRecurrence(state(),row));
   editingKey='';transactionNotice='Marked '+row.merchant+
    ' as not recurring. All predicted occurrences were removed. Restore it in Settings or History.';render();
  }catch(err){transactionNotice=String(err.message||err);render()}
  return;
 }
 const resetRecurring=e.target.closest('[data-reset-series]');
 if(resetRecurring){
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.resetSeries(state(),resetRecurring.dataset.resetSeries));
   editingKey='';transactionNotice='Recurring schedule restored to its original forecast.';render();
  }catch(err){transactionNotice=String(err.message||err);render()}
  return;
 }
 const runAudit=e.target.closest('[data-run-backtest]');
 if(runAudit){
  const s=snapshot(),chosen=selected(s);
  if(!chosen)return;
  const accountId=String(chosen.id),prior=auditAccount===accountId?audit:null;
  const previousNumber=auditAccount===accountId?Number(auditMeta?.number||0):0;
  // The unified walk-forward check is fast and synchronous. Render its
  // result before the click finishes; never leave a stale closed panel.
  runAudit.disabled=true;runAudit.textContent='Checking…';
  auditAccount=accountId;
  try{
   const updated=window.HouseholdFutureLedger.backtest(
    model.records(state()),activeAccounts(s),s.asOf||dateToday(),accountId,6);
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
  try{
   await commitForecastChange(()=>{state().predictions.primaryAccountId=current.id});
   selectedAccount=current.id;latestError='';render();
  }catch(err){setNotice('Main account setting could not be saved: '+String(err.message||err))}
  return;
 }
 const remove=e.target.closest('[data-remove-card-rule]');
 if(remove){
  try{
   await commitForecastChange(()=>window.HouseholdLedgerData.removeCardPaymentRule(state(),remove.dataset.removeCardRule));
   latestError='';render();document.getElementById('card-autopay')?.setAttribute('open','');
  }catch(err){setNotice('Card payment schedule could not be saved: '+String(err.message||err))}
  return;
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
  if(live()&&(!saved||saved.saved!==true))throw Error('The predicted transaction was not saved. Please try again.');
  return result;
 }catch(err){current.predictions=JSON.parse(before);throw err}
}
document.addEventListener('submit',async e=>{
 const form=e.target.closest('[data-history-filter]');
 if(!form)return;
 e.preventDefault();
 const fields=Object.fromEntries(new FormData(form));
 historySearch=String(fields.search||'').trim().slice(0,100);
 historyAccount=String(fields.historyAccount||'all');
 historyLimit=90;
 render();
});
document.addEventListener('submit',async e=>{
 const form=e.target.closest('[data-history-recurring-form]');
 if(!form)return;
 e.preventDefault();
 const button=form.querySelector('button[type="submit"]');
 if(button)button.disabled=true;
 try{
  const draft=recurringDraft;
  if(!draft)throw Error('Select a posted bank payment again');
  const fields=Object.fromEntries(new FormData(form));
  if(fields.date>shiftDay(snapshot().asOf,90))
   throw Error('Next payment must fall within the 90-day planning window');
  const linked=fields.type==='transfer',bankType=draft.originalType||draft.sourceRow?.type||draft.type;
  // Future classification is chosen by the owner, not dictated by Plaid.
  // For an actual household transfer, store both account legs as ONE plan,
  // rather than predicting an outgoing debit and unrelated incoming credit.
  const candidate=linked?{
   kind:'movement',fromAccountId:fields.fromAccountId,toAccountId:fields.toAccountId,
   type:'transfer',amount:draft.amount,merchant:draft.merchant,
   date:draft.sourceRow?.date||draft.nextDate,sourceAmount:draft.amount,
   originalMerchant:draft.merchant
  }:{
   kind:'event',accountId:draft.accountId,type:bankType,amount:draft.amount,
   merchant:draft.merchant,date:draft.sourceRow?.date||draft.nextDate,
   sourceAmount:draft.amount,originalMerchant:draft.merchant
  };
  await commitForecastChange(()=>window.HouseholdPlannerTransactions.defineRecurring(
   state(),fields,activeAccounts(snapshot()),snapshot().asOf,candidate,
   model.records(state()),linked?[]:draft.examples||[]));
  const origin=draft.merchant;
  recurringDraft=null;reviewNotice='Saved recurring forecast for '+origin+'.';
  transactionNotice=reviewNotice;
  render();
 }catch(err){
  if(button)button.disabled=false;
  let message=form.querySelector('.future-form-error');
  if(!message){
   message=document.createElement('p');message.className='future-form-error';
   message.setAttribute('role','alert');form.appendChild(message);
  }
  message.textContent=String(err.message||err);
 }
});
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
   const row=futureRows(forecastFor(s),s).find(item=>item.key===key);
   if(!row)throw Error('Forecast changed. Reopen the payment and try again.');
   if(fields.scope==='all'){
    const examples=new FormData(form).getAll('examples');
    await commitForecastChange(()=>{
     const existingRows=futureRows(forecastFor(s),s);
     const existingCadence=cadenceOption(row.cadence);
     const useSeries=Boolean(row.seriesKey&&
      fields.frequency===existingCadence&&row.cadence&&!row.addedId);
     const saveCadence=row.cadence==='twice-monthly'?'twice monthly':row.cadence;
     const result=useSeries?
      planner.saveSeriesEdit(state(),row.seriesKey,row.baseDate,fields,accounts,asOf,saveCadence,row.kind):
      planner.defineRecurring(state(),fields,accounts,asOf,row,model.records(state()),examples);
     const edits=state().predictions.futureTransactionEdits||{};
     for(const other of existingRows){
      if(other.key===row.key||row.seriesKey&&other.seriesKey===row.seriesKey&&other.baseDate>=row.baseDate)
       delete edits[other.key];
     }
     // Replacing inferred recurrence with an explicit schedule makes the old
     // per-series edit unnecessary; the confirmed rule is authoritative.
     if(!useSeries&&row.seriesKey)delete state().predictions.futureSeriesEdits?.[row.seriesKey];
     return result;
    });
    transactionNotice='Saved recurring schedule. All matching future payments will be forecast.';
   }else{
    await commitForecastChange(()=>planner.saveEdit(state(),key,fields,accounts,asOf));
    transactionNotice='Updated only this predicted payment.';
   }
   editingKey='';
  }else if(form.hasAttribute('data-future-new-form')){
   if(fields.frequency&&fields.frequency!=='once'){
    await commitForecastChange(()=>planner.defineRecurring(state(),fields,accounts,asOf));
    transactionNotice='Recurring payment created. Future occurrences were added to the forecast.';
   }else{
    await commitForecastChange(()=>planner.add(state(),fields,accounts,asOf));
    transactionNotice='Future transaction added to the selected account.';
   }
   showNewTransaction=false;mortgageDraft=null;
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
document.addEventListener('submit',async e=>{
 const form=e.target.closest('[data-card-rule]');
 if(!form)return;
 e.preventDefault();
 const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;
 try{
  const cardId=form.dataset.cardRule,fields=Object.fromEntries(new FormData(form));
  const banks=activeAccounts(snapshot());
  const card=banks.find(a=>String(a.id)===cardId&&accountType(a)==='credit');
  const from=banks.find(a=>String(a.id)===fields.fromAccountId&&accountType(a)==='cash');
  if(!card||fields.autopayEnabled==='yes'&&!from)
   throw Error('Select the card and the checking/savings account that pays it');
  if(fields.nextPaymentDate<=dateToday())throw Error('Enter the next future withdrawal date');
  if(fields.nextPaymentDate>fields.nextDueDate)
   throw Error('The payment should not be after the card due date');
  const rule={...fields,closingDay:Number(fields.billingEndDate.slice(-2)),
   lastStatementClose:fields.billingEndDate,method:'statement'};
  await commitForecastChange(()=>window.HouseholdLedgerData.setCardPaymentRule(state(),cardId,rule));
  latestError='';render();document.getElementById('card-autopay')?.setAttribute('open','');
 }catch(err){
  if(button)button.disabled=false;
  let error=form.querySelector('.future-form-error');
  if(!error){error=document.createElement('p');error.className='future-form-error';error.setAttribute('role','alert');form.appendChild(error)}
  error.textContent=String(err.message||err);
 }
});
document.addEventListener('change',e=>{
 if(e.target.id==='history-recurrence-type'){
  const form=e.target.closest('form'),transfer=e.target.value==='transfer';
  form?.querySelectorAll('.history-transfer-only').forEach(el=>el.hidden=!transfer);
  const single=form?.querySelector('.history-single-account');
  if(single)single.hidden=transfer;
  return;
 }
 if(e.target.name==='historyAccount'){
  historyAccount=e.target.value;historyLimit=90;render();return;
 }
 if(e.target.name==='scope'){
  const form=e.target.closest('[data-future-edit-form]');
  const section=form?.querySelector('.future-repeat-fields');
  if(section)section.hidden=e.target.value!=='all';
  return;
 }
 if(e.target.matches?.('[data-frequency]')){
  const form=e.target.closest('form');
  const second=form?.querySelector('.future-second-day');
  if(second)second.hidden=e.target.value!=='twice-monthly';
  return;
 }
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