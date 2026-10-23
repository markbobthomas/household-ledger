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
    'futureTransactionEdits','futureTransactionAdds','futureSeriesEdits','futureRecurringRules','scheduleCategories','futureRecurrenceExclusions','mortgageReviewDismissals','historyPatternDecisions','mortgageCoverageRules','coverageAssignments'];
  for(const key of keys)if(saved[key]!==undefined)demoState.predictions[key]=saved[key];
 }
}catch{}
const horizon=1095; // Three-year modeled floor. No user-selectable time windows.
// Human-facing list number. Canonical rule IDs remain unchanged. Numbers follow
// the saved list order and are recalculated if schedules are removed/reordered.
function scheduleListNumber(id){
 const rules=state().predictions?.futureRecurringRules||[];
 const index=rules.findIndex(r=>String(r.id)===String(id));
 return index<0?null:index+1;
}

let liveState=null,liveSnapshot=null,selectedAccount=null,latestError='',lastSuggestions=[];
let activeTab=window.HouseholdPlannerSummary?.render?'summary':'overview',transactionFilter='all',editingKey='',showNewTransaction=false,transactionNotice='',mortgageDraft=null;
let lastMissingMortgages=[],lastHistoryRows=[],lastReviewCandidates=[];
let historyAccount='all',historySearch='',historyLimit=90,recurringDraft=null,reviewNotice='';
let scheduleMode='',scheduleTarget='',schedulePreset=null,scheduleNotice='',scheduleRemoveTarget='';
let scheduleSort='order',scheduleCategoryFilter='',scheduleSearch='';
 let transactionDetail=null,detailReturnFocus=null,detailOriginTab=null,detailParentSchedule=null,planStopPending='';
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
   scheduleCategories:p.scheduleCategories,
   futureRecurrenceExclusions:p.futureRecurrenceExclusions,mortgageReviewDismissals:p.mortgageReviewDismissals,historyPatternDecisions:p.historyPatternDecisions,
    mortgageCoverageRules:p.mortgageCoverageRules,coverageAssignments:p.coverageAssignments}));
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
  window.HouseholdPlannerTransactions,window.HouseholdPaymentObligations,horizon);
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
  '<div class="metric"><span>'+(credit?'Lowest debt · next 3 years':'Lowest balance · next 3 years')+'</span>'+
   '<strong class="'+(below?'low':'')+'">'+(fresh?cash(lowest):'Unverified')+'</strong>'+
   '<small>'+(fresh&&lowDate?escapeHTML(dayLabel(lowDate)):'Confirm bank balance first')+'</small></div>'+
  '<div class="metric metric-wide"><span>'+(isCash?'First projected shortfall':'Projected debt · 3-year horizon')+'</span>'+
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
  '<p>No repeating payments currently qualify as confident dated forecasts for this account. Confirm a detected repeat below or add a card payment schedule.</p></div>';
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
function connectionPanel(s){
 const list=activeAccounts(s),real=live(),source=available(),
  count=list.length,
  status=real?
   count+' connected account'+(count===1?'':'s')+
    (s.lastSuccessfulSync?' · last synced '+escapeHTML(new Date(s.lastSuccessfulSync).toLocaleString()):' · sync time unavailable'):
   'Showing sample data. Select Real to work with your connected bank accounts.';
 return '<section class="panel mini-panel" aria-label="Bank connection status">'+
  '<div class="section-title"><h2>Bank connections</h2></div>'+
  '<p>'+status+'</p>'+
  (source?'<a class="btn" href="/bank-connect">Manage connections →</a>':
   '<span class="status-tag warn">Real bank data is not connected</span>')+
  '</section>';
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
   '<div class="card-preview-line"><span>Estimated checking withdrawal</span><strong>'+
    (p.autopayEnabled?cash(p.amount):'None · autopay off')+'</strong></div>'+
   '<div class="card-preview-line"><span>Payment method</span><strong>'+
    escapeHTML(({statement:'Full statement',full:'Full outstanding',minimum:'Minimum',fixed:'Fixed amount'})[p.method]||p.method)+'</strong></div>'+
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
   '<details class="card-scheduled-transactions"><summary>Review '+(p.predictedTransactions||[]).length+
    ' specifically scheduled card transactions in this period</summary>'+
    ((p.predictedTransactions||[]).length?p.predictedTransactions.map(t=>
     '<div class="card-actual-line"><span>'+escapeHTML(dayLabel(t.date))+
      ' · '+escapeHTML(t.merchant)+'</span><strong>'+
      (t.type==='refund'?'−':'')+cash(t.amount)+'</strong></div>').join(''):
     '<p>No future dated card transactions are scheduled for this statement.</p>')+
    '</details>'+
      (p.pendingExcluded?'<p class="card-preview-caveat">'+p.pendingExcluded+
    ' pending card transaction(s) excluded until posted.</p>':'')+
   '<p class="card-preview-caveat">No average historic spending allowance or generic card-spending guess is added to this calculation.</p>'+
      '<p class="card-preview-caveat">'+(p.confirmed?
    'Issued statement amount supplied by you. Actual card purchases are listed separately.':
    'The actual net charges are based on retrieved posted bank transactions. The payment estimate can differ due to prior balances, fees, interest or unplanned future card purchases.')+
   ' Future autopay dates are user-entered plans; actual dates become known when the bank posts the payment.</p>'+
  '</div>').join('')+'</div>';
}
function configureCardFields(form){
 if(!form)return;
 const method=form.querySelector('[name=method]')?.value||'';
 const auto=form.querySelector('[name=autopayEnabled]')?.value||'';
 for(const [selector,show] of [['[data-card-minimum]',method==='minimum'],['[data-card-fixed]',method==='fixed'],
  ['[data-card-funding]',auto==='yes']]){
  const el=form.querySelector(selector);if(!el)continue;
  el.hidden=!show;const input=el.querySelector('input,select');if(input)input.required=show;
 }
}
function priorCardCycles(bundle,cardId){
 const cycles=(bundle?.payments?.historyStatements||[]).filter(x=>String(x.cardId)===String(cardId)).slice(0,6);
 if(!cycles.length)return '<p class="card-preview-caveat">Earlier billing periods will appear as posted card transactions become available.</p>';
 return '<details class="card-history" data-card-history><summary>Previous billing periods ('+cycles.length+')</summary>'+
  '<p class="card-preview-caveat">Reconstructed net card purchases are not issued statement balances. Carried balances, fees, interest and incomplete history may differ.</p>'+
  cycles.map(p=>'<div class="card-preview-line"><span>'+
   escapeHTML(dayLabel(p.periodStart))+' – '+escapeHTML(dayLabel(p.periodEnd))+
   ' · '+p.count+' posted transaction'+(p.count===1?'':'s')+'</span><strong>'+
   (p.count?cash(p.netActivity):'No records · coverage unknown')+(p.issuedBalance!==null?' · Issued '+cash(p.issuedBalance):'')+
   '</strong></div>').join('')+'</details>';
}
function autopayPanel(s,bundle){
 const cards=activeAccounts(s).filter(a=>accountType(a)==='credit'),
  cashAccounts=activeAccounts(s).filter(a=>accountType(a)==='cash'),
  rules=state().predictions?.paymentRules||{};
 const options=value=>cashAccounts.map(a=>'<option value="'+escapeHTML(a.id)+'" '+
  (String(value)===String(a.id)?'selected':'')+'>'+escapeHTML(a.name)+'</option>').join('');
 const forms=cards.map(a=>{
  const v=rules[a.id]||{},configured=Boolean(window.HouseholdPaymentObligations.ready(rules[a.id],a,activeAccounts(s)));
  const auto=rules[a.id]?(v.autopayEnabled===false?'no':'yes'):'',method=String(v.method||'');
  const sel=(a,b)=>a===b?' selected':'';
  const oldClose=v.billingEndDate||v.lastStatementClose||'';
  const oldStart=v.billingStartDate||(oldClose?
   shiftDay(window.HouseholdPaymentObligations.closeFor(
    window.HouseholdPaymentObligations.plus(oldClose,-1).slice(0,7),
    Number(v.closingDay||oldClose.slice(8,10))),1):'');
  const paying=v.fromAccountId||state().predictions?.primaryAccountId||cashAccounts[0]?.id;
  return '<form class="card-rule-form" data-card-rule="'+escapeHTML(a.id)+'">'+
   '<div class="section-title"><h2>'+escapeHTML(a.name)+'</h2>'+
    badge({label:configured?(v.autopayEnabled===false?'STATEMENT ONLY':'PAYMENT PLANNED'):'SETUP REQUIRED',
     css:configured?'good':'warn'})+'</div>'+
   '<p class="lead">Required before predictions: a full statement period, due date, expected payment date, autopay status and payment method. Select the paying account if autopay is enabled. Actual bank records stay read-only.</p>'+
   '<div class="card-fields">'+
   '<label>Billing period starts<input name="billingStartDate" type="date" value="'+escapeHTML(oldStart)+'" required></label>'+
   '<label>Billing period ends / statement closes<input name="billingEndDate" type="date" value="'+escapeHTML(oldClose)+'" required></label>'+
   '<label>Statement payment due date<input name="nextDueDate" type="date" value="'+escapeHTML(v.nextDueDate||v.nextPaymentDate||'')+'" required></label>'+
   '<label>Planned autopay withdrawal date (until bank posts it)<input name="nextPaymentDate" type="date" value="'+escapeHTML(v.nextPaymentDate||'')+'" required></label>'+
   '<label>Does this card autopay?<select name="autopayEnabled" required>'+
    '<option value="">Choose yes or no</option>'+
    '<option value="yes"'+sel('yes',auto)+'>Yes · predict the withdrawal</option>'+
    '<option value="no"'+sel('no',auto)+'>No · statement preview only</option></select></label>'+
   '<label>Payment amount method<select name="method" required>'+
    '<option value="">Choose method</option>'+
    '<option value="statement"'+sel('statement',method)+'>Full statement balance</option>'+
    '<option value="full"'+sel('full',method)+'>Full outstanding card balance</option>'+
    '<option value="minimum"'+sel('minimum',method)+'>Minimum payment</option>'+
    '<option value="fixed"'+sel('fixed',method)+'>Fixed dollar amount</option></select></label>'+
   '<label data-card-funding hidden>Paying account<select name="fromAccountId"><option value="">Choose paying account</option>'+options(v.fromAccountId||'')+'</select></label>'+
   '<label data-card-minimum hidden>Minimum payment ($)<input name="minimumAmount" type="number" min=".01" step=".01" value="'+escapeHTML(v.minimumAmount||'')+'"></label>'+
   '<label data-card-fixed hidden>Fixed payment ($)<input name="fixedAmount" type="number" min=".01" step=".01" value="'+escapeHTML(v.fixedAmount||'')+'"></label>'+
   '<label>Issued statement balance (optional, $)<input name="lastStatementBalance" type="number" min="0" step=".01" value="'+escapeHTML(v.lastStatementBalance??'')+'" placeholder="Calculated automatically"></label>'+
   '</div>'+
   cardStatementPreview(s,bundle,a.id)+priorCardCycles(bundle,a.id)+
   '<div class="card-form-actions"><button type="submit" class="btn primary">'+
    (configured?'Update billing cycle':'Save billing cycle')+'</button>'+
    (configured?'<button type="button" class="btn" data-remove-card-rule="'+escapeHTML(a.id)+'">Remove schedule</button>':'')+
    '<span class="status-tag">FORECAST ONLY · NO BANK PAYMENT INITIATED</span></div></form>';
 }).join('');
 const missing=cards.filter(a=>!window.HouseholdPaymentObligations.ready(rules[a.id],a,activeAccounts(s)));
 return '<details class="panel planner-settings" id="card-autopay"'+(missing.length?' open':'')+'><summary>Credit-card statements & autopay '+
  '<span class="status-tag '+(missing.length?'warn':'good')+'">'+
   (cards.length?missing.length+' NEED SETUP':'CONNECT A CARD')+'</span></summary>'+
  '<p class="lead">A connected card shows actual bank balances and history immediately, but future card activity is excluded until setup is complete. Card payments are a single linked transfer, not an additional purchase.</p>'+
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
   source:p.origin||p.source||null,amountEstimate:p.amountEstimate||null,
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
   amountEstimate:e.amountEstimate||null,
   recurringRuleId:e.recurringRuleId||null,
   sourceAccountId:String(e.sourceAccountId||e.accountId||''),
   sourceMerchant:e.sourceMerchant||e.merchant,
   sourceType:e.sourceType||e.type,source:e.source||null,
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
// Select posted bank examples to teach one forecast which Plaid payee names
// belong to it. Amounts may vary. All selection stays in forecast settings.
function historyLinkField(selected=[]){
 return '<details class="future-examples future-history-link" data-history-link open>'+
  '<summary>Link related actual transactions (optional)</summary>'+
  '<p class="audit-footnote">Choose previous deposits or bills that belong to THIS schedule, even if the amount or bank description differs. This prevents duplicate predictions. The app never changes the posted transactions.</p>'+
  '<label>Search bank description<input type="search" data-history-link-search placeholder="Search payroll, utility company, or payee"></label>'+
  '<div data-history-link-results></div>'+
  '</details>';
}
function checkedHistoryIds(form){
 try{return new Set(JSON.parse(form?.dataset?.linkedExampleIds||'[]'))}catch{return new Set()}
}
function linkedHistoryIds(form){return [...checkedHistoryIds(form)]}
function updateHistoryLinks(form){
 const wrapper=form?.querySelector('[data-history-link]');if(!wrapper||wrapper.hidden)return;
 const accounts=activeAccounts(snapshot()),tools=window.HouseholdPlannerTransactions,
  search=String(wrapper.querySelector('[data-history-link-search]')?.value||'').trim(),
  transfer=form.querySelector('[name=type]')?.value==='transfer',
  accountId=String(form.querySelector('[name='+ (transfer?'fromAccountId':'accountId')+']')?.value||''),
  merchant=form.querySelector('[name=merchant]')?.value||'',
  kind=transfer?'movement':'event',type=transfer?'transfer':form.querySelector('[name=type]')?.value||'expense',
  chosen=checkedHistoryIds(form),matches=tools.findExamples(model.records(state()),
   {kind,accountId,fromAccountId:accountId,type,merchant},accounts,search),
  shown=new Map([...matches].map(t=>[String(t.id),t])),
  original=model.records(state());
 // Don't discard user-selected aliases when searching for more bank names.
 for(const id of chosen){
  if(!shown.has(id)){
   const row=original.find(t=>String(t.id)===id);
   if(row)shown.set(id,{id:String(row.id),date:row.date,merchant:row.merchant,
    amount:row.amount,accountId,type:row.type});
  }
 }
 const holder=wrapper.querySelector('[data-history-link-results]');
 holder.innerHTML='<p class="audit-footnote">'+chosen.size+
  ' bank transaction'+(chosen.size===1?'':'s')+' linked · '+
  matches.length+' possible match'+(matches.length===1?'':'es')+
  ' · select only entries for this payment</p>'+
  ([...shown.values()].map(t=>'<label class="future-history-choice"><input type="checkbox" name="examples" data-history-example value="'+escapeHTML(t.id)+'"'+
   (chosen.has(String(t.id))?' checked':'')+'> '+
   escapeHTML(dayLabel(t.date))+' · '+escapeHTML(t.merchant)+
   ' · '+cash(t.amount)+'</label>').join('')||
   '<p class="audit-footnote">No matching posted bank transactions. Try a different payee search, or save without linking.</p>');
}
function editorFor(row,s,records,opts={}){
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
 const scope=opts.oneOnly?
  '<fieldset class="future-scope plan-single-scope"><legend>Change affects</legend>'+
   '<label><input type="radio" name="scope" value="one" checked> Only this payment</label>'+
   '<p>Changing or skipping this payment does not change the schedule or any other date. '+
   'To change every future payment, edit Schedule settings above.</p></fieldset>':
  '<fieldset class="future-scope"><legend>Apply changes to</legend>'+
  '<label><input type="radio" name="scope" value="one" checked> This payment only</label>'+
  '<label><input type="radio" name="scope" value="all"> This and future payments</label>'+
  '<p>For a repeating payment, choose all future to create or change its schedule. '+
   'Only this payment keeps all other dates unchanged.</p></fieldset>'+
  '<div class="future-repeat-fields" hidden>'+
   '<div class="future-fields"><label>Repeat frequency'+frequencyChoices(cadence)+'</label>'+
   '<label class="future-second-day"'+(cadence==='twice-monthly'?'':' hidden')+'>Second day of month (1–31)'+
    '<input type="number" name="secondDay" min="1" max="31" value="'+escapeHTML(selectedRule?.secondDay||15)+'"></label></div>'+
   historyLinkField()+
  '</div>';
 return '<form class="future-edit-form" data-future-edit-form="'+escapeHTML(row.key)+'">'+keys+
  scope+
  '<div class="future-fields">'+fields+'</div>'+
  '<p class="audit-footnote">'+(opts.oneOnly?
    'You are editing one date within this payment plan. The repeating rule stays unchanged. ':
    'You are editing a forecast, not a posted bank transaction. ')+
   (isMovement?'Both linked accounts update together. ':'')+
   'Actual bank transactions are never changed.</p>'+
  '<div class="future-form-actions"><button class="btn primary" type="submit">Save changes</button>'+
   '<button class="btn" type="button" data-cancel-future>Cancel</button>'+
   (row.addedId?'<button class="btn" type="button" data-remove-added="'+escapeHTML(row.addedId)+'">Remove</button>':
    '<button class="btn" type="button" data-skip-future="'+escapeHTML(row.key)+'">Skip this occurrence</button>')+
   '<button class="btn" type="button" data-restore-future="'+escapeHTML(row.key)+'">Reset this occurrence</button>'+
   (currentSeries?'<button class="btn" type="button" data-reset-series="'+escapeHTML(row.seriesKey)+'">Reset all future changes</button>':'')+
   ((row.seriesKey||selectedRule)&&!(row.seriesKey||'').startsWith('autopay|')?
    '<button class="btn" type="button" data-remove-recurring="'+escapeHTML(row.key)+'">'+
     (row.type==='income'&&!row.recurringRuleId?'Remove inferred series':'Not recurring')+'</button>':'')+
   '</div></form>';
}

/*
 * ONE transaction detail surface for calendar, Predictions, bank history,
 * and saved schedules. Never copy a projected transaction into a second
 * editable state: every route resolves the canonical ledger identity.
 */
function detailShell(title,subtitle,body,status){
 return '<div class="transaction-overlay" data-transaction-overlay>'+
  '<button type="button" class="transaction-overlay-backdrop" data-close-transaction-detail aria-label="Close details"></button>'+
  '<section class="transaction-detail" role="dialog" aria-modal="true" aria-label="'+escapeHTML(title)+'">'+
  '<header class="transaction-detail-head"><div><small>'+escapeHTML(status)+'</small>'+
  '<h2>'+escapeHTML(title)+'</h2><p>'+escapeHTML(subtitle)+'</p></div>'+
  '<button type="button" class="transaction-detail-close" data-close-transaction-detail aria-label="Close transaction details">×</button></header>'+
  '<div class="transaction-detail-body">'+body+'</div></section></div>';
}
function relatedCardCalculation(bundle,row){
 if(row.kind!=='movement')return '';
 const detail=(bundle?.payments?.paymentDetails||[]).find(p=>String(p.id)===String(row.id));
 if(!detail)return '';
 const actual=detail.postedTransactions||[],scheduled=detail.predictedTransactions||[],
  net=arr=>Math.round(arr.reduce((n,t)=>n+(t.type==='refund'?-1:1)*Number(t.amount),0)*100)/100,
  entry=t=>'<div class="transaction-evidence-item"><span>'+
   escapeHTML(dayLabel(t.date))+' · '+escapeHTML(t.merchant||'Card transaction')+
   (t.type==='refund'?' · refund':'')+'</span><strong>'+
   (t.type==='refund'?'−':'')+cash(t.amount)+'</strong></div>';
 return '<details class="transaction-evidence" open><summary>What makes up this card payment?</summary>'+
  '<p>'+escapeHTML(detail.periodSource==='configured-statement'?'Statement period':'Activity window; issuer closing date is unconfirmed')+
   ': '+escapeHTML(dayLabel(detail.periodStart))+' – '+escapeHTML(dayLabel(detail.periodEnd))+'</p>'+
  '<div class="transaction-evidence-group"><strong>Actual posted card transactions</strong><strong>'+cash(net(actual))+'</strong></div>'+
  (actual.length?actual.map(entry).join(''):'<p>No posted purchases or refunds found.</p>')+
  '<div class="transaction-evidence-group"><strong>Scheduled/recurring card transactions</strong><strong>'+cash(net(scheduled))+'</strong></div>'+
  (scheduled.length?scheduled.map(entry).join(''):'<p>No additional dated card charges forecast in this period.</p>')+
  '<div class="transaction-evidence-total"><span>Identifiable activity</span><strong>'+cash(net(actual)+net(scheduled))+'</strong></div>'+
  (Math.abs(Number(row.amount)-(net(actual)+net(scheduled)))>.011?
   '<p>Actual payment estimate differs from transaction total because of '+(detail.confirmed?
   'the separately confirmed issuer statement amount.':'the selected payment method, current card balance or a payment override.')+
   ' The forecast uses '+cash(row.amount)+'.</p>':'')+
  '<p>No historical-average spending allowance or synthetic purchases are added.</p></details>';
}
// The live forecast, not unedited schedule defaults, owns each occurrence:
 // edited dates/amounts and skipped payments are reflected here exactly.
// The same forecast row component is rendered in Calendar, Schedules, Reviews
// and advanced Predictions. All buttons resolve the same canonical ledger key.
function editableForecastRow(row,opts={}){
 const isTransfer=row.kind==='movement',inbound=row.type==='income'||row.type==='refund';
 const kindLabel=isTransfer?'Linked transfer':row.type==='income'?'Deposit':
  row.type==='refund'?'Refund':'Withdrawal / purchase';
 const subtitle=kindLabel+' · '+(isTransfer?row.from+' → '+row.to:row.account||'Account')+
  (row.recurringRuleId?' · Repeats':row.seriesKey?' · Auto-detected':' · One time');
 return '<div class="unified-payment-row'+(opts.kind==='schedule'?' schedule-occurrence-entry':'')+
  '" data-inline-row-wrapper data-payment-key="'+escapeHTML(row.key)+'">'+
  '<button type="button" class="unified-payment-trigger" '+
   (opts.advanced?'data-edit-future="'+escapeHTML(row.key)+'" ':'')+
   'data-open-transaction="'+escapeHTML(row.key)+
  '" aria-expanded="false"'+(opts.kind==='schedule'?' data-schedule-occurrence-key="'+escapeHTML(row.key)+'"':'')+'>'+
  '<span class="unified-payment-date future-date">'+escapeHTML(dayLabel(row.date))+'</span>'+
  '<span class="unified-payment-name"><strong>'+escapeHTML(row.merchant)+'</strong>'+
   '<small>'+escapeHTML(subtitle)+'</small></span>'+
  '<span class="unified-payment-value future-amount'+(inbound?' incoming':'')+'">'+
   (inbound?'+':'−')+cash(row.amount)+'</span>'+
  '<span class="unified-payment-chevron" aria-hidden="true">⌄</span></button></div>';
}
function scheduleOccurrencesHtml(bundle,s,rule){
 if(!rule)return '';
 const occurrences=futureRows(bundle,s).filter(r=>String(r.recurringRuleId||'')===String(rule.id));
 return '<section class="schedule-occurrence-section" aria-label="Upcoming payments">'+
  '<div class="schedule-occurrence-heading"><h3>Upcoming payments</h3><span>'+
   occurrences.length+' in next '+horizon+' days</span></div>'+
  '<p>Click a payment to edit its actual date, amount or account. Save applies only to that occurrence; other dates stay unchanged.</p>'+
  (occurrences.length?'<div class="unified-payment-list">'+occurrences.map(r=>editableForecastRow(r,{kind:'schedule'})).join('')+'</div>':
   '<p class="schedule-occurrence-empty">No future payments in this forecast window. Payments may have posted, been skipped, or be beyond the selected period.</p>')+
  '</section>';
}

function detailHtml(bundle,s){
 if(!transactionDetail)return '';
 if(transactionDetail.kind==='prediction'){
  const row=futureRows(bundle,s).find(r=>r.key===transactionDetail.key);
  if(!row)return detailShell('Prediction unavailable','It may have posted, been skipped, or changed. Close and refresh.',
   '<p class="transaction-detail-help">Nothing has been changed in your bank or forecast.</p>','NOT FOUND');
  const linked=row.kind==='movement';
  const account=linked?row.from+' → '+row.to:row.account;
  const rule=(state().predictions?.futureRecurringRules||[]).find(r=>r.id===row.recurringRuleId);
  const source=rule?'Confirmed schedule':
   row.seriesKey?'Recurring forecast':row.addedId?'Manually added':
   row.source||'Predicted from available information';
  const impact='<div class="transaction-detail-info">'+
   '<div><span>Date</span><strong>'+escapeHTML(dayLabel(row.date))+'</strong></div>'+
   '<div><span>Account'+(linked?'s':'')+'</span><strong>'+escapeHTML(account)+'</strong></div>'+
   '<div><span>Forecast source</span><strong>'+escapeHTML(source)+'</strong></div>'+
   '<div><span>Expected amount</span><strong>'+cash(row.amount)+'</strong></div></div>'+
   '<p class="transaction-edit-impact" data-edit-impact>'+
   'This payment only: only this occurrence will change. Future scheduled payments stay as they are.</p>';
  // Standalone or automatically inferred predictions have no confirmed rule
  // yet; the SAME plan panel permits a one-time edit or creation of a rule.
  return detailShell(row.merchant,
   (row.seriesKey?'Detected repeating plan':'One-time payment plan')+
   ' · '+cash(row.amount)+' · '+escapeHTML(dayLabel(row.date)),
   impact+relatedCardCalculation(bundle,row)+editorFor(row,s,bundle?.rows||[]),
   row.seriesKey?'REPEATING · NOT YET CONFIRMED':'ONE-TIME PLAN · FORECAST');
 }
 if(transactionDetail.kind==='actual'){
  const row=(bundle?.rows||lastHistoryRows).find(t=>String(t.id)===String(transactionDetail.id)&&
   window.HouseholdPlannerHistory.accountOf(t,activeAccounts(s))===transactionDetail.account);
  if(!row)return detailShell('Bank transaction unavailable','This bank record could not be found.',
   '<p>No changes were made.</p>','BANK HISTORY');
  const account=activeAccounts(s).find(a=>String(a.id)===transactionDetail.account);
  const summary='<div class="transaction-detail-info">'+
   '<div><span>Bank date</span><strong>'+escapeHTML(dayLabel(row.date))+'</strong></div>'+
   '<div><span>Account</span><strong>'+escapeHTML(account?.name||transactionDetail.account)+'</strong></div>'+
   '<div><span>Bank amount</span><strong>'+cash(row.amount)+'</strong></div>'+
   '<div><span>Bank record</span><strong>'+escapeHTML(row.pending?'Pending':'Posted')+'</strong></div></div>'+
   '<p class="transaction-detail-help">This is an actual bank record. Its amount, date and classification are read-only. To predict future occurrences, save a separate schedule below.</p>';
  return detailShell(row.merchant||'Bank transaction',
   'Bank history · '+cash(row.amount)+' · '+escapeHTML(dayLabel(row.date)),
   summary+(recurringDraft?repeatingReviewForm(s):'<p>Unable to create a schedule from this transaction.</p>'),
   'ACTUAL · BANK-RECORDED');
 }
 if(transactionDetail.kind==='history-choice'){
  const ids=transactionDetail.ids||[],
   rules=(state().predictions?.futureRecurringRules||[]).filter(r=>ids.includes(r.id)),
   options=rules.map(r=>'<button type="button" class="btn" data-choose-history-schedule="'+
    escapeHTML(r.id)+'">#'+scheduleListNumber(r.id)+' · '+
    escapeHTML(r.scheduleLabel||r.merchant||'Scheduled payment')+
    ' · '+escapeHTML(r.frequency||'Recurring')+' · '+cash(r.amount)+'</button>').join(' ');
  return detailShell('Choose the existing schedule',
   'This posted payment may belong to more than one confirmed schedule.',
   '<p class="transaction-detail-help">No new schedule will be created. Choose which existing plan to inspect; similar payees and alternating income are kept separate.</p>'+
   (options||'<p>Those schedules changed. Refresh the bank history.</p>'),
   'BANK HISTORY · SCHEDULE MATCH');
 }
 if(transactionDetail.kind==='schedule'){
  const rule=(state().predictions?.futureRecurringRules||[]).find(r=>r.id===transactionDetail.id);
  const isNew=transactionDetail.mode==='new',picked=transactionDetail.selectedKey||'';
  const edit=document.querySelector(isNew?'[data-schedule-new-form]':'[data-schedule-edit-form]');
  const editHtml=edit?.outerHTML||'<p>Schedule details are temporarily unavailable. Close and reopen the plan.</p>';
  edit?.remove();
  const account=rule?activeAccounts(s).find(a=>String(a.id)===String(rule.accountId||rule.fromAccountId)):null;
  const info=!isNew&&rule?'<div class="plan-summary">'+
   '<div><small>Repeats</small><strong>'+escapeHTML(rule.frequency||'Recurring')+'</strong></div>'+
   '<div><small>Default amount</small><strong>'+cash(rule.amount)+'</strong></div>'+
   '<div><small>Account</small><strong>'+escapeHTML(account?.name||rule.accountId||rule.fromAccountId||'Account')+'</strong></div>'+
   '<div><small>Payee</small><strong>'+escapeHTML(rule.merchant||'')+'</strong></div></div>':'';
  const notice=scheduleNotice?'<p class="plan-save-confirmation" role="status">'+
   escapeHTML(scheduleNotice)+'</p>':'';
  const settings='<details class="plan-settings" data-plan-settings'+(isNew||!picked&&transactionDetail.mode!=='estimate'?' open':'')+'>'+
   '<summary><span>Schedule settings</span><small>Default dates, amount, account and repeat frequency</small></summary>'+
   '<div class="plan-settings-body"><p>Saving these settings updates the repeating plan. '+
    'Changes to one dated payment belong in the payment list below.</p>'+editHtml+'</div></details>';
  const stopable=!isNew&&rule?futureRows(bundle,s).find(r=>r.recurringRuleId===rule.id):null;
  const stopPlan=stopable?'<div class="plan-stop"><span>Need this payment to stop repeating? '+
   'Bank history and other unrelated plans remain unchanged.</span>'+
   '<button type="button" class="btn" data-stop-plan="'+escapeHTML(rule.id)+'">'+
   (planStopPending===rule.id?'Confirm stop repeating':'Stop repeating')+'</button></div>':'';
  // Legacy date-range estimates remain honored by the forecast engine, but
  // the editor only offers one payment or the entire repeating schedule.
  return detailShell(isNew?'New payment plan':(scheduleListNumber(rule?.id)?
   'Schedule '+scheduleListNumber(rule.id)+' · ':'')+
   (rule?.scheduleLabel||rule?.merchant||'Payment plan'),
   isNew?'Create a separate, repeating payment plan':
    picked?'One plan · editing a single scheduled payment':
    'One plan · edit the repeating rule or a specific payment below',
   notice+'<p class="transaction-detail-help">'+(isNew?
    'Creating a plan generates future payments. You can modify each payment afterward.':
    'The schedule is the starting point. Specific payments can have their own exceptions. '+
    'All changes affect forecasts only; actual bank transactions remain read-only.')+'</p>'+
    info+(picked?'<div class="plan-selected-guide"><strong>One payment selected.</strong>'+
     ' This change will not update the other occurrences.</div>':'')+
    // Keep selected payment visible near the top, not in a second modal.
    (isNew?'':scheduleOccurrencesHtml(bundle,s,rule,picked))+
    settings+stopPlan,
   isNew?'NEW PLAN · FORECAST ONLY':'PAYMENT PLAN · EDITABLE');
 }
 return '';
}
function drawTransactionDetail(bundle,s){
 const root=$('planner-main');
 if(!transactionDetail||!root||typeof root.insertAdjacentHTML!=='function')return;
 const prior=root.querySelector('[data-transaction-overlay]');
 if(prior&&typeof prior.remove==='function')prior.remove();
 root.insertAdjacentHTML('beforeend',detailHtml(bundle,s));
 const form=root.querySelector('.transaction-overlay form[data-history-recurring-form]');
 if(form&&recurringDraft?.examples){
  form.dataset.linkedExampleIds=JSON.stringify(recurringDraft.examples);
  updateHistoryLinks(form);
 }
}
function inlineDraftChanged(){
 const editor=document.querySelector('[data-inline-transaction-editor]');
 if(!editor)return false;
 return [...editor.querySelectorAll('form')].some(form=>{
  const initial=form.dataset.initialValues;
  return initial!==undefined&&initial!==JSON.stringify([...new FormData(form)]);
 });
}
function closeInlineTransaction(force=false){
 if(!force&&inlineDraftChanged()&&typeof window.confirm==='function'&&
   !window.confirm('Discard unsaved changes to this payment?'))return false;
 document.querySelectorAll('[data-inline-transaction-editor]').forEach(el=>el.remove());
 document.querySelectorAll('[data-inline-row-wrapper] [data-open-transaction]').forEach(el=>{
  el.setAttribute('aria-expanded','false');
 });
 return true;
}
function confirmInlineSave(key,message){
 const rows=[...document.querySelectorAll('[data-inline-row-wrapper]')];
 const row=rows.find(el=>el.dataset.paymentKey===key||
  el.querySelector('[data-open-transaction]')?.dataset.openTransaction===key);
 const target=row||document.querySelector('#planner-main .planner-page');
 if(!target)return;
 target.insertAdjacentHTML(row?'beforeend':'afterbegin',
  '<p class="inline-save-result" role="status">'+escapeHTML(message)+'</p>');
}
function openInlineTransaction(button){
 const wrapper=button?.closest?.('[data-inline-row-wrapper]');
 if(!wrapper)return false;
 const existing=wrapper.querySelector('[data-inline-transaction-editor]');
 if(existing){closeInlineTransaction();return true}
 const focused=button.dataset.openTransaction;
 const s=snapshot(),bundle=forecastFor(s),
  row=futureRows(bundle,s).find(r=>r.key===focused);
 if(!row){setNotice('That forecast has changed. Refresh the calendar and select the updated payment.');return true}
 if(!closeInlineTransaction())return true;
 const rule=(state().predictions?.futureRecurringRules||[]).find(r=>r.id===row.recurringRuleId);
 const nearby=rule?futureRows(bundle,s).filter(r=>r.recurringRuleId===rule.id&&r.date>=row.date).length:0;
 const helper='<p class="inline-editor-explanation" data-edit-impact>'+
  (rule?'Change this date only, or choose all future to update the repeating plan ('+nearby+
   ' upcoming payments in your forecast).':
   row.seriesKey?'Update one payment, or confirm changes for later recurring payments.':
   'Edit these values here. Actual posted bank records remain read-only.')+'</p>';
 const settings=rule?'<details class="inline-plan-settings">'+
  '<summary>Edit repeating plan defaults <small>affects other scheduled dates</small></summary>'+
  '<form class="schedule-form" data-schedule-edit-form="'+escapeHTML(rule.id)+'">'+
   scheduleFields({...rule,date:window.HouseholdPlannerTransactions.recurrenceDates(rule,s.asOf,
    shiftDay(s.asOf,horizon))[0]||shiftDay(s.asOf,1)},false,s)+
   '<div class="future-form-actions"><button class="btn primary" type="submit">Save repeating plan</button>'+
   '<button class="btn" type="button" data-cancel-inline-schedule>Cancel</button></div></form></details>':'';
 const html='<div class="inline-transaction-editor" data-inline-transaction-editor>'+
  helper+relatedCardCalculation(bundle,row)+
  editorFor(row,s,bundle?.rows||[])+settings+'</div>';
 wrapper.insertAdjacentHTML('beforeend',html);
 button.setAttribute('aria-expanded','true');
 wrapper.querySelectorAll('[data-inline-transaction-editor] form').forEach(form=>{
  form.dataset.initialValues=JSON.stringify([...new FormData(form)]);
 });
 wrapper.querySelector('[data-inline-transaction-editor] [name=amount]')?.focus({preventScroll:true});
 return true;
}
function openSchedulePlan(id,selectedKey='',origin=null,mode='edit'){
 const rule=(state().predictions?.futureRecurringRules||[]).find(r=>r.id===id);
 if(!rule)return false;
 detailReturnFocus=origin||null;
 if(activeTab!=='schedules'){
  if(!detailOriginTab)detailOriginTab=activeTab;
  activeTab='schedules';
 }
 scheduleMode=mode;scheduleTarget=id;detailParentSchedule=null;
 transactionDetail={kind:'schedule',id,mode,selectedKey:String(selectedKey||'')};
 render();
 document.querySelector('.transaction-detail-close')?.focus();
 return true;
}
function openPrediction(key,origin){
 const current=transactionDetail?.kind==='schedule'?transactionDetail:null;
 const s=snapshot(),bundle=forecastFor(s),
  row=futureRows(bundle,s).find(r=>r.key===String(key));
 if(row?.recurringRuleId&&openSchedulePlan(row.recurringRuleId,row.key,origin))return;
 // Unconfirmed or one-time forecasts use this same plan shell, but do not
 // claim to have a saved repeating rule.
 if(current)detailParentSchedule={...current};
 else detailParentSchedule=null;
 detailReturnFocus=origin||null;
 transactionDetail={kind:'prediction',key:String(key)};
 try{drawTransactionDetail(bundle,s)}
 catch(err){transactionDetail=null;setNotice(String(err.message||err));return}
 document.querySelector('.transaction-detail-close')?.focus();
}
function restoreScheduleAfterOccurrence(){
 if(transactionDetail?.kind==='schedule'&&transactionDetail.selectedKey){
  transactionDetail.selectedKey='';
  return;
 }
 if(detailParentSchedule){
  const parent=detailParentSchedule;detailParentSchedule=null;
  if((state().predictions?.futureRecurringRules||[]).some(r=>r.id===parent.id)){
   transactionDetail=parent;return;
  }
 }
 transactionDetail=null;
}
function dismissTransaction(){
 planStopPending='';
 const mode=transactionDetail?.kind;
 if(mode==='schedule'&&transactionDetail.selectedKey){
  transactionDetail.selectedKey='';render();
  return;
 }
 if(mode==='prediction'&&detailParentSchedule){
  restoreScheduleAfterOccurrence();
  detailReturnFocus=null;render();return;
 }
 transactionDetail=null;detailParentSchedule=null;
 if(mode==='schedule'){
  scheduleMode='';scheduleTarget='';schedulePreset=null;
  if(detailOriginTab){activeTab=detailOriginTab;detailOriginTab=null;}
  render();
 }else document.querySelector('[data-transaction-overlay]')?.remove();
 if(detailReturnFocus?.isConnected)detailReturnFocus.focus();
 detailReturnFocus=null;
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
  '</div><label class="schedule-separate-choice"><input type="checkbox" name="separateSchedule"> This is an additional independent bill or paycheck, even from the same merchant</label><p class="audit-footnote">'+(preset?'Verify the proposed next due date against your mortgage documents. ': '')+
   'For alternating biweekly paychecks, make two independent Every 4 weeks deposits, with their start dates 14 days apart. Link each to its own past paychecks below.</p>'+
  '<div class="future-history-container" data-new-history-link hidden>'+historyLinkField()+'</div>'+
  '<div class="future-form-actions"><button class="btn primary" type="submit">Add to forecast</button>'+
  '<button class="btn" type="button" data-cancel-new>Cancel</button></div></form>';
}

function scheduleFields(r,isNew,s){
  const accounts=activeAccounts(s),tomorrow=shiftDay(s.asOf,1);
  const type=r.kind==='movement'?'transfer':r.type||'expense',transfer=isNew&&type==='transfer'||r.kind==='movement',
   accountId=r.accountId||r.fromAccountId||selected(s)?.id||accounts[0]?.id;
  return '<div class="future-fields">'+
   '<label>Bill label (distinguishes same-payee bills)<input name="scheduleLabel" maxlength="110" placeholder="e.g. Water — House" value="'+escapeHTML(r.scheduleLabel||'')+'"></label>'+
   '<label>Bank merchant<input name="merchant" maxlength="160" required value="'+escapeHTML(r.merchant||'')+'"></label>'+
   '<label>Category<select name="category">'+
    window.HouseholdPlannerTransactions.scheduleCategories(state()).map(c=>
     '<option value="'+escapeHTML(c)+'"'+(c===(r.category||'Uncategorized')?' selected':'')+'>'+
      escapeHTML(c)+'</option>').join('')+'</select></label>'+
   '<label>Expected amount ($)<input name="amount" type="number" min=".01" max="999999999" step=".01" required value="'+escapeHTML(r.amount??'')+'"></label>'+
   '<label>Next date<input name="date" type="date" min="'+tomorrow+'" max="'+escapeHTML(shiftDay(s.asOf,horizon))+'" required value="'+escapeHTML(r.date||tomorrow)+'"></label>'+
   '<label>Repeat'+frequencyChoices(r.frequency||'monthly')+'</label>'+
   '<label>Amount type<select name="amountBasis"><option value="estimate"'+(r.amountBasis==='estimate'?' selected':'')+'>Variable / estimated</option>'+
   '<option value="fixed"'+(r.amountBasis!=='estimate'?' selected':'')+'>Fixed</option></select></label>'+
   (isNew?'<label>Type<select name="type" data-schedule-type>'+
    [['expense','Withdrawal'],['income','Deposit'],['refund','Refund'],['transfer','Linked transfer']].map(([v,name])=>
     '<option value="'+v+'"'+(type===v?' selected':'')+'>'+name+'</option>').join('')+'</select></label>':
    '<input type="hidden" name="type" value="'+escapeHTML(type)+'">')+
   '<label class="schedule-single-account"'+(transfer?' hidden':'')+'>Account'+
    accountSelect(accounts,accountId,'accountId')+'</label>'+
   '<label class="schedule-transfer-account"'+(transfer?'':' hidden')+'>From'+
    accountSelect(accounts,accountId,'fromAccountId')+'</label>'+
   '<label class="schedule-transfer-account"'+(transfer?'':' hidden')+'>To'+
    accountSelect(accounts,r.toAccountId||accounts.find(a=>String(a.id)!==accountId)?.id||accountId,'toAccountId')+'</label>'+
   '<label class="future-second-day"'+(r.frequency==='twice-monthly'?'':' hidden')+
    '>Second day<input type="number" name="secondDay" min="1" max="31" value="'+escapeHTML(r.secondDay||15)+'"></label>'+
   '</div>';
 }
function applyScheduleSearch(root=document){
 // Some non-browser integrations expose a partial DOM. Search is optional:
 // never let its absence interrupt scheduled payment editing or forecasts.
 if(!root||typeof root.querySelector!=='function'||
  typeof root.querySelectorAll!=='function')return;
 const input=root.querySelector('[data-schedule-search]');
 if(!input)return;
 const q=String(scheduleSearch||'').trim().toLowerCase();
 let shown=0;
 for(const row of root.querySelectorAll('[data-schedule-card]')){
  const matches=!q||String(row.dataset.scheduleSearchText||'').includes(q);
  row.hidden=!matches;
  if(matches)shown++;
 }
 for(const group of root.querySelectorAll('[data-schedule-category-group]')){
  const rows=[...group.querySelectorAll('[data-schedule-card]')].filter(row=>!row.hidden);
  group.hidden=rows.length===0;
  const count=group.querySelector('[data-schedule-group-count]'),
   total=group.querySelector('[data-schedule-group-total]'),
   month={out:0,in:0,transfers:0},
   year={out:0,in:0,transfers:0};
  if(count)count.textContent='('+rows.length+')';
  for(const row of rows)
   for(const key of ['out','in','transfers']){
    const suffix=key[0].toUpperCase()+key.slice(1);
    month[key]+=Number(row.dataset['scheduleMonthly'+suffix]||0);
    year[key]+=Number(row.dataset['scheduleYearly'+suffix]||0);
   }
  if(total){
   const asOf=root.querySelector('[data-schedule-as-of]')?.dataset.scheduleAsOf;
   if(asOf){
    const period=scheduleTotalPeriod(asOf);
    total.textContent=period.label+': '+formatScheduleTotals(month);
   }
  }
 }
 const empty=root.querySelector('[data-schedule-search-empty]');
 if(empty)empty.hidden=shown!==0||!q;
}
function scheduleTotalPeriod(asOf){
 const y=Number(asOf.slice(0,4)),m=Number(asOf.slice(5,7));
 const iso=(month,day)=>new Date(Date.UTC(y,month,day)).toISOString().slice(0,10);
 const start=iso(m,1),monthEnd=iso(m+1,0),yearEnd=iso(m+12,0),
  label=new Date(Date.UTC(y,m,1)).toLocaleDateString('en-US',
   {month:'short',year:'numeric',timeZone:'UTC'});
 return {start,monthEnd,yearEnd,label};
}
function schedulePeriodAmounts(rule,bundle,from,to){
 const total={out:0,in:0,transfers:0};
 for(const row of bundle?.ledger||[]){
  if(!(row.date>=from&&row.date<=to)||
   String(row.ruleId||row.recurringRuleId||row.seriesRuleId||'')!==String(rule.id))continue;
  const amount=Math.round(Number(row.amount)*100);
  if(!Number.isFinite(amount)||amount<=0)continue;
  const kind=row.kind==='movement'?'transfers':
   ['income','refund'].includes(row.type)?'in':'out';
  total[kind]+=amount;
 }
 // Sum in cents to avoid floating rounding errors across many deposits.
 return total;
}
function sumScheduleAmounts(items,bundle,from,to){
 const total={out:0,in:0,transfers:0};
 for(const {rule} of items){
  const value=schedulePeriodAmounts(rule,bundle,from,to);
  for(const key of ['out','in','transfers'])total[key]+=value[key];
 }
 return total;
}
function scheduleAmountText(cents,{average=false}={}){
 const amount=cents/(average?1200:100);
 return cash(amount);
}
function formatScheduleTotals(total,{average=false}={}){
 const parts=[];
 if(total.out)parts.push('Out '+scheduleAmountText(total.out,{average}));
 if(total.in)parts.push('In '+scheduleAmountText(total.in,{average}));
 if(total.transfers)parts.push('Transfers '+scheduleAmountText(total.transfers,{average}));
 return parts.join(' · ')||(average?'$0/mo':'$0');
}
function scheduleCategorySummary(items,bundle,period){
 const month=sumScheduleAmounts(items,bundle,period.start,period.monthEnd),
  year=sumScheduleAmounts(items,bundle,period.start,period.yearEnd);
 return period.label+': '+formatScheduleTotals(month);
}
function schedulesPage(bundle,s){
 const accounts=activeAccounts(s),rules=state().predictions?.futureRecurringRules||[],
  T=window.HouseholdPlannerTransactions,end=shiftDay(s.asOf,horizon),
  totalPeriod=scheduleTotalPeriod(s.asOf),tomorrow=shiftDay(s.asOf,1),
  categories=T.scheduleCategories(state()),
  categoryOf=r=>categories.includes(r.category)?r.category:'Uncategorized';
 const indexed=rules.map((rule,index)=>({rule,index}));
 const visible=indexed.filter(({rule})=>!scheduleCategoryFilter||categoryOf(rule)===scheduleCategoryFilter);
 const nextAmount=rule=>{
  const first=T.recurrenceDates(rule,s.asOf,end)[0];
  return first?T.scheduleAmount(rule,first).amount:Number(rule.amount)||0;
 };
 visible.sort((a,b)=>scheduleSort==='value-desc'?
  nextAmount(b.rule)-nextAmount(a.rule)||a.index-b.index:
  scheduleSort==='value-asc'?
   nextAmount(a.rule)-nextAmount(b.rule)||a.index-b.index:
  scheduleSort==='category'?
   categoryOf(a.rule).localeCompare(categoryOf(b.rule))||a.index-b.index:
  a.index-b.index);
 const fields=(r,isNew)=>scheduleFields(r,isNew,s);
 const create=scheduleMode==='new'?'<form class="panel schedule-form" data-schedule-new-form>'+
  '<h3>New schedule</h3>'+
  '<input name="separateSchedule" type="hidden" value="on">'+
  (schedulePreset?.historyExampleId?'<input type="hidden" name="historyExampleId" value="'+escapeHTML(schedulePreset.historyExampleId)+'">':'')+
  fields({...schedulePreset,amountBasis:schedulePreset?.amountBasis||'estimate'},true)+
  '<div class="future-form-actions"><button class="btn primary" type="submit">Create schedule</button>'+
  '<button class="btn" type="button" data-schedule-close>Cancel</button></div></form>':'';
 const cardHtml=({rule:r,index})=>{
  const id=escapeHTML(r.id),planOpen=transactionDetail?.kind==='schedule'&&
   transactionDetail.id===r.id,
   isEditing=(scheduleMode==='edit'||planOpen)&&scheduleTarget===r.id,
   dates=T.recurrenceDates(r,s.asOf,end),next=dates[0],
   estimate=next?T.scheduleAmount(r,next):{amount:r.amount,estimated:r.amountBasis==='estimate'},
   account=accounts.find(a=>String(a.id)===String(r.accountId||r.fromAccountId)),
   wins=Array.isArray(r.amountWindows)?r.amountWindows:[];
  const edit=isEditing?'<form class="schedule-form" data-schedule-edit-form="'+id+'">'+
   fields({...r,date:next||tomorrow},false)+
   '<div class="future-form-actions"><button class="btn primary" type="submit">Save</button>'+
    '<button class="btn" type="button" data-schedule-close>Cancel</button></div></form>':'';
  const windows=wins.map((w,i)=>'<div class="schedule-window"><span>'+
   escapeHTML(w.from)+' to '+escapeHTML(w.through)+' · '+cash(w.amount)+'</span>'+
   '<button class="btn" type="button" data-schedule-remove-estimate="'+id+'" data-estimate-index="'+i+
   '" aria-label="Clear old date-range estimate">Clear old rule</button></div>').join('');
  const number=index+1,title=escapeHTML(r.scheduleLabel||r.merchant),
   pendingRemove=scheduleRemoveTarget===r.id,
   monthly=schedulePeriodAmounts(r,bundle,totalPeriod.start,totalPeriod.monthEnd),
   yearly=schedulePeriodAmounts(r,bundle,totalPeriod.start,totalPeriod.yearEnd),
   searchText=[r.scheduleLabel,r.merchant,categoryOf(r)].filter(Boolean).join(' ').toLowerCase();
  return '<article class="panel schedule-card" data-schedule-card="'+id+
   '" data-schedule-number="'+number+'" data-schedule-search-text="'+escapeHTML(searchText)+
   '" data-schedule-monthly-out="'+monthly.out+'" data-schedule-monthly-in="'+monthly.in+
   '" data-schedule-monthly-transfers="'+monthly.transfers+
   '" data-schedule-yearly-out="'+yearly.out+'" data-schedule-yearly-in="'+yearly.in+
   '" data-schedule-yearly-transfers="'+yearly.transfers+'">'+
   '<div class="schedule-compact-row">'+
   '<button class="schedule-row-main" type="button" data-schedule-edit="'+id+
    '" aria-expanded="'+isEditing+'" aria-label="'+(isEditing?'Close':'Open')+
    ' schedule '+number+': '+title+'">'+
    '<span class="schedule-row-identity"><span class="schedule-number" aria-hidden="true">'+number+
     '</span><span class="schedule-row-title"><strong>'+title+'</strong>'+
     '<small>'+(String(r.scheduleLabel||r.merchant)===String(r.merchant)?'':
      escapeHTML(r.merchant)+' · ')+escapeHTML(account?.name||'Account')+
      ' · '+escapeHTML(r.frequency)+'</small></span></span>'+
    '<span class="schedule-row-next"><small>Next</small><span>'+
     (next?escapeHTML(dayLabel(next)):'Not due')+'</span></span>'+
    '<span class="schedule-row-amount"><strong>'+cash(estimate.amount)+'</strong>'+
     '<small>'+(estimate.estimated?'Estimated':'Fixed')+'</small></span>'+
    '<span class="schedule-row-chevron" aria-hidden="true"><span class="schedule-edit-label">'+
     (isEditing?'Close':'Edit')+' </span>'+(isEditing?'⌃':'⌄')+'</span>'+
   '</button>'+
   '<select class="schedule-row-category" data-schedule-quick-category="'+id+'" '+
    'aria-label="Category for schedule '+number+': '+title+'">'+
    categories.map(category=>'<option value="'+escapeHTML(category)+'"'+
     (category===categoryOf(r)?' selected':'')+'>'+escapeHTML(category)+'</option>').join('')+
   '</select>'+
   '<details class="schedule-more"'+(pendingRemove?' open':'')+'>'+
    '<summary aria-label="More actions for schedule '+number+'" title="More actions">⋯</summary>'+
    '<div class="schedule-more-menu">'+
     '<button type="button" data-schedule-remove="'+id+'"'+
      (pendingRemove?' class="danger"':'')+'>'+
      (pendingRemove?'Confirm remove':'Remove schedule')+'</button>'+
     (pendingRemove?'<button type="button" data-schedule-cancel-remove>Cancel</button>':'')+
    '</div></details></div>'+
   '<div class="schedule-card-detail">'+
   (wins.length?'<details class="schedule-legacy-windows"><summary>'+wins.length+
    ' previously saved amount exception'+(wins.length===1?'':'s')+'</summary>'+
    '<p>Older date-range estimates are still included so your balances do not change unexpectedly. '+
    'You can clear an old rule or change a specific payment below. '+
    'Changing the repeating amount for all future payments will replace these older rules.</p>'+
    windows+'</details>':'')+
   (isEditing?'<div class="schedule-inline-plan" data-schedule-inline-plan="'+id+'">'+
     '<details class="plan-settings" data-plan-settings open><summary><span>Repeating payment defaults</span></summary>'+
      '<div class="plan-settings-body">'+edit+'</div></details>'+
     scheduleOccurrencesHtml(bundle,s,r)+'</div>':'')+'</div></article>';
 };
 const cards=scheduleSort==='category'?
  [...new Set(visible.map(({rule})=>categoryOf(rule)))].map(category=>{
   const items=visible.filter(({rule})=>categoryOf(rule)===category);
   return '<section class="schedule-category-group" data-schedule-category-group="'+escapeHTML(category)+'">'+
    '<div class="schedule-category-heading"><strong>'+escapeHTML(category)+
    ' <small data-schedule-group-count>('+items.length+')</small></strong><span data-schedule-group-total>'+
    scheduleCategorySummary(items,bundle,totalPeriod)+'</span></div>'+
    items.map(cardHtml).join('')+'</section>';
  }).join(''):
  visible.map(cardHtml).join(''); 
 return '<div class="planner-page schedule-page"><div class="page-heading"><div><h2>Schedules</h2>'+
  '<p>Recurring payments and deposits used in your forecast.</p></div>'+
  '<button class="btn primary" type="button" data-schedule-new>+ Schedule</button></div>'+
  (scheduleNotice?'<p class="future-notice" role="status">'+escapeHTML(scheduleNotice)+'</p>':'')+
  '<div class="schedule-toolbar" data-schedule-as-of="'+escapeHTML(s.asOf)+
   '" aria-label="Schedule organization">'+
   '<label class="schedule-search-wrap">Find <input data-schedule-search type="search" '+
    'autocomplete="off" placeholder="Name, merchant, category" value="'+escapeHTML(scheduleSearch)+'"></label>'+
   '<label>Sort <select data-schedule-sort>'+
    [['order','Original order'],['value-desc','Amount: high to low'],
     ['value-asc','Amount: low to high'],['category','Category']].map(([v,l])=>
     '<option value="'+v+'"'+(scheduleSort===v?' selected':'')+'>'+l+'</option>').join('')+
   '</select></label>'+
   '<label>Show <select data-schedule-category-filter><option value="">All categories</option>'+
    categories.map(c=>'<option value="'+escapeHTML(c)+'"'+
     (scheduleCategoryFilter===c?' selected':'')+'>'+escapeHTML(c)+'</option>').join('')+
   '</select></label>'+
   '<details class="schedule-category-manager" data-schedule-category-manager>'+
    '<summary>+ Category</summary>'+
    '<form data-schedule-category-add><label>New category<input name="categoryName" maxlength="40" '+
    'placeholder="e.g. Pet care" required></label>'+
    '<button type="submit" class="btn">Add</button></form>'+
    '<p data-schedule-category-notice role="status"></p></details></div>'+ 
  create+'<div class="schedule-grid">'+
   (cards||'<section class="panel">No schedules match. Change the filter or create a schedule.</section>')+
   '</div><p data-schedule-search-empty hidden class="schedule-search-empty">'+
   'No matching schedules. Try a different search.</p></div>';
}
function transactionsPage(bundle,s){
 const accounts=activeAccounts(s),rows=futureRows(bundle,s),visible=rows.filter(r=>
  transactionFilter==='all'||(r.kind==='movement'?
   r.fromAccountId===transactionFilter||r.toAccountId===transactionFilter:
   r.accountId===transactionFilter));
 const opts=accountSelect(accounts,transactionFilter,'transactionFilter',true);
 const lines=visible.map(row=>'<article class="future-item" data-future-item="'+
  escapeHTML(row.key)+'">'+editableForecastRow(row,{advanced:true})+'</article>').join('');
 const skipped=Object.entries(state().predictions?.futureTransactionEdits||{}).filter(([k,v])=>
  v?.skipped&&(!v.accountId||transactionFilter==='all'||String(v.accountId)===transactionFilter||
   String(v.toAccountId)===transactionFilter));
 const undo=skipped.length?'<details class="details future-skipped"><summary>'+
  skipped.length+' skipped forecast occurrence(s) — restore</summary>'+
  skipped.map(([key,v])=>'<div class="future-skip-line">'+escapeHTML(v.label||'Predicted transaction')+
   ' · '+escapeHTML(v.date||'')+' <button type="button" class="btn" data-restore-future="'+
   escapeHTML(key)+'">Restore</button></div>').join('')+'</details>':'';
 return '<div class="planner-page transactions-page">'+
  '<div class="page-heading"><div><h2>Predictions</h2></div>'+
   '<button type="button" class="btn primary" data-show-new>+ Add transaction</button></div>'+
  '<section class="panel transaction-panel"><div class="future-toolbar"><label>Account '+opts+'</label>'+
   '<span class="status-tag">'+visible.length+' PREDICTED</span></div>'+
   (transactionNotice?'<p class="future-notice" role="status">'+escapeHTML(transactionNotice)+'</p>':'')+
   (showNewTransaction?newTransactionForm(s):'')+
   (lines||'<div class="empty-visual">No predicted transactions for this selection. Add one or choose another account.</div>')+
   undo+
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
   '" max="'+escapeHTML(shiftDay(s.asOf,horizon))+'" required value="'+escapeHTML(date)+'"></label>'+
  '<label>Amount ($)<input name="amount" type="number" min=".01" max="999999999" step=".01" required value="'+
   escapeHTML(d.amount||'')+'"></label>'+
  '<label>Repeat'+frequencyChoices(d.frequency||'monthly')+'</label>'+
  '<label class="future-second-day" hidden>Second day of month (1–31)<input name="secondDay" type="number" min="1" max="31" value="15"></label>'+
  '</div>'+
  historyLinkField(d.examples||[])+
  '<label class="schedule-separate-choice"><input type="checkbox" name="separateSchedule"> Create a separate bill even if another schedule shares this payee/date</label>'+
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
  const tools=window.HouseholdPlannerTransactions,
   matches=tools.historicalScheduleMatches(t,accounts,savedRules),
   linked=matches.length===1,ambiguous=matches.length>1;
  const kind=t.type==='transfer'&&!t.pairedTransactionId?
   (t.cashDirection==='out'?'expense':t.cashDirection==='in'?'income':'transfer'):t.type;
  const rejectedKey=tools.recurrenceKey(aid,kind,t.merchant);
  const rejected=Boolean(state().predictions?.futureRecurrenceExclusions?.[rejectedKey]);
  const predicted=futureRows(bundle,s).some(r=>r.kind==='event'&&
   String(r.sourceAccountId||r.accountId)===aid&&r.sourceType===kind&&
   tools.recurrenceKey(aid,kind,r.sourceMerchant)===rejectedKey&&r.seriesKey);
  // Opening the bank row already offers schedule creation/editing.
  // Keep only the exceptional automatic-prediction toggle visible.
  const action='<div class="history-row-actions">'+
   (rejected?'<button class="btn" type="button" data-restore-recurrence="'+escapeHTML(rejectedKey)+
    '" title="Undo Not recurring and permit automatic suggestions">Undo “Not recurring”</button>':
    !matches.length&&predicted?
    '<button class="btn" type="button" data-stop-history-recurrence="'+escapeHTML(String(t.id))+
    '" data-history-account="'+escapeHTML(aid)+'" title="Stop automatic predictions for this merchant">Mark not recurring</button>':
    '<span class="history-row-hint">View details ›</span>')+'</div>';
  return '<div class="history-actual-row" role="button" tabindex="0" aria-label="View bank transaction: '+
   escapeHTML(t.merchant||'Bank transaction')+'" data-historical-transaction="'+escapeHTML(String(t.id))+
   '" data-historical-account="'+escapeHTML(aid)+'">'+
   '<span class="history-actual-date">'+escapeHTML(dayLabel(t.date))+'</span>'+
   '<div class="history-actual-description"><strong>'+escapeHTML(t.merchant||'Bank transaction')+'</strong>'+
   '<small>'+escapeHTML(label(aid))+' · '+escapeHTML(t.type||'Unclassified')+
    (t.pending?' · Pending':' · Posted')+(matches.length?' · '+(ambiguous?'Several matching schedules':'Recurring confirmed'):'')+
    (rejected?' · NOT RECURRING':'')+'</small></div>'+
   '<strong class="history-actual-amount '+(incoming?'incoming':'outgoing')+'">'+(incoming?'+':'−')+cash(t.amount)+'</strong>'+
   action+'</div>';
 }).join('');
 return '<div class="planner-page history-page"><div class="page-heading"><div><h2>Actual transaction history</h2>'+
  '<p>Select a transaction to review it or set up a recurring schedule. Automatic prediction exclusions can be undone directly from the row.</p></div></div>'+
  (reviewNotice?'<p class="future-notice" role="status">'+escapeHTML(reviewNotice)+'</p>':'')+
  (recurringDraft&&!transactionDetail?repeatingReviewForm(s):'')+
  '<form class="history-filters" data-history-filter>'+
   '<label>Account'+accountSelect(accounts,historyAccount,'historyAccount',true)+'</label>'+
   '<label>Find a transaction<input name="search" type="search" value="'+escapeHTML(historySearch)+
    '" placeholder="Merchant, date, amount"></label>'+
   '<button class="btn" type="submit">Search</button>'+
   (historySearch?'<button type="button" class="btn" data-clear-history-search>Clear</button>':'')+
   '</form><div class="history-list-surface"><p class="history-count">Showing '+visible.length+' of '+filtered.length+
    ' matching transaction'+(filtered.length===1?'':'s')+
    (filtered.length>historyLimit?' · More available below':'')+'</p>'+
   (rows||'<div class="empty-visual">No bank transactions match this filter. Try another account or search.</div>')+
   (filtered.length>historyLimit?'<div class="history-more"><button type="button" class="btn" data-history-more>Show older transactions</button></div>':'')+
   '</div></div>';
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
 const duplicates=bundle?.duplicateConflicts||[],
  postedAmbiguities=bundle?.postedMatchReview||[];
 const count=regular.length+mortgages.length+weak.length+autoLow.length+duplicates.length+
  postedAmbiguities.length;
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
  (recurringDraft&&!transactionDetail?repeatingReviewForm(s):'')+
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
  (postedAmbiguities.length?'<section class="panel" data-posted-match-review>'+
    '<div class="section-title"><h2>Which schedule was paid?</h2>'+
    '<span class="status-tag warn">'+postedAmbiguities.length+' NEEDS REVIEW</span></div>'+
    '<p class="lead">A posted bank payment may cover one of several separate schedules. '+
    'Choose the correct schedule so only that future payment is removed from the balance forecast.</p>'+
    postedAmbiguities.map(row=>'<article class="review-candidate">'+
     '<div class="review-candidate-main"><strong>'+escapeHTML(row.merchant)+'</strong>'+
     '<small>Posted '+escapeHTML(dayLabel(row.date))+' · '+cash(row.amount)+
     ' · Bank record remains unchanged</small></div>'+
     '<div class="review-candidate-actions">'+row.candidates.map(c=>
      '<button class="btn" type="button" data-posted-match-bank="'+escapeHTML(row.bankId)+
       '" data-posted-match-rule="'+escapeHTML(c.ruleId)+'">'+
       '#'+(scheduleListNumber(c.ruleId)||'?')+' '+escapeHTML(c.label)+
       ' · '+escapeHTML(dayLabel(c.date))+'</button>').join('')+'</div></article>').join('')+
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
  (!count?'<section class="panel"><div class="section-title"><h2>All caught up</h2></div></section>':'')+
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
    '<strong>'+(p.autopayEnabled?cash(p.amount):'No autopay')+'</strong></div>').join('')||
    '<p class="lead">No card statement forecasts are configured yet. Set up each card in Settings.</p>')+
  '<p class="audit-footnote">The figure shown is the predicted withdrawal from checking, not a new purchase. Statement reconstruction may differ from issuer totals due to carried balances, fees, interest or missing activity.</p></section>';
}
function overviewPage(bundle,s,chosen,derived,fresh){
 const series=(derived?.series||[]).filter(x=>x.date<=shiftDay(s.asOf,horizon));
 const events=(derived?.events||[]).filter(x=>x.date>s.asOf&&x.date<=shiftDay(s.asOf,horizon))
  .sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);
 const notes=events.map(e=>{
  const key=e.transferGroupId?window.HouseholdPlannerTransactions.keyMovement(e.transferGroupId):
   e.predictionKey||window.HouseholdPlannerTransactions.keyEvent(e.id,e.accountId);
  return '<button type="button" class="overview-upcoming-item overview-upcoming-open" data-open-transaction="'+
   escapeHTML(key)+'"><span>'+escapeHTML(dayLabel(e.date))+
   '</span><strong>'+escapeHTML(e.merchant)+'</strong><span>'+cash(e.amount)+'</span>'+
   '<span class="overview-details-indicator">Details →</span></button>';
 }).join('');
 return '<div class="planner-page overview-page">'+
  accountCards(s,bundle?.projection,chosen)+hero(chosen,derived,s.asOf)+
  ((bundle?.missingMortgages?.length||bundle?.historyCandidates?.length||bundle?.routines?.review?.length||bundle?.automaticRecurrence?.review?.length||bundle?.duplicateConflicts?.length||bundle?.postedMatchReview?.length)?
    '<section class="panel review-spotlight"><div><strong>Recurring payments may need review</strong>'+
    '<p>Bank transactions or repeating payments need a decision before your forecast can be trusted.</p></div>'+
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
function summaryPage(bundle,s,chosen,derived,fresh){
 const calendar=window.HouseholdPlannerSummary.render({
  snapshot:s,chosen,derived,bundle,days:horizon,
  prefs:state().predictions||{},accounts:activeAccounts(s),
  fresh,ready:window.HouseholdPaymentObligations.ready
 });
 // Calendar is the entry point for forecast details and unresolved decisions.
 // Retain the full Predictions editor and skipped-payment restore functionality
 // as drill-down views, rather than competing permanent navigation entries.
 return calendar;
}
function settingsPage(bundle,s,chosen){
 return '<div class="planner-page settings-page"><div class="page-heading"><div>'+
  '<h2>Settings</h2></div></div>'+
  '<section class="panel"><div class="section-title"><h2>Balance safety</h2></div>'+
   '<form id="cushion-form" data-cushion-form><label class="cash-cushion-label">Low-balance warning threshold ($)'+
    '<input type="number" name="cashCushion" min="0" step="1" max="999999999" value="'+
     escapeHTML(state().predictions?.cashCushion??500)+'" required></label>'+
    '<button class="btn primary" type="submit">Save threshold</button></form></section>'+
  (Object.keys(state().predictions?.futureRecurrenceExclusions||{}).length?
  '<section class="panel mini-panel" aria-label="Not recurring decisions">'+
   '<div class="section-title"><h2>Not recurring</h2><span class="status-tag">'+
    Object.keys(state().predictions?.futureRecurrenceExclusions||{}).length+' EXCLUDED</span></div>'+
   '<p>These merchants are excluded from automatic recurring predictions for the selected account and direction. Your actual bank transactions are unchanged. Choose Allow predictions to undo a mistake; manually created schedules can be added again from History or Transactions.</p>'+
   Object.entries(state().predictions?.futureRecurrenceExclusions||{}).map(([key,item])=>
    '<div class="future-skip-line"><strong>'+escapeHTML(item.merchant)+'</strong> · '+
     escapeHTML(activeAccounts(s).find(a=>String(a.id)===String(item.accountId))?.name||item.accountId)+
     ' · '+escapeHTML(item.type)+(item.seriesKey?' · inferred series only':
      item.manualRuleId?' · one saved schedule':item.phaseDate?' · one payday phase':'')+
     ' <button type="button" class="btn" data-restore-recurrence="'+escapeHTML(key)+
     '">Allow predictions</button></div>').join('')+
   '</section>':'')+
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
 if(!bundle&&error)bundle={forecastError:error};
 const projection=bundle?.projection||null,selectedSource=selected(s);
 lastSuggestions=bundle?.routines?.review||[];
 lastMissingMortgages=bundle?.missingMortgages||[];
 lastHistoryRows=bundle?.rows||[];
 lastReviewCandidates=bundle?.historyCandidates||[];
 if(selectedSource)selectedAccount=selectedSource.id;
 const derived=projection?.accounts.find(x=>x.id===String(selectedAccount));
 const statuses=projection?.diagnostics||{};
 const missingCards=activeAccounts(s).filter(a=>accountType(a)==='credit'&&
  !window.HouseholdPaymentObligations.ready(state().predictions?.paymentRules?.[a.id],a,activeAccounts(s)));
 const caution=[
  ...(missingCards.length?['Credit-card payment schedule not set for '+missingCards.map(a=>a.name).join(', ')+'. Future checking withdrawals may be incomplete.']:[]),
  ...((bundle?.payments?.warnings||[]).slice(0,3)),
  ...((bundle?.missingMortgages||[]).slice(0,2).map(m=>
   'An actual '+cash(m.amount)+' mortgage payment from '+m.account+' is not in the forecast. Review its proposed recurring schedule below.')),
  ...((bundle?.routines?.warnings||[]).slice(0,2).map(w=>
   'Possible mortgage withdrawal not included: '+w.merchant+' ('+w.reason+'). Confirm its recurrence before relying on the projected balance.')),
  ...((bundle?.postedMatchReview||[]).length?['Some posted payments may cover one of several confirmed schedules. Choose the matching schedule under Needs review before relying on the projected balance.']:[]),
  ...((bundle?.forecast?.suppressedDuplicates||[]).length?['Older overlapping one-time forecasts were excluded to avoid duplicate payments.']:[]),
  ...((statuses.unassigned||[]).length?['Some expected payments lack a confirmed account, so those are not included in the balance.']:[]),
  ...((statuses.unmatchedTransfers||[]).length?['Some scheduled transfers do not have a verified counterpart; review before relying on cash coverage.']:[])
 ];
 let note='';
 if(error)note='<div class="notice danger"><strong>Forecast calculation unavailable.</strong> '+escapeHTML(error)+
  '. Your bank balances have not been changed.</div>';
 else if(latestError)note='<div class="notice danger">'+escapeHTML(latestError)+'</div>';
 else if(caution.length)note='<div class="notice danger"><div><strong>Forecast needs review.</strong> '+
  escapeHTML(caution.join(' '))+'</div>'+
  ((bundle?.postedMatchReview||[]).length?
   '<button type="button" class="btn" data-view="reviews">Choose matching schedule</button>':'')+
  '</div>';
 else note='<div class="notice"><div><strong>'+(live()?'Read-only bank feed':'Fictional planning preview')+'.</strong> '+
  (live()?'Balances are bank-reported; future movements are estimates.':'These balances and transactions are samples, not your actual household.')+
  '</div><span class="secondary">'+escapeHTML(s.asOf||dateToday())+'</span></div>';
 const informational=!error&&!latestError&&!caution.length;
 $('planner-notice').innerHTML=informational||activeTab==='summary'&&!error&&!latestError?'':note;
 const finePrint=$('planner-fine-print');
 if(finePrint){
  finePrint.hidden=!informational;
  finePrint.textContent=informational?
   (live()?'Bank balances are reported by your bank. Future transactions and balances are estimates.':
    'Demo uses fictional accounts and transactions, not your actual household.')+
   ' · As of '+(s.asOf||dateToday()):'';
 }
 if(!selectedSource){root.innerHTML='<section class="panel"><h2>No connected accounts</h2><p>Add a bank account to start planning.</p>'+
  (available()?'<a class="btn primary" href="/bank-connect">Connect a bank</a>':'')+'</section>';return}
 const fresh=derived&&freshness(derived);
 const cashProjection=(derived?.series||[]).filter(x=>x.date<=shiftDay(s.asOf,horizon));
 let important=(derived?.events||[]).filter(e=>['expense','transfer_out'].includes(e.kind));
 const income=(derived?.events||[]).filter(e=>['income','transfer_in'].includes(e.kind));
 root.innerHTML=activeTab==='settings'?settingsPage(bundle,s,selectedSource):
  activeTab==='history'?historyPage(bundle,s):
  activeTab==='schedules'?schedulesPage(bundle,s):
  activeTab==='reviews'?reviewsPage(bundle,s):
  activeTab==='transactions'?transactionsPage(bundle,s):
   (activeTab==='overview'?overviewPage:(window.HouseholdPlannerSummary?.render?summaryPage:overviewPage))(bundle,s,selectedSource,derived,fresh);
 for(const form of (typeof root.querySelectorAll==='function'?
  root.querySelectorAll('form:has([data-history-link])'):[])){
  if(form.hasAttribute('data-history-recurring-form')&&recurringDraft?.examples){
   form.dataset.linkedExampleIds=JSON.stringify(recurringDraft.examples);
  }
  updateHistoryLinks(form);
 }
 for(const form of (typeof root.querySelectorAll==='function'?
  root.querySelectorAll('[data-card-rule]'):[]))configureCardFields(form);
 drawTransactionDetail(bundle,s);
 if(activeTab==='schedules')applyScheduleSearch(root);
}
document.addEventListener('click',async e=>{
 if(e.target.closest?.('[data-close-transaction-detail]')){dismissTransaction();return}
 const stopPlan=e.target.closest?.('[data-stop-plan]');
 if(stopPlan){
  const id=stopPlan.dataset.stopPlan,
   row=futureRows(forecastFor(snapshot()),snapshot()).find(r=>r.recurringRuleId===id);
  if(!row)return;
  if(planStopPending!==id){planStopPending=id;render();return}
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.stopRecurrence(state(),row));
   planStopPending='';transactionDetail=null;scheduleMode='';scheduleTarget='';
   scheduleNotice='Stopped this repeating plan; actual bank history is unchanged.';
   if(detailOriginTab){activeTab=detailOriginTab;detailOriginTab=null}
   render();
  }catch(err){planStopPending='';scheduleNotice=String(err.message||err);render()}
  return;
 }
 const selectedPlanPayment=e.target.closest?.('[data-select-plan-payment]');
 if(selectedPlanPayment&&transactionDetail?.kind==='schedule'){
  const chosen=selectedPlanPayment.dataset.selectPlanPayment;
  transactionDetail.selectedKey=transactionDetail.selectedKey===chosen?'':chosen;
  transactionDetail.mode='edit';
  render();return;
 }
 if(e.target.closest?.('[data-cancel-inline-schedule]')){
  closeInlineTransaction();return;
 }
  const opening=e.target.closest?.('[data-open-transaction],[data-open-card-payment]');
 if(opening?.hasAttribute('data-open-card-payment')){
  const adjacent=opening.closest('[data-inline-row-wrapper]')?.querySelector('[data-open-transaction]');
  if(adjacent&&openInlineTransaction(adjacent))return;
 }
 if(opening?.hasAttribute('data-open-transaction')&&openInlineTransaction(opening))return;
 if(opening){
  if(opening.hasAttribute('data-open-transaction'))
   openPrediction(opening.dataset.openTransaction,opening);
  else{
   const row=futureRows(forecastFor(snapshot()),snapshot()).find(r=>
    r.kind==='movement'&&r.id===opening.dataset.openCardPayment);
   if(row)openPrediction(row.key,opening);
   else setNotice('This card payment has changed. Reopen its dated prediction.');
  }
  return;
 }
 const postedChoice=e.target.closest?.('[data-posted-match-bank][data-posted-match-rule]');
 if(postedChoice){
  const bankId=postedChoice.dataset.postedMatchBank,
   ruleId=postedChoice.dataset.postedMatchRule;
  try{
   const current=forecastFor(snapshot()),
    candidate=(current?.postedMatchReview||[]).find(item=>item.bankId===bankId&&
     item.candidates.some(c=>c.ruleId===ruleId));
   if(!candidate)throw Error('This bank payment has changed. Refresh Needs review.');
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.linkPostedToSchedule(
    state(),bankId,ruleId,model.records(state()),activeAccounts(snapshot())));
   reviewNotice='Linked the posted payment to schedule #'+
    (scheduleListNumber(ruleId)||'?')+'. The forecast has been recalculated.';
   render();
  }catch(err){reviewNotice=String(err.message||err);render()}
  return;
 }
 const linkedSchedule=e.target.closest?.('[data-open-linked-schedule]');
 if(linkedSchedule){
  const id=linkedSchedule.dataset.openLinkedSchedule;
  if(!(state().predictions?.futureRecurringRules||[]).some(r=>r.id===id))return;
  detailOriginTab=activeTab;
  activeTab='schedules';scheduleTarget=id;
  scheduleMode=linkedSchedule.dataset.schedulePanel==='estimate'?'estimate':'edit';
  transactionDetail={kind:'schedule',id,mode:scheduleMode};
  render();return;
 }
 const closeSchedule=e.target.closest?.('[data-schedule-close]');
 if(closeSchedule){
  if(transactionDetail)dismissTransaction();
  else{scheduleMode='';scheduleTarget='';schedulePreset=null;scheduleRemoveTarget='';render()}
  return;
 }
 const newSchedule=e.target.closest?.('[data-schedule-new]');
 if(newSchedule){scheduleMode='new';scheduleTarget='';schedulePreset=null;scheduleNotice='';
  transactionDetail=null;render();
  document.querySelector('[data-schedule-new-form] [name=merchant]')?.focus();
  return}
 const scheduleEdit=e.target.closest?.('[data-schedule-edit]');
 if(scheduleEdit){
  const id=scheduleEdit.dataset.scheduleEdit;
  const same=scheduleMode==='edit'&&scheduleTarget===id;
  scheduleRemoveTarget='';scheduleNotice='';
  scheduleMode=same?'':'edit';scheduleTarget=same?'':id;
  transactionDetail=null;render();return;
 }
 const removeWindow=e.target.closest?.('[data-schedule-remove-estimate]');
 if(removeWindow){
  const id=removeWindow.dataset.scheduleRemoveEstimate,index=Number(removeWindow.dataset.estimateIndex);
  try{await commitForecastChange(()=>window.HouseholdPlannerTransactions.removeScheduleEstimate(state(),id,index));
   scheduleNotice='Estimated range cleared. All projected balances recalculated.';render()}
  catch(e){scheduleNotice=String(e.message||e);render()}
  return;
 }
 const cancelScheduleRemoval=e.target.closest?.('[data-schedule-cancel-remove]');
 if(cancelScheduleRemoval){
  scheduleRemoveTarget='';render();return;
 }
 const removeSchedule=e.target.closest?.('[data-schedule-remove]');
 if(removeSchedule){
  const id=removeSchedule.dataset.scheduleRemove;
  if(scheduleRemoveTarget!==id){scheduleRemoveTarget=id;render();return}
  try{await commitForecastChange(()=>window.HouseholdPlannerTransactions.removeRecurring(state(),id));
   scheduleMode='';scheduleTarget='';scheduleRemoveTarget='';
   scheduleNotice='Removed this schedule only. Bank transactions and other schedules were not changed.';transactionDetail=null;render()}
  catch(e){scheduleNotice=String(e.message||e);render()}
  return;
 }
 const calendar=window.HouseholdPlannerSummary;
 const repairClose=e.target.closest('[data-repair-close]'),repairOpen=e.target.closest('[data-repair-open]');
 if(repairClose||repairOpen){
  const popup=document.querySelector('.calendar-repair-overlay');
  if(popup){popup.hidden=!!repairClose; if(repairOpen)popup.querySelector('[data-repair-refresh]')?.focus();}
  return;
 }
 if(e.target.closest('[data-repair-refresh]')){
  const refresh=$('refresh-bank');
  if(live()&&refresh){refresh.click();return;}
  window.location.href='/bank-connect';return;
 }
 const addCalendar=e.target.closest('[data-calendar-add]');
 const gap=e.target.closest('[data-calendar-fill-gap]');
 if(addCalendar||gap){
  const date=calendar.currentDay(),chosen=selected(snapshot()),suggestion=gap?
   calendar.currentGap(gap.dataset.calendarFillGap):null;
  if(!chosen||date<=snapshot().asOf)return;
  calendar.openEditor({mode:'add',preset:{date,accountId:chosen.id,
   ...(suggestion?{merchant:suggestion.merchant,amount:suggestion.amount,
     type:suggestion.type}: {})}});
  document.querySelector('[data-calendar-quick-form] [name=merchant]')?.focus();
  return;
 }
 const editCalendar=e.target.closest('[data-calendar-edit]');
 if(editCalendar){
  const item=calendar.currentEvent(editCalendar.dataset.calendarEdit);
  if(!item)return;
  const s=snapshot(),all=futureRows(forecastFor(s),s);
  const row=item.transferGroupId?
   all.find(r=>r.kind==='movement'&&r.id===String(item.transferGroupId)):
   all.find(r=>r.kind==='event'&&r.id===String(item.id)&&
    r.accountId===String(item.accountId));
  if(!row){setNotice('This prediction changed. Open Predictions to inspect it.');return}
  openPrediction(row.key,editCalendar);
  return;
 }
 if(e.target.closest('[data-calendar-cancel]')){calendar.closeEditor();return;}
 const skipCalendar=e.target.closest('[data-calendar-skip]');
 if(skipCalendar){
  const form=skipCalendar.closest('[data-calendar-quick-form]'),
   key=form?.dataset.calendarQuickKey,s=snapshot(),
   row=futureRows(forecastFor(s),s).find(r=>r.key===key);
  if(!row){setNotice('This prediction has changed. Try again.');return}
  skipCalendar.disabled=true;
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.skip(state(),row.key,{
    label:row.merchant,date:row.date,accountId:row.accountId||row.fromAccountId,
    toAccountId:row.toAccountId}));
   latestError='';render();calendar.refreshNotice('Skipped this predicted occurrence. Other payments are unchanged.');
  }catch(err){skipCalendar.disabled=false;
   const target=form?.querySelector('[data-calendar-error]');
   if(target)target.textContent=String(err.message||err)}
  return;
 }
 const pickedMortgage=e.target.closest('[data-coverage-mortgage]');
 if(pickedMortgage){
  const identity=window.HouseholdPlannerCoverage?.getMortgageChoice(
   pickedMortgage.dataset.coverageMortgage);
  const exists=identity&&activeAccounts(snapshot()).some(a=>
   String(a.id)===identity.accountId&&accountType(a)!=='credit');
  if(!exists){setNotice('Select a predicted mortgage payment again.');return}
  pickedMortgage.disabled=true;
  try{
   await commitForecastChange(()=>{
    state().predictions.mortgageCoverageRules??={};
    state().predictions.mortgageCoverageRules[identity.accountId]=identity;
   });
   latestError='';render();
  }catch(error){setNotice('Mortgage identification could not be saved: '+
   String(error.message||error))}
  return;
 }
 const assignment=e.target.closest('[data-coverage-assign]');
 if(assignment){
  const choice=window.HouseholdPlannerCoverage?.getCategoryChoice(
   assignment.dataset.coverageAssign);
  const acc=activeAccounts(snapshot());
  const account=choice&&acc.find(a=>String(a.id)===String(choice.accountId));
  const category=String(choice?.category||'');
  const categoryValid=category==='income'||category==='other-bills'||
   category.startsWith('card|')&&acc.some(a=>String(a.id)===category.slice(5)&&
    accountType(a)==='credit');
  if(!account||accountType(account)==='credit'||!categoryValid){
   setNotice('Choose a predicted item again.');return;
  }
  assignment.disabled=true;
  try{
   await commitForecastChange(()=>{
    const p=state().predictions;
    p.coverageAssignments??={};
    const key=category+'|'+choice.accountId,
     arr=Array.isArray(p.coverageAssignments[key])?p.coverageAssignments[key]:[],
     identity=choice.identity,signature=JSON.stringify(identity),
     remaining=arr.filter(v=>JSON.stringify(v)!==signature);
    if(choice.remove||remaining.length<arr.length){
     if(remaining.length)p.coverageAssignments[key]=remaining;
     else delete p.coverageAssignments[key];
    }else{
     if(arr.length>=15)throw Error('This category already tracks 15 recurring streams.');
     p.coverageAssignments[key]=[...arr,identity];
    }
   });
   latestError='';render();
  }catch(error){setNotice('Coverage identification could not be saved: '+
   String(error.message||error))}
  return;
 }
 const resetMortgage=e.target.closest('[data-coverage-mortgage-reset]');
 if(resetMortgage){
  try{
   await commitForecastChange(()=>{
    delete state().predictions.mortgageCoverageRules?.[resetMortgage.dataset.coverageMortgageReset];
   });
   latestError='';render();
  }catch(error){setNotice('Mortgage identification could not be cleared: '+
   String(error.message||error))}
  return;
 }
 const view=e.target.closest('[data-view]');
 if(view){
  activeTab=view.dataset.view;transactionDetail=null;detailParentSchedule=null;detailOriginTab=null;
  document.getElementById('planner-menu')?.removeAttribute('open');
  editingKey='';showNewTransaction=false;transactionNotice='';recurringDraft=null;
  render();
  window.scrollTo({top:0,behavior:'auto'});
  return;
 }
 const scheduleChoice=e.target.closest?.('[data-choose-history-schedule]');
 if(scheduleChoice){
  if(!openSchedulePlan(scheduleChoice.dataset.chooseHistorySchedule,'',scheduleChoice))
   setNotice('That schedule changed. Refresh bank history.');
  return;
 }
 const actualRow=e.target.closest?.('[data-historical-transaction]');
 const fromHistory=e.target.closest('[data-history-plan]')||
  e.target.closest('[data-calendar-history-plan]')||
  (actualRow&&!e.target.closest('button,input,a,select')?actualRow:null);
 if(fromHistory){
  const account=fromHistory.dataset.historyAccount||fromHistory.dataset.historicalAccount;
  const historyId=fromHistory.dataset.historyPlan||fromHistory.dataset.calendarHistoryPlan||
   fromHistory.dataset.historicalTransaction;
  const row=lastHistoryRows.find(t=>String(t.id)===historyId&&
   window.HouseholdPlannerHistory.accountOf(t,activeAccounts(snapshot()))===account);
  if(!row||!window.HouseholdPlannerHistory.canPlan(row)){
   setNotice('That bank transaction is no longer available for review.');return;
  }
  // Calendar and History consult the SAME account/direction/history-ID matcher.
  // Never open a fresh recurring form for a payment already represented by a
  // saved schedule, even if its bank amount is different.
  const matching=window.HouseholdPlannerTransactions.historicalScheduleMatches(
   row,activeAccounts(snapshot()),state().predictions?.futureRecurringRules||[]);
  if(matching.length===1){
   recurringDraft=null;
   if(!openSchedulePlan(matching[0].id,'',e.target))
    setNotice('That schedule changed. Refresh bank history.');
   return;
  }
  if(matching.length>1){
   recurringDraft=null;transactionDetail={kind:'history-choice',ids:matching.map(r=>r.id)};
   detailReturnFocus=e.target;
   drawTransactionDetail(forecastFor(snapshot()),snapshot());
   document.querySelector('.transaction-detail-close')?.focus();
   return;
  }
  try{
   recurringDraft=window.HouseholdPlannerHistory.draftFor(
    row,lastHistoryRows,activeAccounts(snapshot()),snapshot().asOf);
   reviewNotice='';
  }catch(error){setNotice(String(error.message||error));return}
  detailReturnFocus=e.target;
  // Browser users see one shared panel. Lightweight test environments with
  // no interactive DOM preserve the inline draft for banking safety checks.
  if(typeof $('planner-main')?.insertAdjacentHTML!=='function'){
   transactionDetail=null;activeTab='history';render();return;
  }
  transactionDetail={kind:'actual',id:String(row.id),account};
  drawTransactionDetail(forecastFor(snapshot()),snapshot());
  document.querySelector('.transaction-detail-close')?.focus();
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
  const rules=(state().predictions?.futureRecurringRules||[]).filter(r=>
   String(r.originalAccountId||r.accountId||r.fromAccountId)===aid&&
   (r.matchNames||[String(r.originalMerchant||r.merchant).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()])
    .includes(String(row.merchant).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim())&&
   (r.kind==='movement'?'transfer':r.type)===kind);
  const phaseRules=rules.filter(r=>r.frequency==='every-4-weeks'&&
   Math.min(Math.abs(Math.round((Date.parse(r.anchorDate)-Date.parse(row.date))/86400000)%28),
    28-Math.abs(Math.round((Date.parse(r.anchorDate)-Date.parse(row.date))/86400000)%28))<=3);
  const saved=phaseRules.length===1?phaseRules[0]:rules.length===1?rules[0]:null;
  if(rules.length>1&&!saved){
   setNotice('This employer has several pay schedules. Choose the matching paycheck in Future Transactions.');return;
  }
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.stopRecurrence(state(),{
    kind:saved?.kind==='movement'?'movement':'event',accountId:aid,type:kind,
    merchant:row.merchant,recurringRuleId:saved?.id||null
   }));
   recurringDraft=null;reviewNotice='Marked '+row.merchant+
    ' as not recurring.'+(saved?.frequency==='every-4-weeks'?
     ' Only this four-week payday was removed.':' Matching future predictions were removed.');
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
  recurringDraft=null;
  if(transactionDetail) dismissTransaction();
  else render();
  return;
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
 if(e.target.closest('[data-cancel-future]')){
  if(e.target.closest('[data-inline-transaction-editor]')){closeInlineTransaction();return}
  if(transactionDetail?.kind==='schedule'&&transactionDetail.selectedKey){
   transactionDetail.selectedKey='';render();return;
  }
  dismissTransaction();return;
 }
 const edit=e.target.closest('[data-edit-future]');
 if(edit){showNewTransaction=false;transactionNotice='';
  if(!openInlineTransaction(edit))openPrediction(edit.dataset.editFuture,edit);
  return}
 const skip=e.target.closest('[data-skip-future]');
 if(skip){
  const row=futureRows(forecastFor(snapshot()),snapshot()).find(r=>r.key===skip.dataset.skipFuture);
  if(!row)return;
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.skip(state(),row.key,
    {label:row.merchant,date:row.date,accountId:row.accountId||row.fromAccountId,
     toAccountId:row.toAccountId}));
   editingKey='';restoreScheduleAfterOccurrence();transactionNotice='Skipped '+row.merchant+' on '+dateLong(row.date)+'.';render();
  }catch(err){transactionNotice=String(err.message||err);render()}
  return;
 }
 const restore=e.target.closest('[data-restore-future]');
 if(restore){
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.restore(state(),restore.dataset.restoreFuture));
   editingKey='';restoreScheduleAfterOccurrence();transactionNotice='Forecast occurrence restored.';render();
  }catch(err){transactionNotice=String(err.message||err);render()}
  return;
 }
 const removeAdded=e.target.closest('[data-remove-added]');
 if(removeAdded){
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.removeAdded(state(),removeAdded.dataset.removeAdded));
   editingKey='';restoreScheduleAfterOccurrence();transactionNotice='Added transaction removed.';render();
  }catch(err){transactionNotice=String(err.message||err);render()}
  return;
 }
 const removeRecurring=e.target.closest('[data-remove-recurring]');
 if(removeRecurring){
  const row=futureRows(forecastFor(snapshot()),snapshot())
   .find(r=>r.key===removeRecurring.dataset.removeRecurring);
  if(!row){setNotice('The recurring schedule changed. Open Predictions and try again.');return}
  try{
   const result=await commitForecastChange(()=>window.HouseholdPlannerTransactions.stopRecurrence(state(),row));
   editingKey='';restoreScheduleAfterOccurrence();transactionNotice=result.autoSeries?
    'Removed only the inferred '+row.merchant+' series. Confirmed income schedules were preserved. Restore in Settings.':
    'Marked '+row.merchant+' as not recurring. Only its matching schedule was removed. Restore in Settings or History.';
   render();
  }catch(err){transactionNotice=String(err.message||err);render()}
  return;
 }
 const resetRecurring=e.target.closest('[data-reset-series]');
 if(resetRecurring){
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.resetSeries(state(),resetRecurring.dataset.resetSeries));
   editingKey='';restoreScheduleAfterOccurrence();transactionNotice='Recurring schedule restored to its original forecast.';render();
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

// A payee may legitimately have multiple independently confirmed schedules.
// Ask which EXISTING schedule to update; never create a second payment as a
// workaround for ambiguous identities. This dropdown remains in the form.
function showRecurringScheduleChoice(form,error){
 if(error?.code!=='RECURRING_SCHEDULE_CHOICE'||!Array.isArray(error.options)||
  !error.options.length)return false;
 let holder=form.querySelector('[data-recurring-schedule-choice]');
 if(!holder){
  holder=document.createElement('div');
  holder.className='recurring-schedule-choice';
  holder.dataset.recurringScheduleChoice='true';
  form.appendChild(holder);
 }
 const choices=error.options.map(r=>'<option value="'+escapeHTML(r.id)+'">'+
  escapeHTML(r.merchant||'Recurring payment')+' · '+escapeHTML(r.frequency||'Repeats')+
  ' · '+escapeHTML(dayLabel(r.anchorDate))+' · '+cash(r.amount)+'</option>').join('');
 holder.innerHTML='<label>Which existing payment schedule?'+
  '<select name="existingRuleId" required><option value="" selected disabled>Select a schedule</option>'+
  choices+'</select></label>'+
  '<p>Only the chosen recurring schedule will be updated. This does not add a second payment or change your bank history.</p>';
 holder.querySelector('select')?.focus();
 return true;
}
async function commitForecastChange(action){
 const current=state(),before=JSON.stringify(current.predictions||{});
 try{
  const result=action();
  const saved=await savePlanning();
  if(live()&&(!saved||saved.saved!==true))throw Error('The predicted transaction was not saved. Please try again.');
  return result;
 }catch(err){current.predictions=JSON.parse(before);throw err}
}
// Add a category without rebuilding an unsaved editor or modifying bank data.
document.addEventListener('submit',async e=>{
 const form=e.target.closest?.('[data-schedule-category-add]');
 if(!form)return;
 e.preventDefault();
 const field=form.querySelector('[name=categoryName]'),
  submit=form.querySelector('[type=submit]'),
  notice=form.parentElement.querySelector('[data-schedule-category-notice]');
 if(submit)submit.disabled=true;
 try{
  const label=await commitForecastChange(()=>window.HouseholdPlannerTransactions.addScheduleCategory(state(),field.value));
  document.querySelectorAll('select[name=category],[data-schedule-category-filter]').forEach(select=>{
   const option=document.createElement('option');option.value=label;option.textContent=label;
   select.appendChild(option);
   if(select.name==='category')select.value=label;
  });
  field.value='';
  if(notice)notice.textContent='Added '+label+'. Choose it for any schedule.';
 }catch(error){if(notice)notice.textContent=String(error.message||error)}
 finally{if(submit)submit.disabled=false}
});
document.addEventListener('submit',async e=>{
 const form=e.target.closest?.('[data-schedule-new-form],[data-schedule-edit-form]');
 if(!form)return;
 e.preventDefault();
 const submit=form.querySelector('[type=submit]');if(submit)submit.disabled=true;
 try{
  const fields=Object.fromEntries(new FormData(form)),
   T=window.HouseholdPlannerTransactions,s=snapshot(),accounts=activeAccounts(s),
   originatingKey=form.closest('[data-inline-row-wrapper]')?.dataset.paymentKey||'';
  let savedPlanId='';
  if(form.hasAttribute('data-schedule-new-form')){
   const saved=await commitForecastChange(()=>T.defineRecurring(state(),fields,accounts,s.asOf,null,
    model.records(state()),fields.historyExampleId?[fields.historyExampleId]:[]));
   savedPlanId=saved.id;
   scheduleNotice='Plan created. All its upcoming payments are shown below.';
  }else if(form.hasAttribute('data-schedule-edit-form')){
   const id=form.dataset.scheduleEditForm,r=(state().predictions?.futureRecurringRules||[]).find(x=>x.id===id);
   if(!r)throw Error('This schedule changed. Open it again.');
   const reference={kind:r.kind,recurringRuleId:id,
    sourceAccountId:r.originalAccountId||r.accountId||r.fromAccountId,
    fromAccountId:r.fromAccountId,toAccountId:r.toAccountId,
    accountId:r.accountId,originalMerchant:r.originalMerchant||r.merchant,
    originalType:r.originalType||r.type,sourceAmount:r.matchAmount||r.amount,date:r.sourceAnchorDate||r.anchorDate};
   await commitForecastChange(()=>T.defineRecurring(state(),fields,accounts,s.asOf,reference,model.records(state()),[]));
   savedPlanId=id;
   scheduleNotice='Saved — repeating schedule updated. Individual payment edits remain separate.';
  }
  schedulePreset=null;scheduleRemoveTarget='';
  if(activeTab==='schedules'&&savedPlanId&&!transactionDetail){
   scheduleMode='edit';scheduleTarget=savedPlanId;render();
   const card=[...document.querySelectorAll('[data-schedule-card]')].find(x=>x.dataset.scheduleCard===savedPlanId);
   card?.insertAdjacentHTML('afterbegin','<p class="inline-save-result" role="status">'+escapeHTML(scheduleNotice)+'</p>');
  }else if(originatingKey&&savedPlanId){
   render();
   confirmInlineSave(originatingKey,'Saved — repeating plan defaults updated.');
  }else if(transactionDetail?.kind==='schedule'&&savedPlanId){
   scheduleMode='edit';scheduleTarget=savedPlanId;
   transactionDetail={kind:'schedule',id:savedPlanId,mode:'edit',selectedKey:''};
  }else{
   scheduleMode='';scheduleTarget='';transactionDetail=null;
   if(detailOriginTab){activeTab=detailOriginTab;detailOriginTab=null}
   render();
  }
 }catch(error){if(submit)submit.disabled=false;
  scheduleNotice=String(error.message||error);
  // Preserve entered dates/amounts on error; don't reset the form.
  let message=form.querySelector('[data-schedule-error]');
  if(!message){message=document.createElement('p');message.dataset.scheduleError='true';
   message.setAttribute('role','alert');form.appendChild(message)}
  message.textContent=scheduleNotice;
 }
});
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
  if(fields.date>shiftDay(snapshot().asOf,horizon))
   throw Error('Next payment must fall within the three-year forecast window');
  const linked=fields.type==='transfer',bankType=draft.originalType||draft.sourceRow?.type||draft.type;
  // Future classification is chosen by the owner, not dictated by Plaid.
  // For an actual household transfer, store both account legs as ONE plan,
  // rather than predicting an outgoing debit and unrelated incoming credit.
  const candidate=linked?{
   kind:'movement',fromAccountId:fields.fromAccountId,toAccountId:fields.toAccountId,
   type:'transfer',amount:draft.amount,merchant:draft.merchant,
   date:draft.sourceRow?.date||draft.nextDate,sourceAmount:draft.amount,
   originalMerchant:draft.merchant,bankTransactionId:draft.sourceRow?.id
  }:{
   kind:'event',accountId:draft.accountId,type:bankType,amount:draft.amount,
   merchant:draft.merchant,date:draft.sourceRow?.date||draft.nextDate,
   sourceAmount:draft.amount,originalMerchant:draft.merchant,
   bankTransactionId:draft.sourceRow?.id
  };
  await commitForecastChange(()=>window.HouseholdPlannerTransactions.defineRecurring(
   state(),fields,activeAccounts(snapshot()),snapshot().asOf,candidate,
   model.records(state()),linked?[]:linkedHistoryIds(form)));
  const origin=draft.merchant;
  recurringDraft=null;transactionDetail=null;reviewNotice='Saved recurring forecast for '+origin+'.';
  transactionNotice=reviewNotice;
  const inlineKey=form.closest('[data-inline-row-wrapper]')?.dataset.paymentKey||
   (form.hasAttribute('data-future-edit-form')?form.dataset.futureEditForm:'');
  const savedMessage=form.hasAttribute('data-future-edit-form')?
   (fields.scope==='all'?'Saved — this and future payments updated.':'Saved — only this payment changed.'):null;
  render();
  if(savedMessage)confirmInlineSave(inlineKey,savedMessage);
 }catch(err){
  if(button)button.disabled=false;
  if(showRecurringScheduleChoice(form,err))return;
  let message=form.querySelector('.future-form-error');
  if(!message){
   message=document.createElement('p');message.className='future-form-error';
   message.setAttribute('role','alert');form.appendChild(message);
  }
  message.textContent=String(err.message||err);
 }
});
document.addEventListener('submit',async e=>{
 const form=e.target.closest('[data-calendar-quick-form]');
 if(!form)return;
 e.preventDefault();
 const button=form.querySelector('[type=submit]');if(button)button.disabled=true;
 try{
  const s=snapshot(),accounts=activeAccounts(s),asOf=s.asOf,
   fields=Object.fromEntries(new FormData(form)),planner=window.HouseholdPlannerTransactions,
   mode=form.dataset.calendarQuickForm;
  if(fields.date>shiftDay(asOf,horizon))
   throw Error('Choose a date inside your forecast window.');
  if(mode==='edit'){
   const key=form.dataset.calendarQuickKey,
    row=futureRows(forecastFor(s),s).find(r=>r.key===key);
   if(!row)throw Error('This prediction changed. Reopen it and try again.');
   if(fields.scope==='all'){
    if(!row.seriesKey||!row.cadence)throw Error('This series cannot be edited here. Open Predictions.');
    const cadence=row.cadence==='twice-monthly'?'twice monthly':row.cadence;
    await commitForecastChange(()=>planner.saveSeriesEdit(
     state(),row.seriesKey,row.baseDate,fields,accounts,asOf,cadence,row.kind));
   }else await commitForecastChange(()=>planner.saveEdit(state(),key,fields,accounts,asOf));
  }else if(mode==='add'){
   if(fields.frequency&&fields.frequency!=='once')
    await commitForecastChange(()=>planner.defineRecurring(
     state(),fields,accounts,asOf,null,model.records(state()),[]));
   else await commitForecastChange(()=>planner.add(state(),fields,accounts,asOf));
  }else throw Error('Unknown calendar action.');
  latestError='';render();
  window.HouseholdPlannerSummary.refreshNotice(mode==='edit'?'Prediction updated. All daily balances recalculated.':
   'Prediction added. All daily balances recalculated.');
 }catch(err){
  if(button)button.disabled=false;
  if(showRecurringScheduleChoice(form,err))return;
  const target=form.querySelector('[data-calendar-error]');
  if(target)target.textContent=String(err.message||err);
 }
});
document.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&document.querySelector('[data-inline-transaction-editor]')){
  closeInlineTransaction();return;
 }
 if(e.key==='Escape'&&transactionDetail){dismissTransaction();return}
 if((e.key==='Enter'||e.key===' ')&&e.target.matches?.('[data-historical-transaction]')){
  e.preventDefault();e.target.click();return;
 }
 if(e.key==='Escape'&&document.querySelector('[data-calendar-quick-form]')){
  window.HouseholdPlannerSummary.closeEditor();
  return;
 }
 if(e.key==='Escape')document.getElementById('planner-menu')?.removeAttribute('open');
});
document.addEventListener('change',e=>{
 if(!e.target.matches?.('[data-calendar-type]'))return;
 const form=e.target.closest('[data-calendar-quick-form]');
 if(form)form.dataset.quickKind=e.target.value;
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
    const examples=linkedHistoryIds(form);
    await commitForecastChange(()=>{
     const existingRows=futureRows(forecastFor(s),s);
     const existingCadence=cadenceOption(row.cadence);
     // Converting an inferred payroll phase to an explicit recurring rule
     // must retain its distinct four-week identity.
     const useSeries=Boolean(!row.recurringRuleId&&row.seriesKey&&
      fields.frequency===existingCadence&&row.cadence&&!row.addedId&&
      !form.dataset.historyLinksChanged&&
      row.amountEstimate!=='four-week-paycheck');
     const saveCadence=row.cadence==='twice-monthly'?'twice monthly':row.cadence;
     const result=useSeries?
      planner.saveSeriesEdit(state(),row.seriesKey,row.baseDate,fields,accounts,asOf,saveCadence,row.kind):
      planner.defineRecurring(state(),{...fields,resetAmountWindows:'on'},
       accounts,asOf,row,model.records(state()),examples);
     const edits=state().predictions.futureTransactionEdits||{};
     for(const other of existingRows){
      // A confirmed plan's individually edited dates are independent.
      // Updating repeating defaults may replace the selected date's override,
      // but must never silently erase a different dated exception.
      if(other.key===row.key||
       !row.recurringRuleId&&row.seriesKey&&other.seriesKey===row.seriesKey&&
        other.baseDate>=row.baseDate)
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
   editingKey='';restoreScheduleAfterOccurrence();
  }else if(form.hasAttribute('data-future-new-form')){
   if(fields.frequency&&fields.frequency!=='once'){
    await commitForecastChange(()=>planner.defineRecurring(state(),fields,accounts,asOf,
     null,model.records(state()),linkedHistoryIds(form)));
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
  if(showRecurringScheduleChoice(form,err))return;
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
  if(!fields.autopayEnabled||!fields.method)
   throw Error('Choose autopay yes/no and a payment amount method');
  if(fields.method==='minimum'&&!(Number(fields.minimumAmount)>0))
   throw Error('Enter the minimum payment amount');
  if(fields.method==='fixed'&&!(Number(fields.fixedAmount)>0))
   throw Error('Enter the fixed payment amount');
  const rule={...fields,closingDay:Number(fields.billingEndDate.slice(-2)),
   lastStatementClose:fields.billingEndDate};
  await commitForecastChange(()=>window.HouseholdLedgerData.setCardPaymentRule(state(),cardId,rule));
  latestError='';render();document.getElementById('card-autopay')?.setAttribute('open','');
 }catch(err){
  if(button)button.disabled=false;
  let error=form.querySelector('.future-form-error');
  if(!error){error=document.createElement('p');error.className='future-form-error';error.setAttribute('role','alert');form.appendChild(error)}
  error.textContent=String(err.message||err);
 }
});
document.addEventListener('input',e=>{
 if(e.target.matches?.('[data-schedule-search]')){
  scheduleSearch=e.target.value;
  applyScheduleSearch(document.querySelector('#planner-main'));return;
 }
 if(e.target.matches?.('[data-history-link-search],[data-future-new-form] [name=merchant],'+
  '[data-future-edit-form] [name=merchant],[data-history-recurring-form] [name=merchant]')){
  const form=e.target.closest('form');updateHistoryLinks(form);
 }
});
document.addEventListener('change',async e=>{
 const quick=e.target.closest?.('[data-schedule-quick-category]');
 if(quick){
  const id=quick.dataset.scheduleQuickCategory,
   saved=(state().predictions?.futureRecurringRules||[]).find(rule=>String(rule.id)===String(id)),
   original=saved?.category||'Uncategorized',
   form=document.querySelector('[data-schedule-edit-form],[data-schedule-new-form]');
  if(!saved){quick.value=original;setNotice('Schedule changed. Refresh and try again.');return}
  if(quick.value===original)return;
  const dirty=form&&[...form.querySelectorAll('input,select,textarea')].some(field=>{
   if(field.type==='hidden')return false;
   if(field.type==='checkbox'||field.type==='radio')return field.checked!==field.defaultChecked;
   if(field.tagName==='SELECT')return [...field.options].some(o=>o.selected!==o.defaultSelected);
   return field.value!==field.defaultValue;
  });
  if(dirty&&!window.confirm('Discard unsaved schedule edits to change this category?')){
   quick.value=original;return;
  }
  quick.disabled=true;
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.setScheduleCategory(state(),id,quick.value));
   scheduleNotice='';
   render();
   [...document.querySelectorAll('[data-schedule-quick-category]')].find(el=>
    el.dataset.scheduleQuickCategory===id)?.focus({preventScroll:true});
  }catch(err){quick.disabled=false;quick.value=original;
   scheduleNotice='Could not save category: '+String(err.message||err);
   const note=document.querySelector('.future-notice');
   if(note)note.textContent=scheduleNotice;
   else{quick.insertAdjacentHTML('afterend','<span class="schedule-quick-error" role="alert">'+
    escapeHTML(scheduleNotice)+'</span>');}
  }
  return;
 }
 const sorter=e.target.closest?.('[data-schedule-sort]'),
  filter=e.target.closest?.('[data-schedule-category-filter]');
 if(sorter||filter){
  const nextSort=sorter?sorter.value:scheduleSort,
   nextFilter=filter?filter.value:scheduleCategoryFilter,
   edit=document.querySelector('[data-schedule-edit-form],[data-schedule-new-form]');
  const dirty=edit&&[...edit.querySelectorAll('input,select,textarea')].some(field=>{
   if(field.type==='hidden')return false;
   if(field.type==='checkbox'||field.type==='radio')return field.checked!==field.defaultChecked;
   if(field.tagName==='SELECT')return [...field.options].some(o=>o.selected!==o.defaultSelected);
   return field.value!==field.defaultValue;
  });
  if(dirty&&!window.confirm('Discard unsaved schedule edits to reorganize the list?')){
   e.target.value=sorter?scheduleSort:scheduleCategoryFilter;return;
  }
  scheduleSort=nextSort;scheduleCategoryFilter=nextFilter;
  scheduleMode='';scheduleTarget='';transactionDetail=null;render();return;
 }
 if(e.target.name==='separateSchedule'&&e.target.checked){
  const form=e.target.closest?.('[data-history-recurring-form]');
  // A second bill cannot claim the historical examples already associated
  // with its sibling merely because the payee name is identical.
  if(form&&recurringDraft?.sourceRow?.id){
   form.dataset.linkedExampleIds=JSON.stringify([String(recurringDraft.sourceRow.id)]);
   form.dataset.historyLinksChanged='1';
   updateHistoryLinks(form);
  }
  return;
 }
  if(e.target.matches?.('[data-schedule-type]')){
  const form=e.target.closest('form'),transfer=e.target.value==='transfer';
  form?.querySelectorAll('.schedule-transfer-account').forEach(el=>el.hidden=!transfer);
  const single=form?.querySelector('.schedule-single-account');if(single)single.hidden=transfer;
  return;
 }
 if(e.target.matches?.('[data-card-rule] [name=method],[data-card-rule] [name=autopayEnabled]')){
  configureCardFields(e.target.closest('[data-card-rule]'));return;
 }
 if(e.target.matches?.('[data-history-example]')){
  const form=e.target.closest('form'),chosen=checkedHistoryIds(form),
   id=e.target.value;
  if(e.target.checked)chosen.add(id);else chosen.delete(id);
  form.dataset.linkedExampleIds=JSON.stringify([...chosen]);
  form.dataset.historyLinksChanged='1';
  updateHistoryLinks(form);return;
 }
 if(e.target.matches?.('[data-new-history-link] [data-frequency]')){
  const form=e.target.closest('form'),holder=form?.querySelector('[data-new-history-link]');
  if(holder){holder.hidden=e.target.value==='once';updateHistoryLinks(form)}
 }
 if(e.target.matches?.('[data-history-link]')||e.target.name==='accountId'||
  e.target.name==='fromAccountId'||e.target.name==='type')updateHistoryLinks(e.target.closest('form'));
 if(e.target.id==='history-recurrence-type'){
  const form=e.target.closest('form'),transfer=e.target.value==='transfer';
  form?.querySelectorAll('.history-transfer-only').forEach(el=>el.hidden=!transfer);
  const single=form?.querySelector('.history-single-account');
  if(single)single.hidden=transfer;
  updateHistoryLinks(form);
  return;
 }
 if(e.target.name==='historyAccount'){
  historyAccount=e.target.value;historyLimit=90;render();return;
 }
 if(e.target.name==='scope'){
  const form=e.target.closest('[data-future-edit-form]');
  const impact=form?.closest('[data-inline-transaction-editor]')?.querySelector('[data-edit-impact]')||
   document.querySelector('[data-edit-impact]');
  if(impact)impact.textContent=e.target.value==='all'?
   'All future payments beginning with this date will change. Posted bank transactions are never changed.':
   'Only this dated payment will change. Other scheduled payments stay as they are.';
  const section=form?.querySelector('.future-repeat-fields');
  if(section)section.hidden=e.target.value!=='all';
  if(e.target.value==='all')updateHistoryLinks(form);
  return;
 }
 if(e.target.matches?.('[data-frequency]')){
  const form=e.target.closest('form');
  const second=form?.querySelector('.future-second-day');
  if(second)second.hidden=e.target.value!=='twice-monthly';
  const holder=form?.querySelector('[data-new-history-link]');
  if(holder){holder.hidden=e.target.value==='once';updateHistoryLinks(form)}
  return;
 }
 if(e.target.id==='transaction-filter'){
  transactionFilter=e.target.value;editingKey='';showNewTransaction=false;render();return;
 }
 if(e.target.id==='new-future-type'){
  const transfer=e.target.value==='transfer',form=e.target.closest('form');
  form?.querySelectorAll('.future-transfer-only').forEach(el=>el.hidden=!transfer);
  const ordinary=form?.querySelector('.new-standard-account');if(ordinary)ordinary.hidden=transfer;
  updateHistoryLinks(form);
  return;
 }
 if(e.target.id==='summary-account'){
  selectedAccount=e.target.value;render();return;
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
// /healthz reveals only the currently running server revision; a GitHub merge
// is never treated as proof that the private Render service deployed it.
if(typeof fetch==='function')fetch('/healthz',{cache:'no-store'}).then(async response=>{
 if(!response.ok)return null;
 const data=await response.json();
 return data?.commit&&/^[a-f0-9]{40}$/i.test(data.commit)?data.commit:null;
}).then(sha=>{
 const target=document.getElementById('deployment-version');
 if(target)target.textContent=sha?'Server revision '+sha.slice(0,9):'Server revision not verified';
}).catch(()=>{});
})();