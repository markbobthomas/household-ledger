/* Household Ledger · Planning-first UI.
 * Only read-only bank facts + derived forecasts. Saved planning settings stay in
 * the existing encrypted Real adjustments; no Real account data in localStorage.
 * Legacy spending/reporting UI remains on the separate backup branch.
 */
(function(){
'use strict';
const $=id=>document.getElementById(id);
const escapeHTML=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const cashFormatter=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
const cash=n=>n===null||n===undefined||!Number.isFinite(Number(n))?'Unavailable':
 cashFormatter.format(Number(n));
const dateToday=()=>new Date().toLocaleDateString('en-CA');
const dayLabel=date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
const dateLong=date=>new Date(date+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
 const warningThreshold=prefs=>{
  for(const v of [prefs?.warnBelow,prefs?.lowAlertThreshold,prefs?.cashCushion])
   if(v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0)return Number(v);
  return 500;
 };
const model=window.HouseholdLedgerData;
const available=()=>Boolean(window.HouseholdLiveSource);
const rawDemo=window.createHouseholdLedgerDemo?window.createHouseholdLedgerDemo():{transactions:[],items:[]};
const demoState=model.migrate(rawDemo);
const DEMO_SETTINGS='household-planner-sample-settings-v1';
try{
 const saved=JSON.parse(localStorage.getItem(DEMO_SETTINGS)||'{}');
 if(saved&&typeof saved==='object'&&!Array.isArray(saved)){
  const keys=['primaryAccountId','plannerRoutineDecisions','paymentRules','cashCushion','lowAlertThreshold','warnBelow',
    'futureTransactionEdits','futureTransactionAdds','futureSeriesEdits','futureRecurringRules','scheduleCategories','futureRecurrenceExclusions','mortgageReviewDismissals','historyPatternDecisions','mortgageCoverageRules','coverageAssignments','repeatingRecommendations','repeatingRecommendationDecisions','recurringForecastMode'];
  for(const key of keys)if(saved[key]!==undefined)demoState.predictions[key]=saved[key];
  if(saved.categoryOverrides&&typeof saved.categoryOverrides==='object'&&!Array.isArray(saved.categoryOverrides))
   demoState.categoryOverrides=saved.categoryOverrides;
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
// Derived data only. Source bank records and persisted predictions remain the
// authorities; this cache cannot be written to the bank or planning store.
let forecastCache=null;
// Memoized screen data; never persisted or used as the source of bank facts.
let futureRowsCache=null,reviewQueueCache=null;
let activeTab=window.HouseholdPlannerSummary?.render?'summary':'overview',transactionFilter='all',editingKey='',showNewTransaction=false,transactionNotice='',mortgageDraft=null;
let lastMissingMortgages=[],lastHistoryRows=[],lastReviewCandidates=[],lastRecommendedRepeating=[];
let reviewCatalogSave=Promise.resolve();
let historyAccount='all',historySearch='',historySort='newest',historyCategoryFilter='',historyLimit=90,recurringDraft=null,reviewNotice='';
let historyExpandedId='',historyExpandedAccount='',historyExpandedRuleId='';
let scheduleMode='',scheduleTarget='',schedulePreset=null,scheduleNotice='',scheduleRemoveTarget='';
let scheduleSort='order',scheduleCategoryFilter='',scheduleSearch='',scheduleAccount='all';
 let transactionDetail=null,detailReturnFocus=null,detailOriginTab=null,detailParentSchedule=null,planStopPending='';
let audit=null,auditAccount=null,auditError='',auditMeta=null;
function clearAudit(){audit=null;auditAccount=null;auditError='';auditMeta=null}
function savePlanning(){
 if(live())return window.HouseholdLiveSource.persistForecast(liveState.predictions||{})
 else {
  const p=demoState.predictions||{};
  localStorage.setItem(DEMO_SETTINGS,JSON.stringify({primaryAccountId:p.primaryAccountId,
   plannerRoutineDecisions:p.plannerRoutineDecisions,paymentRules:p.paymentRules,cashCushion:p.cashCushion,lowAlertThreshold:p.lowAlertThreshold,warnBelow:p.warnBelow,
   futureTransactionEdits:p.futureTransactionEdits,futureTransactionAdds:p.futureTransactionAdds,
   futureSeriesEdits:p.futureSeriesEdits,futureRecurringRules:p.futureRecurringRules,
   scheduleCategories:p.scheduleCategories,
   futureRecurrenceExclusions:p.futureRecurrenceExclusions,mortgageReviewDismissals:p.mortgageReviewDismissals,historyPatternDecisions:p.historyPatternDecisions,
    mortgageCoverageRules:p.mortgageCoverageRules,coverageAssignments:p.coverageAssignments,
    repeatingRecommendations:p.repeatingRecommendations,repeatingRecommendationDecisions:p.repeatingRecommendationDecisions,
    recurringForecastMode:p.recurringForecastMode,
    categoryOverrides:demoState.categoryOverrides||{}}));
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
function forecastFor(s){
 if(!s||!activeAccounts(s).length)return null;
 const source=state(),prefs=source.predictions||{};
 // The live bank adapter replaces the source state on every refresh. Saved
 // user choices edit the predictions object in place, so compare its CONTENT,
 // not just its identity. A new as-of day, balance, account, override or
 // category-learning decision must also recompute all projected balances.
 // Review history and Ignore flags change the queue, not bank-account balances.
 // Preserve every financial input while excluding these UI-only fields.
 const {repeatingRecommendations,repeatingRecommendationDecisions,...forecastPrefs}=prefs;
 const signature=JSON.stringify({
  snapshot:s,predictions:forecastPrefs,categoryOverrides:source.categoryOverrides,
  learning:source.learning,accounts:source.accounts
 });
 if(forecastCache&&forecastCache.source===source&&
    forecastCache.transactions===source.transactions&&
    forecastCache.signature===signature)return forecastCache.bundle;
 // The only planning entry point: normalize Plaid history, materialize one
 // editable future ledger, then calculate all balances from those entries.
 // Older inference and category forecast engines do not feed balances.
 const bundle=window.HouseholdFutureLedger.materialize(
  s,model.records(source),prefs,
  window.HouseholdPlannerTransactions,window.HouseholdPaymentObligations,horizon,
  {weekendPolicy:'friday'});
 forecastCache={source,transactions:source.transactions,signature,bundle};
 return bundle;
}
const shiftDay=window.HouseholdPlannerTransactions.shift;
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
 const safety=warningThreshold(state().predictions);
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
  '<p>No repeating payments currently qualify as confident dated forecasts for this account. Confirm a detected repeat below or add a card payment prediction.</p></div>';
 const first=records.slice(0,12),later=records.slice(12);
 const single=e=>{
  const day=derived.series.find(x=>x.date===e.date),ending=day?.balance;
  const income=eventDirection(e)==='incoming';
  const suffix=e.kind==='card_purchase'?'Expected card purchase':e.kind==='transfer_out'?'Payment or transfer':e.kind==='transfer_in'?'Payment or transfer':e.kind==='income'?'Expected deposit':e.kind==='card_refund'?'Card credit':'Expected withdrawal';
  return '<div class="payment-line" data-payment-date="'+escapeHTML(e.date)+'">'+
   '<div class="payment-date">'+escapeHTML(dayLabel(e.date))+'</div>'+
   '<div><div class="payment-name">'+escapeHTML(e.merchant||'Predicted movement')+'</div><div class="payment-meta">'+escapeHTML(suffix)+
    (tags.get(String(e.id))==='suggested'?' · SUGGESTED · confirm below':tags.get(String(e.id))==='confirmed'?' · Confirmed':' · Planned')+'</div></div>'+
   '<div class="payment-value '+(income?'incoming':'outgoing')+'">'+(income?'+':'−')+cash(e.amount)+'</div>'+
   '<div class="after-value"><strong class="'+(!freshness(derived)||!Number.isFinite(ending)?'':derived.type!=='credit'&&ending<warningThreshold(state().predictions)?'risk':'')+'">'+
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
  '<p>Only stable repeating bills and deposits are predicted. Unpredicted shopping and groceries are excluded.</p>'+
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
    ' specifically predicted card transactions in this period</summary>'+
    ((p.predictedTransactions||[]).length?p.predictedTransactions.map(t=>
     '<div class="card-actual-line"><span>'+escapeHTML(dayLabel(t.date))+
      ' · '+escapeHTML(t.merchant)+'</span><strong>'+
      (t.type==='refund'?'−':'')+cash(t.amount)+'</strong></div>').join(''):
     '<p>No future dated card transactions are predicted for this statement.</p>')+
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
    (configured?'<button type="button" class="btn" data-remove-card-rule="'+escapeHTML(a.id)+'">Remove prediction</button>':'')+
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
 if(futureRowsCache?.bundle===bundle&&futureRowsCache.asOf===s.asOf)
  return futureRowsCache.rows;
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
 rows.sort((a,b)=>a.date.localeCompare(b.date)||a.merchant.localeCompare(b.merchant)||a.key.localeCompare(b.key));
 futureRowsCache={bundle,asOf:s.asOf,rows};
 return rows;
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
  '<p class="audit-footnote">Choose previous deposits or bills that belong to THIS prediction, even if the amount or bank description differs. This prevents duplicate predictions. The app never changes the posted transactions.</p>'+
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
   '</fieldset>':
  '<fieldset class="future-scope"><legend>Apply changes to</legend>'+
  '<label><input type="radio" name="scope" value="one" checked> This payment only</label>'+
  '<label><input type="radio" name="scope" value="all"> This and future payments</label>'+
  '</fieldset>'+
  '<div class="future-repeat-fields" hidden>'+
   '<div class="future-fields"><label>Repeat frequency'+frequencyChoices(cadence)+'</label>'+
   '<label class="future-second-day"'+(cadence==='twice-monthly'?'':' hidden')+'>Second day of month (1–31)'+
    '<input type="number" name="secondDay" min="1" max="31" value="'+escapeHTML(selectedRule?.secondDay||15)+'"></label></div>'+
   historyLinkField()+
  '</div>';
 return '<form class="future-edit-form" data-future-edit-form="'+escapeHTML(row.key)+'">'+keys+
  scope+
  '<div class="future-fields">'+fields+'</div>'+
  '<p class="audit-footnote">Forecast only · Bank records unchanged.'+
   (isMovement?' Both linked accounts update.':'')+'</p>'+
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
 * and saved predictions. Never copy a projected transaction into a second
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
  '<div class="transaction-evidence-group"><strong>Predicted/recurring card transactions</strong><strong>'+cash(net(scheduled))+'</strong></div>'+
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
// The same forecast row component is rendered in Calendar, Predictions, Reviews
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
  '<span class="unified-payment-chevron" aria-hidden="true"><span class="payment-edit-cue">Edit</span><span class="payment-edit-arrow">⌄</span></span></button></div>';
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
  const source=rule?'Confirmed prediction':
   row.seriesKey?'Recurring forecast':row.addedId?'Manually added':
   row.source||'Predicted from available information';
  const impact='<div class="transaction-detail-info">'+
   '<div><span>Date</span><strong>'+escapeHTML(dayLabel(row.date))+'</strong></div>'+
   '<div><span>Account'+(linked?'s':'')+'</span><strong>'+escapeHTML(account)+'</strong></div>'+
   '<div><span>Forecast source</span><strong>'+escapeHTML(source)+'</strong></div>'+
   '<div><span>Expected amount</span><strong>'+cash(row.amount)+'</strong></div></div>'+
   '<p class="transaction-edit-impact" data-edit-impact>'+
   'This payment only: only this occurrence will change. Future predicted payments stay as they are.</p>';
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
   '<p class="transaction-detail-help">This is an actual bank record. Its amount, date and classification are read-only. To predict future occurrences, save a separate prediction below.</p>';
  return detailShell(row.merchant||'Bank transaction',
   'Bank history · '+cash(row.amount)+' · '+escapeHTML(dayLabel(row.date)),
   summary+(recurringDraft?repeatingReviewForm(s):'<p>Unable to create a prediction from this transaction.</p>'),
   'ACTUAL · BANK-RECORDED');
 }
 if(transactionDetail.kind==='history-choice'){
  const ids=transactionDetail.ids||[],
   rules=(state().predictions?.futureRecurringRules||[]).filter(r=>ids.includes(r.id)),
   options=rules.map(r=>'<button type="button" class="btn" data-choose-history-schedule="'+
    escapeHTML(r.id)+'">#'+scheduleListNumber(r.id)+' · '+
    escapeHTML(r.scheduleLabel||r.merchant||'Predicted payment')+
    ' · '+escapeHTML(r.frequency||'Recurring')+' · '+cash(r.amount)+'</button>').join(' ');
  return detailShell('Choose the existing prediction',
   'This posted payment may belong to more than one confirmed prediction.',
   '<p class="transaction-detail-help">No new prediction will be created. Choose which existing plan to inspect; similar payees and alternating income are kept separate.</p>'+
   (options||'<p>Those predictions changed. Refresh the bank history.</p>'),
   'BANK HISTORY · PREDICTION MATCH');
 }
 if(transactionDetail.kind==='schedule'){
  const rule=(state().predictions?.futureRecurringRules||[]).find(r=>r.id===transactionDetail.id);
  const isNew=transactionDetail.mode==='new',picked=transactionDetail.selectedKey||'';
  const edit=document.querySelector(isNew?'[data-schedule-new-form]':'[data-schedule-edit-form]');
  const editHtml=edit?.outerHTML||'<p>Prediction details are temporarily unavailable. Close and reopen the plan.</p>';
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
   '<summary><span>Prediction settings</span><small>Default dates, amount, account and repeat frequency</small></summary>'+
   '<div class="plan-settings-body"><p>Saving these settings updates the repeating plan. '+
    'Changes to one dated payment belong in the payment list below.</p>'+editHtml+'</div></details>';
  const stopable=!isNew&&rule?futureRows(bundle,s).find(r=>r.recurringRuleId===rule.id):null;
  const stopPlan=stopable?'<div class="plan-stop"><span>Need this payment to stop repeating? '+
   'Bank history and other unrelated plans remain unchanged.</span>'+
   '<button type="button" class="btn" data-stop-plan="'+escapeHTML(rule.id)+'">'+
   (planStopPending===rule.id?'Confirm stop repeating':'Stop repeating')+'</button></div>':'';
  // Legacy date-range estimates remain honored by the forecast engine, but
  // the editor only offers one payment or the entire repeating prediction.
  return detailShell(isNew?'New payment plan':(scheduleListNumber(rule?.id)?
   'Prediction '+scheduleListNumber(rule.id)+' · ':'')+
   (rule?.scheduleLabel||rule?.merchant||'Payment plan'),
   isNew?'Create a separate, repeating payment plan':
    picked?'One plan · editing a single predicted payment':
    'One plan · edit the repeating rule or a specific payment below',
   notice+'<p class="transaction-detail-help">'+(isNew?
    'Creating a plan generates future payments. You can modify each payment afterward.':
    'The prediction is the starting point. Specific payments can have their own exceptions. '+
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
  (rule||row.seriesKey?'Choose one payment or all future.':'This payment only.')+'</p>';
 const settings=rule?'<details class="inline-plan-settings">'+
  '<summary>More prediction settings <small>label, category, repeat rule</small></summary>'+
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
// Every future payment uses the same inline editor regardless of its entry
// point. Keep a same-page anchor for standalone buttons (e.g. card statements)
// instead of routing the user to a different tab or modal.
function openPrediction(key,origin){
 const s=snapshot(),bundle=forecastFor(s),
  row=futureRows(bundle,s).find(r=>r.key===String(key));
 if(!row){setNotice('This forecast changed. Select the updated payment and try again.');return}
 if(origin){
  let wrapper=origin.closest?.('[data-inline-row-wrapper]'),
   trigger=wrapper?.querySelector('[data-open-transaction]');
  if(!trigger&&origin.hasAttribute?.('data-open-transaction')&&wrapper)
   trigger=origin;
  if(!wrapper&&origin.parentElement){
   let host=origin.nextElementSibling;
   if(!host?.matches?.('[data-standalone-inline]')){
    host=document.createElement('div');
    host.className='standalone-inline-editor';
    host.dataset.standaloneInline='';
    origin.insertAdjacentElement('afterend',host);
   }
   host.dataset.inlineRowWrapper='';
   host.dataset.paymentKey=String(key);
   let proxy=host.querySelector('[data-open-transaction]');
   if(!proxy){
    proxy=document.createElement('button');
    proxy.type='button';proxy.hidden=true;proxy.dataset.openTransaction=String(key);
    host.appendChild(proxy);
   }
   wrapper=host;trigger=proxy;
  }
  if(trigger&&openInlineTransaction(trigger))return;
 }
 // Defensive fallback only for programmatic callers without a visible row.
 transactionDetail={kind:'prediction',key:String(key)};
 detailReturnFocus=origin||null;
 try{drawTransactionDetail(bundle,s)}
 catch(err){transactionDetail=null;setNotice(String(err.message||err))}
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
     escapeHTML(m.id)+'">Review and predict</button>'+
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
  '</div><label class="schedule-separate-choice"><input type="checkbox" name="separateSchedule"> Additional independent bill or paycheck from this merchant</label>'+
  (preset?'<p class="audit-footnote">Check the proposed due date against your mortgage documents.</p>':'')+
  '<div class="future-history-container" data-new-history-link hidden>'+historyLinkField()+'</div>'+
  '<div class="future-form-actions"><button class="btn primary" type="submit">Add to forecast</button>'+
  '<button class="btn" type="button" data-cancel-new>Cancel</button></div></form>';
}

function scheduleMatchWindowFields(r={}){
 const value=name=>r[name]===undefined||r[name]===null?'':String(r[name]);
 const days=window.HouseholdPlannerTransactions.matchWindow(r);
 return '<fieldset class="schedule-match-window">'+
  '<legend>Bank matching window</legend>'+
  '<p class="audit-footnote">Use these limits to match the bank payment to this repeating prediction. '+
  'They do not change the planned amount or payment date. Leave blank for automatic dates or any amount.</p>'+
  '<div class="future-fields">'+
  '<label>Days early<input name="matchDaysBefore" type="number" min="0" max="14" step="1" '+
   'placeholder="Auto: '+days.before+'" value="'+escapeHTML(value('matchDaysBefore'))+'"></label>'+
  '<label>Days late<input name="matchDaysAfter" type="number" min="0" max="14" step="1" '+
   'placeholder="Auto: '+days.after+'" value="'+escapeHTML(value('matchDaysAfter'))+'"></label>'+
  '<label>Minimum amount ($)<input name="matchAmountMin" type="number" min="0" max="999999999" step=".01" '+
   'placeholder="Any" value="'+escapeHTML(value('matchAmountMin'))+'"></label>'+
  '<label>Maximum amount ($)<input name="matchAmountMax" type="number" min="0" max="999999999" step=".01" '+
   'placeholder="Any" value="'+escapeHTML(value('matchAmountMax'))+'"></label>'+
  '</div></fieldset>';
}
function scheduleFields(r,isNew,s){
 const accounts=activeAccounts(s),tomorrow=shiftDay(s.asOf,1),
  type=r.kind==='movement'?'transfer':r.type||'expense',
  transfer=(isNew&&type==='transfer')||r.kind==='movement',
  accountId=r.accountId||r.fromAccountId||selected(s)?.id||accounts[0]?.id,
  categories=window.HouseholdPlannerTransactions.scheduleCategories(state()),
  category=model.canonicalCategory(state(),r.category)||'Uncategorized',
  scheduledDate=r.date||tomorrow,
  postedDate=window.HouseholdPlannerTransactions.forecastBusinessDate(scheduledDate,s.asOf),
  unresolvedDirection=!transfer&&type==='transfer'&&!['in','out'].includes(r.cashDirection);
 // Friendly name is not the source bank merchant's matching identity.
 return '<div class="future-fields schedule-primary-fields">'+
  '<label>Name<input name="scheduleLabel" maxlength="110" required placeholder="e.g. Water — House" value="'+escapeHTML(r.scheduleLabel||r.merchant||'')+'"></label>'+
  '<label>Amount ($)<input name="amount" type="number" min=".01" max="999999999" step=".01" required value="'+escapeHTML(r.amount??'')+'"></label>'+
  '<label>Next date<input name="date" type="date" min="'+tomorrow+'" max="'+escapeHTML(shiftDay(s.asOf,horizon))+'" required value="'+escapeHTML(scheduledDate)+'">'+
  '<small class="schedule-posting-date" data-schedule-posting-date'+(postedDate===scheduledDate?' hidden':'')+'>'+
   (postedDate===scheduledDate?'':'On Calendar: '+escapeHTML(dateLong(postedDate)))+'</small></label>'+
  '<label>Repeat'+frequencyChoices(r.frequency||'monthly')+'</label>'+
  '<label class="schedule-single-account"'+(transfer?' hidden':'')+'>Account'+accountSelect(accounts,accountId,'accountId')+'</label>'+
  '<label class="schedule-transfer-account"'+(transfer?'':' hidden')+'>From account'+accountSelect(accounts,accountId,'fromAccountId')+'</label>'+
  '</div><details class="schedule-advanced" data-schedule-advanced'+(transfer||r.frequency==='twice-monthly'||unresolvedDirection?' open':'')+'>'+
  '<summary>More options</summary><div class="future-fields">'+
  (isNew?'<label>Type<select name="type" data-schedule-type>'+
   [['expense','Withdrawal'],['income','Deposit'],['refund','Refund'],['transfer','Linked transfer']].map(([v,name])=>
    '<option value="'+v+'"'+(type===v?' selected':'')+'>'+name+'</option>').join('')+'</select></label>':
   '<input type="hidden" name="type" value="'+escapeHTML(type)+'">')+
  (!transfer&&type==='transfer'?'<label>External payment direction<select name="cashDirection" required>'+
   '<option value=""'+(!r.cashDirection?' selected':'')+'>Choose direction</option>'+
   '<option value="out"'+(r.cashDirection==='out'?' selected':'')+'>Money out</option>'+
   '<option value="in"'+(r.cashDirection==='in'?' selected':'')+'>Money in</option>'+
   '</select></label>':'')+
  '<label>Bank merchant<input name="merchant" maxlength="160"'+(isNew?'':' required')+' value="'+escapeHTML(r.merchant||'')+'"></label>'+
  '<label>Category<select name="category">'+categories.map(c=>
   '<option value="'+escapeHTML(c)+'"'+(c===category?' selected':'')+'>'+escapeHTML(c)+'</option>').join('')+'</select></label>'+
  '<label>Amount type<select name="amountBasis"><option value="estimate"'+(r.amountBasis==='estimate'?' selected':'')+'>Variable / estimated</option>'+
   '<option value="fixed"'+(r.amountBasis!=='estimate'?' selected':'')+'>Fixed</option></select></label>'+
  '<label class="schedule-transfer-account"'+(transfer?'':' hidden')+'>To account'+
   accountSelect(accounts,r.toAccountId||accounts.find(a=>String(a.id)!==accountId)?.id||accountId,'toAccountId')+'</label>'+
  '<label class="future-second-day"'+(r.frequency==='twice-monthly'?'':' hidden')+
   '>Second day<input type="number" name="secondDay" min="1" max="31" value="'+escapeHTML(r.secondDay||15)+'"></label>'+
  '</div>'+scheduleMatchWindowFields(r)+'</details>';
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
   shown={out:0,in:0,transfers:0,unforecasted:0,unforecastedCents:0};
  if(count)count.textContent='('+rows.length+')';
  for(const row of rows){
   const kind=row.dataset.scheduleListedKind,
    cents=Number(row.dataset.scheduleListedCents);
   if(kind==='unforecasted'){
    shown.unforecasted++;
    if(Number.isSafeInteger(cents)&&cents>0)shown.unforecastedCents+=cents;
   }else if(['out','in','transfers'].includes(kind)&&Number.isSafeInteger(cents)&&cents>0)
    shown[kind]+=cents;
  }
  if(total)total.textContent='Total shown: '+formatScheduleTotals(shown);
 }
 const count=root.querySelector('[data-schedule-visible-count]');
 if(count){
  const total=Number(count.dataset.scheduleTotalCount)||0;
  count.textContent='Showing '+shown+' of '+total+' repeating transaction'+
   (total===1?'':'s');
 }
 for(const row of root.querySelectorAll('[data-statement-occurrence]')){
  row.hidden=!!q&&!String(row.dataset.scheduleSearchText||'').includes(q);
 }
 for(const group of root.querySelectorAll('[data-repeating-statement-group]')){
  const rows=[...group.querySelectorAll('[data-statement-occurrence]')].filter(r=>!r.hidden);
  group.hidden=rows.length===0;
  const divider=group.querySelector('[data-statement-divider]');
  if(divider){
   const total=rows.reduce((n,row)=>n+Number(row.dataset.statementCents||0),0);
   divider.querySelector('.ledger-statement-total').textContent='Net charges '+cash(total/100);
   const summary=divider.querySelector('small');
   if(summary)summary.textContent=summary.textContent.replace(/ · \d+ repeating charges?$/,
     ' · '+rows.length+' repeating charge'+(rows.length===1?'':'s'));
  }
 }
 const empty=root.querySelector('[data-schedule-search-empty]');
 if(empty)empty.hidden=shown!==0||!q;
}
// The category total adds one displayed amount per scheduled row, not the
// payments in a single calendar month. Weekend-adjusted November 1 bills can
// land in October; this heading should never imply they have a $0 value.
function scheduleListedKind(rule,forecast){
 // If the app cannot forecast a listed schedule, still total its displayed
 // face amount, but DO NOT claim it will withdraw/deposit on the calendar.
 if(!forecast)return 'unforecasted';
 if(rule.kind==='movement')return 'transfers';
 if(rule.type==='transfer')return ['in','out'].includes(rule.cashDirection)?
  rule.cashDirection:'unforecasted';
 return ['income','refund'].includes(rule.type)?'in':'out';
}
function scheduleListedTotals(items,amountForRule,forecastForRule){
 const total={out:0,in:0,transfers:0,unforecasted:0,unforecastedCents:0};
 for(const {rule} of items){
  const kind=scheduleListedKind(rule,forecastForRule(rule)),
   cents=Math.round(Number(amountForRule(rule))*100);
  if(kind==='unforecasted'){
   total.unforecasted++;
   if(Number.isSafeInteger(cents)&&cents>0)total.unforecastedCents+=cents;
  }else if(Number.isSafeInteger(cents)&&cents>0)total[kind]+=cents;
 }
 return total;
}
function formatScheduleTotals(total){
 const parts=[];
 for(const [kind,label] of [['out','Out'],['in','In'],['transfers','Transfers']])
  if(total[kind])parts.push(label+' '+cash(total[kind]/100));
 if(total.unforecasted)parts.push('Not forecast '+
  (total.unforecastedCents?cash(total.unforecastedCents/100)+' ':'')+
  '('+total.unforecasted+')');
 return parts.join(' · ')||'$0';
}
function scheduleCategorySummary(items,amountForRule,forecastForRule){
 return 'Total shown: '+
  formatScheduleTotals(scheduleListedTotals(items,amountForRule,forecastForRule));
}
// Shared three-part amount grid: sign, fixed-position dollar glyph, digits.
function ledgerMoney(amount,sign=''){
 return '<span class="ledger-money">'+
  '<span class="ledger-money-sign" aria-hidden="true">'+escapeHTML(sign)+'</span>'+
  '<span class="ledger-money-dollar">$</span>'+
  '<span class="ledger-money-digits">'+escapeHTML(cash(amount).replace('$',''))+'</span>'+
  '</span>';
}
// Statement cycles are display-only. Never count linked card payments as
// purchases or equate a net-activity subtotal with an issued statement.
function cardStatementPeriod(accountId,when){
 return window.HouseholdPaymentObligations.statementPeriodFor(
  state().predictions?.paymentRules?.[accountId],when);
}
function cardActivityCents(row){
 // The History statement total is purchases minus merchant refunds only.
 // A paired card payment is never a new purchase, even if an earlier
 // provisional import called that card credit a refund.
 if(row.pending||row.pairedTransactionId||
  ['card_payment','internal_transfer'].includes(row.accountingKind)||
  !['expense','refund'].includes(row.type))return 0;
 const cents=Math.round(Math.abs(Number(row.amount))*100);
 if(!Number.isFinite(cents))return 0;
 return row.type==='refund'?-cents:cents;
}
function statementHeading(period,total,count,kind){
 return '<div class="ledger-statement-divider" data-statement-divider="'+escapeHTML(period.end)+
  '" data-statement-kind="'+escapeHTML(kind)+'">'+
  '<strong>Statement closes '+escapeHTML(dateLong(period.end))+'</strong>'+
  '<small>'+escapeHTML(dayLabel(period.start))+' – '+escapeHTML(dayLabel(period.end))+
  ' · '+count+' '+(kind==='repeating'?'repeating charge':'posted charge/refund')+
  (count===1?'':'s')+'</small>'+
  '<span class="ledger-statement-total">Net charges '+cash(total/100)+'</span></div>';
}
function repeatingStatementPeriods(bundle,s,accountId,shownRules){
 const rule=state().predictions?.paymentRules?.[accountId];
 if(!rule?.billingEndDate&&!rule?.lastStatementClose)
  return '<p class="ledger-statement-help">Set this card’s billing period in Settings to see statement totals.</p>';
 const ids=new Set(shownRules.map(({rule})=>String(rule.id)));
 const searchOf=row=>{
  const saved=shownRules.find(x=>String(x.rule.id)===String(row.recurringRuleId))?.rule;
  return [row.merchant,saved?.scheduleLabel,saved?.category].filter(Boolean).join(' ').toLowerCase();
 };
 const end=shiftDay(s.asOf,90),groups=new Map();
 const rows=futureRows(bundle,s).filter(row=>row.kind==='event'&&
  String(row.accountId)===String(accountId)&&ids.has(String(row.recurringRuleId||''))&&
  row.date>s.asOf&&row.date<=end&&['expense','refund'].includes(row.type));
 for(const row of rows){
  const period=cardStatementPeriod(accountId,row.date);if(!period)continue;
  if(!groups.has(period.end))groups.set(period.end,{period,rows:[]});
  groups.get(period.end).rows.push(row);
 }
 const content=[...groups.values()].sort((a,b)=>a.period.end.localeCompare(b.period.end))
  .map(({period,rows})=>{
   const total=rows.reduce((sum,row)=>sum+cardActivityCents(row),0);
   return '<section class="ledger-statement-group" data-repeating-statement-group="'+escapeHTML(period.end)+'">'+
    statementHeading(period,total,rows.length,'repeating')+
    rows.map(row=>'<div class="ledger-statement-occurrence" data-statement-occurrence '+
     'data-statement-cents="'+cardActivityCents(row)+'" data-schedule-search-text="'+
     escapeHTML(searchOf(row))+'">'+
     '<button type="button" data-open-transaction="'+escapeHTML(row.key)+'">'+
     '<span>'+escapeHTML(dayLabel(row.date))+'</span><strong>'+escapeHTML(row.merchant)+'</strong>'+
     '<span>'+cash(row.amount)+'</span><span aria-hidden="true">›</span></button></div>').join('')+'</section>';
  }).join('');
 return '<section class="ledger-statement-periods schedule-statement-periods" data-repeating-statement-periods>'+
  '<p class="ledger-statement-intro">Next 90 days · repeating card charges only · estimates, not issued statements</p>'+
  (content||'<p class="ledger-statement-help">No repeating charges are forecast for this card in the next 90 days.</p>')+
  '</section>';
}
function schedulesPage(bundle,s){
 const accounts=activeAccounts(s),rules=state().predictions?.futureRecurringRules||[],
  T=window.HouseholdPlannerTransactions,end=shiftDay(s.asOf,horizon),
  tomorrow=shiftDay(s.asOf,1),
  categories=T.scheduleCategories(state()),
  categoryOf=r=>model.canonicalCategory(state(),r.category)||'Uncategorized';
 // Canonical prediction rows already include weekend-to-Friday posting,
 // individual date overrides and skipped occurrences. Show their actual dates
 // here; keep raw recurrence dates solely in the prediction-default editor.
 const upcomingByRule=new Map();
 for(const row of futureRows(bundle,s)){
  if(row.recurringRuleId&&!upcomingByRule.has(String(row.recurringRuleId)))
   upcomingByRule.set(String(row.recurringRuleId),row);
 }
 const indexed=rules.map((rule,index)=>({rule,index}));
 const visible=indexed.filter(({rule})=>
  (scheduleAccount==='all'||[rule.accountId,rule.fromAccountId,rule.toAccountId]
   .some(id=>String(id||'')===scheduleAccount))&&
  (!scheduleCategoryFilter||categoryOf(rule)===scheduleCategoryFilter));
 const nextAmount=rule=>{
  const forecast=upcomingByRule.get(String(rule.id));
  if(forecast)return Number(forecast.amount);
  const next=T.recurrenceDates(rule,s.asOf,end)[0];
  return next?Number(T.scheduleAmount(rule,next).amount):Number(rule.amount)||0;
 };
 visible.sort((a,b)=>scheduleSort==='value-desc'?
  nextAmount(b.rule)-nextAmount(a.rule)||a.index-b.index:
  scheduleSort==='value-asc'?
   nextAmount(a.rule)-nextAmount(b.rule)||a.index-b.index:
  scheduleSort==='category'?
   categoryOf(a.rule).localeCompare(categoryOf(b.rule))||a.index-b.index:
  a.index-b.index);
 const fields=(r,isNew)=>scheduleFields(r,isNew,s);
 const create=scheduleMode==='new'?'<section class="schedule-creation recurrence-inline-detail" data-schedule-create-inline>'+
  recurringEditor('<form class="schedule-form" data-schedule-new-form>'+
   
  '<input name="separateSchedule" type="hidden" value="on">'+
  (schedulePreset?.historyExampleId?'<input type="hidden" name="historyExampleId" value="'+escapeHTML(schedulePreset.historyExampleId)+'">':'')+
  fields({...schedulePreset,amountBasis:schedulePreset?.amountBasis||'estimate'},true)+
  '<div class="future-form-actions"><button class="btn primary" type="submit">Save recurring forecast</button>'+
  '<button class="btn" type="button" data-schedule-close>Cancel</button></div></form>','schedule')+
  '</section>':'';
 const cardHtml=({rule:r,index})=>{
  const id=escapeHTML(r.id),planOpen=transactionDetail?.kind==='schedule'&&
   transactionDetail.id===r.id,
   isEditing=(scheduleMode==='edit'||planOpen)&&scheduleTarget===r.id,
   dates=T.recurrenceDates(r,s.asOf,end),next=dates[0],
   occurrence=upcomingByRule.get(String(r.id)),
   effectiveNext=occurrence?.date||null,
   estimate=next?T.scheduleAmount(r,next):{amount:r.amount,estimated:r.amountBasis==='estimate'},
   shownAmount=nextAmount(r),
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
   listedKind=scheduleListedKind(r,occurrence),
   listedCents=Math.round(Number(shownAmount)*100),
   searchText=[r.scheduleLabel,r.merchant,categoryOf(r)].filter(Boolean).join(' ').toLowerCase();
  return '<article class="panel schedule-card" data-schedule-card="'+id+
   '" data-schedule-number="'+number+'" data-schedule-search-text="'+escapeHTML(searchText)+
   '" data-schedule-listed-kind="'+listedKind+
   '" data-schedule-listed-cents="'+(Number.isSafeInteger(listedCents)?listedCents:0)+'">'+
   '<div class="schedule-compact-row ledger-list-row recurrence-row">'+
   '<button class="schedule-row-main ledger-row-open recurrence-row-trigger" type="button" data-schedule-edit="'+id+
    '" aria-expanded="'+isEditing+'" aria-label="'+(isEditing?'Close':'Open')+
    ' prediction '+number+': '+title+'">'+
    '<span class="schedule-row-next ledger-row-date"><span>'+
     (effectiveNext?escapeHTML(dayLabel(effectiveNext)):'Not forecast')+'</span></span>'+
    '<span class="schedule-row-identity ledger-row-description recurrence-row-name"><span class="schedule-number" aria-hidden="true">'+number+
     '</span><span class="schedule-row-title"><strong>'+title+'</strong>'+
     '<small>'+(String(r.scheduleLabel||r.merchant)===String(r.merchant)?'':
      escapeHTML(r.merchant)+' · ')+escapeHTML(account?.name||'Account')+
      ' · '+escapeHTML(r.frequency)+' · '+(estimate.estimated?'Estimated':'Fixed')+
      '</small></span></span>'+
    '<span class="schedule-row-amount ledger-row-amount"><strong>'+
     ledgerMoney(shownAmount)+'</strong></span>'+
    '<span class="schedule-row-chevron ledger-row-hint" aria-hidden="true">'+
     (isEditing?'⌃':'›')+'</span>'+
   '</button>'+
   '<div class="ledger-row-category-wrap"><select class="schedule-row-category ledger-row-category" data-schedule-quick-category="'+id+'" '+
    'aria-label="Category for prediction '+number+': '+title+'">'+
    categories.map(category=>'<option value="'+escapeHTML(category)+'"'+
     (category===categoryOf(r)?' selected':'')+'>'+escapeHTML(category)+'</option>').join('')+
   '</select></div>'+
   '<details class="schedule-more"'+(pendingRemove?' open':'')+'>'+
    '<summary aria-label="More actions for prediction '+number+'" title="More actions">⋯</summary>'+
    '<div class="schedule-more-menu">'+
     '<button type="button" data-schedule-remove="'+id+'"'+
      (pendingRemove?' class="danger"':'')+'>'+
      (pendingRemove?'Confirm remove':'Remove prediction')+'</button>'+
     (pendingRemove?'<button type="button" data-schedule-cancel-remove>Cancel</button>':'')+
    '</div></details></div>'+
   '<div class="schedule-card-detail">'+
   (wins.length?'<details class="schedule-legacy-windows"><summary>'+wins.length+
    ' previously saved amount exception'+(wins.length===1?'':'s')+'</summary>'+
    '<p>Older date-range estimates are still included so your balances do not change unexpectedly. '+
    'You can clear an old rule or change a specific payment below. '+
    'Changing the repeating amount for all future payments will replace these older rules.</p>'+
    windows+'</details>':'')+
   (isEditing?'<div class="schedule-inline-plan recurrence-inline-detail" data-schedule-inline-plan="'+id+'">'+
     recurringEditor(edit,'schedule')+
     (occurrence?'<button class="btn schedule-calendar-jump" type="button" data-schedule-view-calendar="'+id+
       '">View '+escapeHTML(dayLabel(occurrence.date))+' in Calendar</button>':
      '<p class="schedule-no-forecast" role="status">This payment is not in the forecast. Check the account, transfer direction, or skipped payments.</p>')+
     '<details class="schedule-occurrence-disclosure"><summary>Upcoming payments</summary>'+
      scheduleOccurrencesHtml(bundle,s,r)+'</details></div>':'')+'</div></article>';
 };
 const cards=scheduleSort==='category'?
  [...new Set(visible.map(({rule})=>categoryOf(rule)))].map(category=>{
   const items=visible.filter(({rule})=>categoryOf(rule)===category);
   return '<section class="schedule-category-group" data-schedule-category-group="'+escapeHTML(category)+'">'+
    '<div class="schedule-category-heading"><strong>'+escapeHTML(category)+
    ' <small data-schedule-group-count>('+items.length+')</small></strong><span data-schedule-group-total>'+
    scheduleCategorySummary(items,nextAmount,rule=>upcomingByRule.get(String(rule.id)))+'</span></div>'+
    items.map(cardHtml).join('')+'</section>';
  }).join(''):
  visible.map(cardHtml).join(''); 
 return '<div class="planner-page schedule-page">'+
  '<div class="schedule-toolbar ledger-toolbar" aria-label="Prediction organization">'+
   '<label class="schedule-search-wrap">Find <input data-schedule-search type="search" '+
    'autocomplete="off" placeholder="Name, merchant, category" value="'+escapeHTML(scheduleSearch)+'"></label>'+
   '<label>Account'+accountSelect(accounts,scheduleAccount,'scheduleAccount',true)+'</label>'+
    '<label>Sort by <select data-schedule-sort>'+
    [['order','Original order'],['value-desc','Amount: high to low'],
     ['value-asc','Amount: low to high'],['category','Category']].map(([v,l])=>
     '<option value="'+v+'"'+(scheduleSort===v?' selected':'')+'>'+l+'</option>').join('')+
   '</select></label>'+
   '<div class="schedule-category-controls"><label>Category <select data-schedule-category-filter><option value="">All categories</option>'+
    categories.map(c=>'<option value="'+escapeHTML(c)+'"'+
     (scheduleCategoryFilter===c?' selected':'')+'>'+escapeHTML(c)+'</option>').join('')+
   '</select></label>'+
   '<details class="schedule-category-manager" data-schedule-category-manager>'+
    '<summary title="Add category" aria-label="Add category">+</summary>'+
    '<form data-schedule-category-add><label>New category<input name="categoryName" maxlength="40" '+
    'placeholder="e.g. Pet care" required></label>'+
    '<button type="submit" class="btn">Add</button></form>'+
    '<p data-schedule-category-notice role="status"></p></details></div>'+
   '<button class="btn ledger-add-repeating" type="button" data-schedule-new aria-label="Add repeating payment" title="Add repeating payment">+ Repeating payment</button></div>'+
  (scheduleNotice?'<p class="future-notice" role="status">'+escapeHTML(scheduleNotice)+'</p>':'')+
  create+'<div class="schedule-grid">'+
   '<p class="ledger-list-count schedule-list-count" data-schedule-visible-count '+
    'data-schedule-total-count="'+rules.length+'">Showing '+visible.length+
    ' of '+rules.length+' repeating transaction'+(rules.length===1?'':'s')+'</p>'+
   (scheduleAccount!=='all'&&accountType(accounts.find(a=>String(a.id)===scheduleAccount)||{})==='credit'?
      repeatingStatementPeriods(bundle,s,scheduleAccount,visible):'')+
   (cards||'<section class="panel">No predictions match. Change the filter or create a prediction.</section>')+
   '</div><p data-schedule-search-empty hidden class="schedule-search-empty">'+
   'No matching predictions. Try a different search.</p>'+
   '</div>';
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

function recurrenceFormDirty(selector){
 const form=document.querySelector(selector);
 if(!form)return false;
 return [...form.querySelectorAll('input,select,textarea')].some(input=>{
  if(input.type==='hidden')return false;
  if(input.type==='checkbox'||input.type==='radio')return input.checked!==input.defaultChecked;
  if(input.tagName==='SELECT')return [...input.options].some(o=>o.selected!==o.defaultSelected);
  return input.value!==input.defaultValue;
 });
}
function reviewFormDirty(){
 return recurrenceFormDirty('.reviews-page [data-review-inline-detail] [data-history-recurring-form]');
}
// Shared inline form shell; page-specific fields and actions remain independent.
function recurringEditor(html,variant='review'){
 return '<div class="recurrence-editor recurrence-editor--'+variant+'">'+html+'</div>';
}
function repeatingReviewForm(s,{inline=false}={}){
 if(!recurringDraft)return '';
 const d=recurringDraft,accounts=activeAccounts(s),
  categories=window.HouseholdPlannerTransactions.scheduleCategories(state()),
  category=model.canonicalCategory(state(),d.category)||'Uncategorized',
  date=d.nextDate&&d.nextDate>s.asOf?d.nextDate:shiftDay(s.asOf,1),
  transfer=d.type==='transfer',
  otherAccount=accounts.find(a=>String(a.id)!==String(d.accountId))?.id||d.accountId;
 const from=d.fromAccountId||d.accountId,to=d.toAccountId&&d.toAccountId!==from?
  d.toAccountId:otherAccount;
 return '<form class="panel history-schedule-form" data-history-recurring-form>'+
  (inline?'':
   '<div class="section-title"><h2>Confirm recurring transaction</h2><span class="status-tag">FORECAST ONLY</span></div>'+
   '<p class="lead">Review the suggested prediction. Bank records stay unchanged.</p>')+
  (d.sourceRow?.type==='transfer'&&!transfer?
   '<p class="history-type-explanation">The bank labeled this as a transfer without a confirmed matching household account. An outgoing ACH debit, such as a mortgage, is proposed as an expense. Change the future type if needed.</p>':'')+
  (d.sourcePending?'<p class="history-type-explanation">This bank transaction is pending; its date or amount may change. Review both before saving a prediction.</p>':'')+
  '<div class="future-fields">'+
  '<label>Merchant<input name="merchant" maxlength="160" required value="'+escapeHTML(d.merchant)+'"></label>'+
  '<label>Category<select name="category">'+
   categories.map(c=>'<option value="'+escapeHTML(c)+'"'+(c===category?' selected':'')+'>'+
    escapeHTML(c)+'</option>').join('')+'</select></label>'+
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
  '<details class="schedule-advanced"><summary>Bank matching window</summary>'+
  scheduleMatchWindowFields(d)+'</details>'+
  historyLinkField(d.examples||[])+
  '<label class="schedule-separate-choice"><input type="checkbox" name="separateSchedule"> Create a separate bill even if another prediction shares this payee/date</label>'+
  '<p class="audit-footnote">For actual account-to-account transfers, select Transfer and two connected accounts. Otherwise use Expense or Deposit. Only the future forecast changes; the original bank record is never edited or duplicated.</p>'+
  '<div class="future-form-actions"><button type="submit" class="btn primary">Save recurring forecast</button>'+
  '<button type="button" class="btn" data-cancel-review-form>Cancel</button></div></form>';
}
function historyPage(bundle,s){
 const accounts=activeAccounts(s),
  records=(bundle?.rows||[]).filter(x=>x.date&&x.date<=s.asOf)
  .map(t=>({...t,category:model.canonicalCategory(state(),t.category)||t.category||'Other'}))
  .sort((a,b)=>b.date.localeCompare(a.date)||String(b.id).localeCompare(String(a.id))),
  // Both filters and row editors consult the same canonical category registry.
  // Effective provider labels are included as read-only observed names; they
  // are not saved as duplicate registry entries.
  categories=model.categories(state(),records.map(t=>t.category)),
  filterCategories=categories;
 const filtered=records.filter(t=>{
  const aid=window.HouseholdPlannerHistory.accountOf(t,accounts);
  if(historyAccount!=='all'&&historyAccount!==aid)return false;
  if(historyCategoryFilter&&String(t.category||'Other')!==historyCategoryFilter)return false;
  if(!historySearch)return true;
  return [t.merchant,t.description,t.date,t.category,t.account,t.amount]
   .some(v=>String(v||'').toLowerCase().includes(historySearch.toLowerCase()));
 });
 // Sort only the visible bank-history presentation after account/search filtering.
 // No bank record, forecast, category override or scheduled cash flow changes.
 const textOf=t=>String(t.merchant||t.description||'').toLocaleLowerCase(),
  amountOf=t=>Math.abs(Number(t.amount)||0),
  dateDesc=(a,b)=>String(b.date||'').localeCompare(String(a.date||''))||
   String(b.id||'').localeCompare(String(a.id||''));
 filtered.sort((a,b)=>historySort==='oldest'?-dateDesc(a,b):
  historySort==='amount-desc'?amountOf(b)-amountOf(a)||dateDesc(a,b):
  historySort==='amount-asc'?amountOf(a)-amountOf(b)||dateDesc(a,b):
  historySort==='merchant'?textOf(a).localeCompare(textOf(b))||dateDesc(a,b):
  historySort==='category'?String(a.category||'').localeCompare(String(b.category||''))||
   textOf(a).localeCompare(textOf(b))||dateDesc(a,b):
  dateDesc(a,b));
 const visible=filtered.slice(0,historyLimit),label=id=>accounts.find(a=>String(a.id)===id)?.name||id;
 const selectedHistoryCard=historyAccount==='all'?null:
  accounts.find(a=>String(a.id)===historyAccount&&accountType(a)==='credit');
 const groupHistoryCard=Boolean(selectedHistoryCard&&
  (state().predictions?.paymentRules?.[historyAccount]?.billingEndDate||
   state().predictions?.paymentRules?.[historyAccount]?.lastStatementClose));
 const savedRules=state().predictions?.futureRecurringRules||[];
 const projections=futureRows(bundle,s);
 const rowMarkup=visible.map(t=>{
  const aid=window.HouseholdPlannerHistory.accountOf(t,accounts);
  const incoming=['income','refund'].includes(t.type)||
   t.type==='transfer'&&t.cashDirection==='in';
  const tools=window.HouseholdPlannerTransactions,
   matches=tools.historicalScheduleMatches(t,accounts,savedRules),
   ambiguous=matches.length>1,kind=tools.bankDirection(t),
   predicted=projections.some(r=>r.kind==='event'&&String(r.id||'').startsWith('auto|')&&
    String(r.sourceAccountId||r.accountId)===aid&&r.sourceType===kind&&
    tools.recurrenceKey(aid,kind,r.sourceMerchant)===
     tools.recurrenceKey(aid,kind,t.merchant||t.name)),
   canPlan=window.HouseholdPlannerHistory.canPlan(t),
   status=matches.length?'confirmed':predicted?'automatic':'unplanned',
   caption=status==='confirmed'?(ambiguous?'Several repeating plans':'Repeating plan saved'):
    status==='automatic'?'Unconfirmed estimate — check the Review tab':'Not predicted',
   primary=status==='confirmed'?(ambiguous?'Choose plan':'Edit plan'):
    canPlan?(status==='automatic'?'Confirm repeating':'Add repeating'):'View bank record',
   isExpanded=historyExpandedId===String(t.id)&&historyExpandedAccount===aid,
   editRule=isExpanded?matches.find(rule=>rule.id===historyExpandedRuleId)||
    (matches.length===1?matches[0]:null):null,
   editor=isExpanded?(editRule?
    recurringEditor('<p class="review-inline-guide">Update the saved repeating payment. The bank record remains unchanged.</p>'+
     '<form class="schedule-form" data-schedule-edit-form="'+escapeHTML(editRule.id)+'">'+
       scheduleFields({...editRule,date:tools.recurrenceDates(editRule,s.asOf,shiftDay(s.asOf,horizon))[0]||
        shiftDay(s.asOf,1)},false,s)+
       '<div class="future-form-actions"><button class="btn primary" type="submit">Save recurring forecast</button>'+
        '<button class="btn" type="button" data-history-inline-close>Cancel</button></div></form>','history'):
    matches.length>1?recurringEditor('<p class="review-inline-guide">Choose which saved prediction belongs to this bank payment.</p>'+
     '<div class="history-inline-choices">'+matches.map(rule=>
      '<button type="button" class="btn" data-history-inline-rule="'+escapeHTML(rule.id)+'">'+
       escapeHTML(rule.scheduleLabel||rule.merchant)+' · '+escapeHTML(rule.frequency)+
       ' · '+cash(rule.amount)+'</button>').join('')+'</div>','history'):
    recurringDraft?.historyRowId===String(t.id)?
     recurringEditor(repeatingReviewForm(s,{inline:true}),'history'):
    recurringEditor('<p class="review-inline-guide">This bank transaction is read-only. Repeating forecasts can only be created from eligible payments.</p>','history')
   ):'',
   detail=isExpanded?'<div class="history-inline-detail recurrence-inline-detail" data-history-inline-detail>'+
    editor+'</div>':'';
  return '<div class="history-entry" data-history-entry="'+escapeHTML(String(t.id))+'">'+
   '<div class="history-actual-row ledger-list-row recurrence-row" data-history-kind="'+escapeHTML(kind||'unknown')+
   '" data-history-sort-date="'+escapeHTML(t.date)+
   '" data-history-sort-amount="'+escapeHTML(String(Math.abs(Number(t.amount)||0)))+
   '" data-history-recurring-state="'+(status==='unplanned'?'unscheduled':status)+
   '" data-history-forecast-state="'+status+'">'+
   '<button type="button" class="history-row-open ledger-row-open recurrence-row-trigger" data-historical-transaction="'+
   escapeHTML(String(t.id))+'" data-historical-account="'+escapeHTML(aid)+
   '" aria-expanded="'+isExpanded+'" aria-label="'+escapeHTML((isExpanded?'Close':'Open')+
    ' repeating payment details: '+(t.merchant||'Bank transaction'))+'">'+
   '<span class="history-actual-date ledger-row-date">'+escapeHTML(dayLabel(t.date))+'</span>'+
   '<span class="history-actual-description ledger-row-description recurrence-row-name"><strong>'+escapeHTML(t.merchant||'Bank transaction')+'</strong>'+
   '<small>'+escapeHTML(label(aid))+' · '+escapeHTML(t.type||'Unclassified')+
    (t.pending?' · Pending':' · Posted')+' · <span class="history-recurring-status">'+
    escapeHTML(caption)+'</span></small></span>'+
   '<strong class="history-actual-amount ledger-row-amount '+(incoming?'incoming':'outgoing')+'">'+
    ledgerMoney(t.amount,incoming?'+':'−')+'</strong>'+
   '<span class="history-row-hint ledger-row-hint" aria-hidden="true">'+(isExpanded?'⌃':'›')+'</span></button>'+
   '<div class="ledger-row-category-wrap"><select class="schedule-row-category ledger-row-category" data-history-category="'+
    escapeHTML(String(t.id))+'" aria-label="Category for '+escapeHTML(t.merchant||'bank transaction')+
    ' on '+escapeHTML(t.date)+'">'+
    // Keep the full catalog available without injecting every option's
    // text into every bank row (which can make a merchant text search match
    // an unrelated row merely because e.g. "Mortgage" is an option).
    categories.map(c=>'<option value="'+escapeHTML(c)+'" label="'+escapeHTML(c)+'"'+
     (c===t.category?' selected':'')+'></option>').join('')+
   '</select></div><span class="ledger-row-menu-space" aria-hidden="true"></span></div>'+
   detail+'</div>';
 });
 // Preserve each user's chosen sort order inside each statement, and present
 // statement boundaries in chronological order. Never count pending activity,
 // transfers, or card settlements as card purchases.
 const rows=!groupHistoryCard?rowMarkup.join(''):(()=>{
  const groups=new Map(),ungrouped=[];
  visible.forEach((t,i)=>{
   const period=cardStatementPeriod(historyAccount,t.date);
   if(!period){ungrouped.push(rowMarkup[i]);return}
   if(!groups.has(period.end))groups.set(period.end,{period,entries:[]});
   groups.get(period.end).entries.push({row:t,html:rowMarkup[i]});
  });
  return [...groups.values()].sort((a,b)=>historySort==='oldest'?
   a.period.end.localeCompare(b.period.end):
   b.period.end.localeCompare(a.period.end)).map(({period,entries})=>
   '<section class="ledger-statement-group" data-history-statement-group="'+escapeHTML(period.end)+'">'+
   statementHeading(period,entries.reduce((sum,e)=>sum+cardActivityCents(e.row),0),
    entries.filter(e=>!e.row.pending&&!e.row.pairedTransactionId&&
     !['card_payment','internal_transfer'].includes(e.row.accountingKind)&&
     ['expense','refund'].includes(e.row.type)).length,'history')+
   entries.map(e=>e.html).join('')+'</section>').join('')+
   ungrouped.join('');
 })();
 return '<div class="planner-page history-page">'+
  '<form class="history-filters ledger-toolbar" data-history-filter>'+
   '<label class="history-search-wrap">Find a transaction<input name="search" type="search" value="'+escapeHTML(historySearch)+
    '" placeholder="Merchant, date, amount"></label>'+
   '<label>Account'+accountSelect(accounts,historyAccount,'historyAccount',true)+'</label>'+
   '<label>Sort by<select name="historySort" data-history-sort>'+
    [['newest','Newest first'],['oldest','Oldest first'],
     ['amount-desc','Amount: high to low'],['amount-asc','Amount: low to high'],
     ['merchant','Merchant: A to Z'],['category','Category']].map(([value,label])=>
     '<option value="'+value+'"'+(historySort===value?' selected':'')+'>'+
      label+'</option>').join('')+'</select></label>'+
   '<div class="history-category-controls"><label>Category<select name="historyCategory" data-history-category-filter>'+
    '<option value="">All categories</option>'+
    filterCategories.map(c=>'<option value="'+escapeHTML(c)+'"'+
     (historyCategoryFilter===c?' selected':'')+'>'+escapeHTML(c)+'</option>').join('')+
   '</select></label></div>'+
   (historySearch?'<button type="button" class="btn ledger-history-clear-button" data-clear-history-search>Clear</button>':'')+
   '</form>'+
  (groupHistoryCard?'<p class="ledger-statement-intro">Statement totals show net posted purchases less refunds among displayed transactions. Payments, transfers and pending items are excluded.</p>':
   selectedHistoryCard?'<p class="ledger-statement-help">Set this card’s billing period in Settings to group transactions by statement.</p>':'')+
  (reviewNotice?'<p class="future-notice" role="status">'+escapeHTML(reviewNotice)+'</p>':'')+
  // Minimal non-browser safety harnesses cannot emulate row expansion.
  // Preserve their bank-linked confirmation form without affecting browsers.
  (recurringDraft&&!transactionDetail&&typeof $('planner-main')?.insertAdjacentHTML!=='function'?
   repeatingReviewForm(s):'')+
  ((bundle?.postedMatchReview||[]).length?
   '<section class="panel" data-posted-match-review><strong>Confirm which prediction was paid</strong>'+
   '<p class="lead">These actual bank payments could match more than one planned bill. Choose the matching plan once to prevent double counting.</p>'+
   bundle.postedMatchReview.map(row=>'<div class="review-candidate">'+
    '<div class="review-candidate-main"><strong>'+escapeHTML(row.merchant)+'</strong>'+
    '<small>'+escapeHTML(dayLabel(row.date))+' · '+cash(row.amount)+'</small></div>'+
    '<div class="review-candidate-actions">'+row.candidates.map(c=>
     '<button type="button" class="btn" data-posted-match-bank="'+escapeHTML(row.bankId)+
      '" data-posted-match-rule="'+escapeHTML(c.ruleId)+'">'+
      '#'+(scheduleListNumber(c.ruleId)||'?')+' '+escapeHTML(c.label)+'</button>').join('')+
    '</div></div>').join('')+'</section>':'')+
  '<div class="history-list-surface"><p class="history-count ledger-list-count">Showing '+visible.length+' of '+filtered.length+
    ' matching transaction'+(filtered.length===1?'':'s')+
    (filtered.length>historyLimit?' · More available below':'')+'</p>'+
   (rows||'<div class="empty-visual">No bank transactions match this filter. Try another account or search.</div>')+
   (filtered.length>historyLimit?'<div class="history-more"><button type="button" class="btn" data-history-more>Show older transactions</button></div>':'')+
   '</div><p class="page-task-hint history-explanation ledger-footer-hint">Transactions stay here. Saved repeating plans take priority. '+
   'An unconfirmed automatic estimate may temporarily appear in balances until you finish reviewing '+
   'older patterns in Review. New repeating payments require a saved prediction.</p></div>';
}
// A cumulative, forecast-only recommendation ledger. Discovered suggestions
// are snapshotted so later dismissals, bank refreshes and approved schedules
// never erase the review trail. It is stored with encrypted Real preferences.
function repeatedRecommendations(bundle,s){
 const prefs=state().predictions||{},history=window.HouseholdPlannerHistory,
  accounts=activeAccounts(s),actual=bundle?.rows||[],rules=prefs.futureRecurringRules||[],
  normalize=t=>String(t||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const saved=prefs.repeatingRecommendations||{},discovered=history.recommendedRepeating(
  actual,accounts,s.asOf,prefs);
 const next={...saved},decisions=prefs.repeatingRecommendationDecisions||{};
 const discoveredKeys=new Set();let modified=false;
 for(const candidate of discovered){
  // Reuse a previously ignored review identity when variable amounts shifted.
  // Bank transaction ID overlap differentiates independent same-payee salaries.
  const existing=Object.values(saved).filter(old=>old&&
   old.accountId===candidate.accountId&&old.type===candidate.type&&
   String(old.merchant).toLowerCase()===String(candidate.merchant).toLowerCase()&&
   decisions[old.key]==='ignored').map(old=>({
    old,overlap:(old.examples||[]).filter(e=>(candidate.examples||[])
     .some(newer=>String(e.id)===String(newer.id))).length
   })).sort((a,b)=>b.overlap-a.overlap);
  const r={...candidate,key:existing[0]?.overlap>0?existing[0].old.key:candidate.key};
  discoveredKeys.add(r.key);
  const before=next[r.key];
  if(!before||JSON.stringify(before)!==JSON.stringify(r)){
   next[r.key]=r;modified=true;
  }
 }
 // A past automatically forecasted stream is NEVER dropped from the migration
 // inventory merely because the regular recommendation scanner groups variable
 // amounts differently. Match bank example IDs before amounts; each distinct
 // four-week payroll phase gets its own review decision.
 const attached=new Map();
 for(const auto of bundle?.recurrenceMigration?.legacySeries||[]){
  const eligible=Object.values(next).filter(r=>r&&
   (discoveredKeys.has(r.key)||decisions[r.key]==='ignored')&&
   String(r.accountId)===String(auto.accountId)&&r.type===auto.type&&
   normalize(r.merchant)===normalize(auto.merchant));
  const scored=eligible.map(r=>({
   r,overlap:(r.examples||[]).filter(e=>(auto.historicalIds||[])
    .some(id=>String(id)===String(e.id))).length,
   amountGap:Math.abs(Number(r.amount)-Number(auto.amount))
  })).sort((a,b)=>b.overlap-a.overlap||a.amountGap-b.amountGap);
  const best=scored[0];
  let target=best&&(best.overlap>0||scored.length===1||best.amountGap<=.01&&
   (scored.length===1||scored[1].amountGap>best.amountGap))?best.r:null;
  if(!target){
   const key='legacy-estimate|'+encodeURIComponent(auto.seriesKey);
   const bank=actual.find(t=>(auto.historicalIds||[]).some(id=>String(id)===String(t.id)));
   if(!next[key]){
    next[key]={key,accountId:auto.accountId,
     accountName:accounts.find(a=>String(a.id)===String(auto.accountId))?.name||auto.accountId,
     merchant:auto.merchant,amount:auto.amount,type:auto.type,
     frequency:auto.cadence||'monthly',nextDate:auto.date,lastDate:bank?.date||s.asOf,
     occurrences:Math.max(1,(auto.historicalIds||[]).length),
     examples:bank?[{id:String(bank.id),date:bank.date,
      amount:Number(bank.amount),merchant:String(bank.merchant||'')}]:[],
     reason:'Existing automatic forecast requires an explicit approval decision'};
    modified=true;
   }
   target=next[key];
   discoveredKeys.add(key);
  }
  const keys=attached.get(target.key)||[];
  if(!keys.includes(auto.seriesKey))keys.push(auto.seriesKey);
  attached.set(target.key,keys);
 }
 if(modified){
  prefs.repeatingRecommendations=next;
  reviewCatalogSave=reviewCatalogSave.catch(()=>{}).then(()=>savePlanning()).catch(error=>{
   latestError='Could not save the repeating recommendations: '+String(error.message||error);
  });
 }
 // Never delete older review evidence from private storage. Only display
 // meaningful current recommendations or formerly ignored genuine patterns;
 // generic isolated old purchases cannot fill Review forever.
 const isCredibleOld=r=>r&&(
  Number(r.occurrences)>=2&&Boolean(history.guessFrequency(r.examples||[]))||
  /\\b(?:mortgage|rent|insurance|premium|subscription|membership|payroll|salary|internet|electric|utilities|water|sewer|tuition|autopay)\\b/i.test(r.merchant||''));
 return Object.values(next).filter(r=>r&&r.key&&r.accountId&&r.merchant&&(
  discoveredKeys.has(r.key)||attached.has(r.key)||
  decisions[r.key]==='ignored'&&isCredibleOld(r))).map(r=>{
  const actualRow=(r.examples||[]).map(e=>actual.find(t=>String(t.id)===String(e.id)))
   .find(Boolean);
  const matches=actualRow?window.HouseholdPlannerTransactions.historicalScheduleMatches(actualRow,accounts,rules):
   rules.filter(rule=>String(rule.originalAccountId||rule.accountId||rule.fromAccountId)===
    String(r.accountId)&&(rule.matchNames||[]).includes(normalize(r.merchant)));
  const activeLegacyStreams=attached.get(r.key)||[];
  // An estimate that is STILL active cannot be deemed covered simply because
  // a same-merchant schedule exists. Require an explicit review decision.
  const status=activeLegacyStreams.length?
   (decisions[r.key]==='ignored'?'ignored':'pending'):
   matches.length?'scheduled':decisions[r.key]==='ignored'?'ignored':'pending';
  return {...r,status,activeLegacyStreams,ruleId:matches.length===1?matches[0].id:null};
 }).sort((a,b)=>({pending:0,ignored:1,scheduled:2}[a.status]??3)-
  ({pending:0,ignored:1,scheduled:2}[b.status]??3)||
  b.occurrences-a.occurrences||String(b.lastDate).localeCompare(String(a.lastDate)));
}
// One source for the red tab count and the actual Review queue.
 // A legacy estimate may remain visible after Ignore but is no longer an
 // undecided action; count its decision only while still pending.
function reviewQueue(bundle,s){
 const prefs=state().predictions||{},decisions=JSON.stringify(prefs.repeatingRecommendationDecisions||{});
 if(reviewQueueCache?.bundle===bundle&&reviewQueueCache.saved===prefs.repeatingRecommendations&&
    reviewQueueCache.decisions===decisions)return reviewQueueCache.queue;
 const recommendations=repeatedRecommendations(bundle,s),
  overdue=(bundle?.overduePayments||[]).filter(item=>
   !state().predictions?.futureTransactionEdits?.[item.key]?.skipped);
 const migration=bundle?.recurrenceMigration||{approvedOnly:false,legacySeries:[]},
  legacySeries=migration.approvedOnly?[]:migration.legacySeries||[],
  findOwner=auto=>recommendations.find(r=>(r.activeLegacyStreams||[]).includes(auto.seriesKey)),
  legacyItems=legacySeries.map(auto=>({auto,owner:findOwner(auto)})),
  decisionsNeeded=legacyItems.filter(({owner})=>!owner||owner.status==='pending').length,
  pending=recommendations.filter(r=>r.status==='pending'&&!r.activeLegacyStreams?.length),
  ignored=recommendations.filter(r=>r.status==='ignored'&&!r.activeLegacyStreams?.length);
 const queue={recommendations,legacyItems,decisionsNeeded,pending,ignored,overdue,
  outstanding:decisionsNeeded+pending.length+overdue.length};
 reviewQueueCache={bundle,saved:prefs.repeatingRecommendations,decisions,queue};
 return queue;
}
function updateReviewTabCount(queue){
 const badge=document.querySelector('.planner-nav-primary [data-review-tab-count]');
 if(!badge)return;
 const count=Number(queue?.outstanding||0);
 badge.hidden=!(count>0);
 badge.textContent=count>0?' ['+count+']':'';
 const tab=badge.closest('[data-view="reviews"]');
 if(tab)tab.classList.toggle('has-review-items',count>0);
}
function reviewsPage(bundle,s,queue=reviewQueue(bundle,s)){
 // Reuse the count's exact queue, including distinct unsaved legacy streams.
 const {recommendations,legacyItems,decisionsNeeded,pending,ignored,overdue}=queue;
 lastRecommendedRepeating=recommendations;
 const
  expanded=(r,legacyKey='')=>!!r&&recurringDraft?.reviewRowKey===r.key&&
   String(recurringDraft?.reviewLegacyKey||'')===String(legacyKey);
 const controls=(r,legacyKey='')=>!r?
  '<span class="review-legacy-missing">Identify this payment in Transactions</span>':
  r.status==='ignored'?
   '<button type="button" class="btn" data-unignore-recommendation="'+escapeHTML(r.key)+'">Undo ignore</button>':
   '<button type="button" class="btn" data-ignore-recommendation="'+escapeHTML(r.key)+'">Ignore</button>';
 const row=(r,{legacy=null,accountName,merchant,frequency,nextDate,amount,kind,statusText}={})=>{
  const key=legacy?.seriesKey||'',
   isOpen=expanded(r,key),
   title=merchant||r?.merchant||'Unidentified payment',
   account=accountName||r?.accountName||'Account',
   cadence=frequency||r?.frequency||'Repeating',
   date=nextDate||r?.nextDate||s.asOf,
   value=amount??r?.amount,
   isLegacy=Boolean(legacy),
   isIgnored=r?.status==='ignored';
  return '<article class="review-candidate review-inline-row'+(isLegacy?' legacy-estimate-row':'')+
   (isOpen?' review-row-expanded':'')+'"'+
   (isLegacy?' data-legacy-estimate="'+escapeHTML(key)+'"':'')+
   (r?' data-recommended-repeat="'+escapeHTML(r.key)+'"':'')+
   ' data-legacy-active="'+isLegacy+'" data-recommendation-status="'+
     (isIgnored?'ignored':'pending')+'">'+
   '<div class="review-row-top recurrence-row">'+
    (r?'<button class="review-row-open recurrence-row-trigger" type="button" data-review-recommendation="'+escapeHTML(r.key)+'"'+
     (isLegacy?' data-legacy-series="'+escapeHTML(key)+'"':'')+
     ' aria-expanded="'+isOpen+'" aria-label="'+(isOpen?'Close':'Open')+
     ' repeating payment details: '+escapeHTML(title)+'">':
     '<div class="review-row-unavailable">')+
    '<span class="review-candidate-main recurrence-row-name"><strong>'+escapeHTML(title)+'</strong>'+
     '<small>'+escapeHTML(account)+' · '+escapeHTML(cadence)+
      ' · Next '+escapeHTML(dayLabel(date))+
      (kind?' · '+escapeHTML(kind):
       !isLegacy?' · '+(r.occurrences||0)+' previous payment'+
        (r.occurrences===1?'':'s'):'')+'</small>'+
     (statusText?'<small class="legacy-estimate-state">'+statusText+'</small>':'')+
    '</span><strong class="review-candidate-amount">'+cash(value||0)+'</strong>'+
    (r?'<span class="review-row-chevron" aria-hidden="true">'+(isOpen?'⌃':'›')+'</span></button>':
     '</div>')+
    '<div class="review-candidate-actions">'+controls(r,key)+'</div>'+
   '</div>'+
   (isOpen?'<div class="review-inline-detail recurrence-inline-detail" data-review-inline-detail>'+
    recurringEditor(repeatingReviewForm(s,{inline:true}),'review')+'</div>':'')+
   '</article>';
 };
 const normalCard=r=>row(r);
 const legacyCard=({auto,owner})=>{
  const account=activeAccounts(s).find(a=>String(a.id)===String(auto.accountId)),
   ignoredByUser=owner?.status==='ignored';
  return row(owner,{legacy:auto,accountName:account?.name||owner?.accountName,
   merchant:auto.merchant||'Unidentified payment',
   frequency:auto.cadence||owner?.frequency,
   nextDate:auto.date,amount:auto.amount,
   kind:auto.type==='income'?'Deposit':'Withdrawal',
   statusText:ignoredByUser?'Ignored, but still included in your forecast':
    'Needs a decision — currently included in your forecast'});
 };
 return '<div class="planner-page reviews-page">'+
  (reviewNotice?'<p class="future-notice" role="status">'+escapeHTML(reviewNotice)+'</p>':'')+
  (overdue.length?'<section class="panel overdue-payments" data-overdue-review>'+
   '<div class="section-title"><h2>Predicted payments not yet posted</h2>'+
   '<span class="status-tag warn">'+overdue.length+' TO REVIEW</span></div>'+
   '<p class="lead">These withdrawals were expected but have no confirmed matching bank payment. '+
   'Each is still reserved once in the forecast on the next business day; '+
   'your actual bank balance is unchanged. Bank processing can take a few days.</p>'+
   overdue.map(item=>'<form class="overdue-review-row" data-overdue-date="'+
    escapeHTML(item.key)+'">'+
    '<strong>'+escapeHTML(item.merchant)+' · '+cash(item.amount)+'</strong>'+
    '<small>Expected '+escapeHTML(dayLabel(item.expectedDate))+
     ' · Not confirmed by bank</small>'+
    '<label>Move this payment to <input type="date" name="date" required min="'+
     escapeHTML(shiftDay(s.asOf,1))+'" max="'+
     escapeHTML(shiftDay(s.asOf,horizon))+'" value="'+
     escapeHTML(item.proposedDate)+'"></label>'+
    '<button type="submit" class="btn primary">Move just this payment</button>'+
    '<small>Does not change future mortgage dates or bank transactions.</small>'+
    '</form>').join('')+
   '</section>':'')+
  (legacyItems.length?
   '<section class="panel legacy-repeating-panel" data-active-legacy-estimates>'+
    '<div class="section-title"><h2>Automatic estimates still in forecast</h2>'+
     '<strong class="legacy-estimate-count" data-legacy-estimate-count="'+legacyItems.length+'">'+
      legacyItems.length+' UNSAVED</strong></div>'+
    '<p class="lead">These '+legacyItems.length+' repeating payment'+
      (legacyItems.length===1?' is':'s are')+
      ' already affecting your projected balance without an approved prediction. '+
      (decisionsNeeded?decisionsNeeded+' still need'+(decisionsNeeded===1?'s':'')+' a decision. ':
       'All have review decisions. ')+
      'Ignoring one does not remove it from the forecast until the final switch below.</p>'+
    '<div class="legacy-estimate-list">'+legacyItems.map(legacyCard).join('')+'</div>'+
    '<div class="recurrence-transition"><p class="lead">'+
      (decisionsNeeded?'Review or ignore the highlighted payment'+(decisionsNeeded===1?'':'s')+
       ' before switching.':'You can now turn off the older automatic estimates.')+
     '</p><button type="button" class="btn" data-activate-saved-schedules '+
      (decisionsNeeded?'disabled title="Review remaining automatic estimates first"':'')+
      '>Use saved predictions only</button></div>'+
   '</section>':'')+
  '<section class="panel recommended-repeating" data-recommended-repeating>'+
   '<div class="section-title"><h2>Other recommended repeating</h2>'+
   '<span class="status-tag">'+pending.length+' TO REVIEW</span></div>'+
   (pending.length?pending.map(normalCard).join(''):
    '<p class="lead">Nothing else to review.</p>')+
   '</section>'+
  (ignored.length?
   '<details class="ignored-repeating" data-ignored-repeating'+
    (ignored.some(r=>expanded(r))?' open':'')+'><summary>Ignored ('+
     ignored.length+')</summary><div class="ignored-repeating-items">'+
      ignored.map(normalCard).join('')+'</div></details>':'')+
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
  '<p class="audit-footnote">Estimates may differ from issuer statements due to balances, fees or incomplete activity.</p></section>';
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
   '<p class="chart-caption">'+(state().predictions?.recurringForecastMode==='approved-only'?
     'Only saved predictions, planned payments and governed card obligations affect future balances. Unapproved repeating patterns are suggestions only.':
     'This balance projection includes older detected estimates until reviewed. Save recurring plans and finish the switch on the Review tab.')+
   '</p></section>'+
  '<section class="panel"><div class="section-title"><h2>Next five expected movements</h2>'+
   '<button type="button" class="btn" data-view="transactions">View all and edit</button></div>'+
   (notes||'<p class="lead">No upcoming dated transactions identified.</p>')+
   '</section></div>';
}
function summaryPage(bundle,s,chosen,derived,fresh,view='calendar'){
 const calendar=window.HouseholdPlannerSummary.render({
  snapshot:s,chosen,derived,bundle,days:horizon,
  prefs:state().predictions||{},accounts:activeAccounts(s),
  fresh,ready:window.HouseholdPaymentObligations.ready,view
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
   '<form data-warning-form><label class="cash-cushion-label">Warn below ($)'+
    '<input type="number" name="warnBelow" min="0" step="1" max="999999999" value="'+
    escapeHTML(warningThreshold(state().predictions))+'" required></label>'+
    '<button class="btn primary" type="submit">Save</button></form></section>'+
  (state().predictions?.recurringForecastMode!=='approved-only'&&
   Object.keys(state().predictions?.futureRecurrenceExclusions||{}).length?
  '<section class="panel mini-panel" aria-label="Automatic prediction exclusions">'+
   '<div class="section-title"><h2>Auto-predict: Off</h2><span class="status-tag">'+
    Object.keys(state().predictions?.futureRecurrenceExclusions||{}).length+' EXCLUDED</span></div>'+
   '<p>These are previous inferred-estimate exclusions. Restore one here if needed before completing the prediction-only migration. Posted bank activity is unchanged.</p>'+
   Object.entries(state().predictions?.futureRecurrenceExclusions||{}).map(([key,item])=>
    '<div class="future-skip-line"><strong>'+escapeHTML(item.merchant)+'</strong> · '+
     escapeHTML(activeAccounts(s).find(a=>String(a.id)===String(item.accountId))?.name||item.accountId)+
     ' · '+escapeHTML(item.type)+(item.seriesKey?' · inferred series only':
      item.manualRuleId?' · one saved prediction':item.phaseDate?' · one payday phase':'')+
     ' <button type="button" class="btn" data-restore-recurrence="'+escapeHTML(key)+
     '">Restore legacy estimate</button></div>').join('')+
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
 if(busy){updateReviewTabCount(null);
  $('planner-notice').innerHTML='<div class="notice'+(window.HouseholdLiveSource?.error?' danger':'')+'"><div><strong>Real bank information is not available yet.</strong> '+
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
 // Derive the navigation count on every page, using the same unresolved
 // recommendations and legacy decisions shown inside Review.
 const reviewData=selectedSource&&Array.isArray(bundle?.rows)?reviewQueue(bundle,s):null;
 updateReviewTabCount(reviewData);
 const derived=projection?.accounts.find(x=>x.id===String(selectedAccount));
 const statuses=projection?.diagnostics||{};
 const missingCards=activeAccounts(s).filter(a=>accountType(a)==='credit'&&
  !window.HouseholdPaymentObligations.ready(state().predictions?.paymentRules?.[a.id],a,activeAccounts(s)));
 const caution=[
  ...(missingCards.length?['Credit-card payment prediction not set for '+missingCards.map(a=>a.name).join(', ')+'. Future checking withdrawals may be incomplete.']:[]),
  ...((bundle?.payments?.warnings||[]).slice(0,3)),
  ...(bundle?.recurrenceMigration&&!bundle.recurrenceMigration.approvedOnly&&
   bundle.recurrenceMigration.legacySeries.length?
   [bundle.recurrenceMigration.legacySeries.length+' unsaved automatic repeating estimate stream(s) still affect future balances. See the highlighted payments at the top of Review.']:[]),
  ...((bundle?.missingMortgages||[]).slice(0,2).map(m=>
   'An actual '+cash(m.amount)+' mortgage payment from '+m.account+' is not in the forecast. Review its proposed recurring prediction below.')),
  ...((bundle?.routines?.warnings||[]).slice(0,2).map(w=>
   'Possible mortgage withdrawal not included: '+w.merchant+' ('+w.reason+'). Confirm its recurrence before relying on the projected balance.')),
  ...((bundle?.postedMatchReview||[]).length?['Some posted payments may cover one of several confirmed predictions. Choose the matching prediction in Review before relying on the projected balance.']:[]),
  ...((bundle?.forecast?.suppressedDuplicates||[]).length?['Older overlapping one-time forecasts were excluded to avoid duplicate payments.']:[]),
  ...((statuses.unassigned||[]).length?['Some expected payments lack a confirmed account, so those are not included in the balance.']:[]),
  ...((statuses.unmatchedTransfers||[]).length?['Some predicted transfers do not have a verified counterpart; review before relying on cash coverage.']:[])
 ];
 let note='';
 if(error)note='<div class="notice danger"><strong>Forecast calculation unavailable.</strong> '+escapeHTML(error)+
  '. Your bank balances have not been changed.</div>';
 else if(latestError)note='<div class="notice danger">'+escapeHTML(latestError)+'</div>';
 else if(caution.length)note='<div class="notice danger"><div><strong>Forecast requires review.</strong> '+
  escapeHTML(caution.join(' '))+'</div>'+
  ((bundle?.recurrenceMigration?.legacySeries||[]).length&&!bundle.recurrenceMigration.approvedOnly?
   '<button type="button" class="btn" data-view="reviews">See automatic estimates</button>':
   (bundle?.postedMatchReview||[]).length?
   '<button type="button" class="btn" data-view="history">Choose matching prediction</button>':'')+
  '</div>';
 else note='<div class="notice"><div><strong>'+(live()?'Read-only bank feed':'Fictional planning preview')+'.</strong> '+
  (live()?'Balances are bank-reported; future movements are estimates.':'These balances and transactions are samples, not your actual household.')+
  '</div><span class="secondary">'+escapeHTML(s.asOf||dateToday())+'</span></div>';
 const informational=!error&&!latestError&&!caution.length;
 // Bank-auth errors take priority over prediction warnings and remain visible
 // on Calendar, Repeating and Bank activity until a successful bank refresh.
 const bankWarning=window.HouseholdLiveSource?.warningBanner?.()||'';
 $('planner-notice').innerHTML=bankWarning||
  (informational||activeTab==='summary'&&!error&&!latestError?'':note);
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
  activeTab==='reviews'?reviewsPage(bundle,s,reviewData||reviewQueue(bundle,s)):
  activeTab==='transactions'?transactionsPage(bundle,s):
  activeTab==='trend'&&window.HouseholdPlannerSummary?.render?
   summaryPage(bundle,s,selectedSource,derived,fresh,'trend'):
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
   if(!candidate)throw Error('This bank payment has changed. Refresh Review.');
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.linkPostedToSchedule(
    state(),bankId,ruleId,model.records(state()),activeAccounts(snapshot())));
   reviewNotice='Linked the posted payment to prediction #'+
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
 if(newSchedule){
  if((recurrenceFormDirty('.schedule-page [data-schedule-edit-form]')||
   recurrenceFormDirty('.schedule-page [data-schedule-new-form]'))&&
   !window.confirm('Discard unsaved prediction changes?'))return;
  scheduleMode='new';scheduleTarget='';schedulePreset=null;scheduleNotice='';
  transactionDetail=null;render();
  document.querySelector('[data-schedule-new-form] [name=merchant]')?.focus();
  return}
 const jump=e.target.closest?.('[data-schedule-view-calendar]');
 if(jump){
  if((recurrenceFormDirty('.schedule-page [data-schedule-edit-form]')||
   recurrenceFormDirty('.schedule-page [data-schedule-new-form]'))&&
   !window.confirm('Discard unsaved prediction changes to open Calendar?'))return;
  const s=snapshot(),b=forecastFor(s),ruleId=jump.dataset.scheduleViewCalendar,
   row=futureRows(b,s).find(r=>String(r.recurringRuleId||'')===String(ruleId));
  if(!row){setNotice('No upcoming payment is forecast for this prediction. Check its settings.');return}
  const accountId=String(row.kind==='movement'?row.fromAccountId:row.accountId);
  if(!activeAccounts(s).some(a=>String(a.id)===accountId)){
   setNotice('This payment needs a valid connected account.');return;
  }
  selectedAccount=accountId;activeTab='summary';scheduleMode='';scheduleTarget='';
  transactionDetail=null;render();
  window.HouseholdPlannerSummary?.navigate?.(row.date);
  document.querySelector('[data-calendar-day="'+row.date+'"]')?.scrollIntoView?.({block:'center'});
  return;
 }
 const scheduleEdit=e.target.closest?.('[data-schedule-edit]');
 if(scheduleEdit){
  if((recurrenceFormDirty('.schedule-page [data-schedule-edit-form]')||
   recurrenceFormDirty('.schedule-page [data-schedule-new-form]'))&&
   !window.confirm('Discard unsaved prediction changes?'))return;
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
   scheduleNotice='Removed this prediction only. Bank transactions and other predictions were not changed.';transactionDetail=null;render()}
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
  historyExpandedId='';historyExpandedAccount='';historyExpandedRuleId='';
  render();
  // Tab navigation should not animate the global header's position.
  // 'auto' inherits html's smooth scrolling and briefly shifts the header.
  window.scrollTo({top:0,behavior:'instant'});
  return;
 }
 const selectBankPlan=e.target.closest?.('[data-history-inline-rule]');
 if(selectBankPlan){
  const ruleId=selectBankPlan.dataset.historyInlineRule,
   origin=selectBankPlan.closest('[data-history-entry]')?.dataset.historyEntry,
   bank=lastHistoryRows.find(t=>String(t.id)===origin);
  const options=bank?window.HouseholdPlannerTransactions.historicalScheduleMatches(
   bank,activeAccounts(snapshot()),state().predictions?.futureRecurringRules||[]):[];
  if(!options.some(r=>r.id===ruleId)){setNotice('That saved prediction changed. Reopen the bank payment.');return}
  historyExpandedRuleId=ruleId;recurringDraft=null;render();
  document.querySelector('.history-page [data-history-inline-detail] [name=merchant]')?.focus();
  return;
 }
 const closeBankInline=e.target.closest?.('[data-history-inline-close]');
 if(closeBankInline){
  historyExpandedId='';historyExpandedAccount='';historyExpandedRuleId='';recurringDraft=null;
  render();return;
 }
 const scheduleChoice=e.target.closest?.('[data-choose-history-schedule]');
 if(scheduleChoice){
  if(!openSchedulePlan(scheduleChoice.dataset.chooseHistorySchedule,'',scheduleChoice))
   setNotice('That prediction changed. Refresh bank history.');
  return;
 }
 const actualRow=e.target.closest?.('[data-historical-transaction]');
 if(actualRow&&activeTab==='history'){
  const id=actualRow.dataset.historicalTransaction,account=actualRow.dataset.historicalAccount,
   same=historyExpandedId===id&&historyExpandedAccount===account;
  if(same){
   if(recurrenceFormDirty('.history-page [data-history-inline-detail] form')&&
    !window.confirm('Discard unsaved prediction changes?'))return;
   historyExpandedId='';historyExpandedAccount='';historyExpandedRuleId='';recurringDraft=null;
   render();return;
  }
  if(recurrenceFormDirty('.history-page [data-history-inline-detail] form')&&
   !window.confirm('Discard unsaved prediction changes?'))return;
  const row=lastHistoryRows.find(t=>String(t.id)===id&&
   window.HouseholdPlannerHistory.accountOf(t,activeAccounts(snapshot()))===account);
  if(!row){setNotice('This bank record changed. Refresh Transactions.');return}
  const matches=window.HouseholdPlannerTransactions.historicalScheduleMatches(
   row,activeAccounts(snapshot()),state().predictions?.futureRecurringRules||[]);
  historyExpandedId=id;historyExpandedAccount=account;
  historyExpandedRuleId=matches.length===1?matches[0].id:'';
  transactionDetail=null;recurringDraft=null;
  if(!matches.length&&window.HouseholdPlannerHistory.canPlan(row)){
   try{
    const draft=window.HouseholdPlannerHistory.draftFor(
     row,lastHistoryRows,activeAccounts(snapshot()),snapshot().asOf);
    const category=model.canonicalCategory(state(),row.category)||'Uncategorized';
    recurringDraft={...draft,category,historyRowId:id};
   }catch(error){
    historyExpandedId='';setNotice(String(error.message||error));return;
   }
  }
  reviewNotice='';render();
  document.querySelector('.history-page [data-history-inline-detail] [name=merchant]')?.focus();
  return;
 }
 const fromHistory=e.target.closest('[data-history-plan]')||
  e.target.closest('[data-calendar-history-plan]')||actualRow;
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
  // saved prediction, even if its bank amount is different.
  const matching=window.HouseholdPlannerTransactions.historicalScheduleMatches(
   row,activeAccounts(snapshot()),state().predictions?.futureRecurringRules||[]);
  if(matching.length===1){
   recurringDraft=null;
   if(!openSchedulePlan(matching[0].id,'',e.target))
    setNotice('That prediction changed. Refresh bank history.');
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
 const cutover=e.target.closest('[data-activate-saved-schedules]');
 if(cutover){
  try{
   if(state().predictions?.recurringForecastMode==='approved-only')return;
   // Re-evaluate bank history at click time. A stale Review page cannot drop
   // an unsaved automatic cash movement that arrived after its last render.
   const fresh=forecastFor(snapshot()),current=repeatedRecommendations(fresh,snapshot());
   const active=fresh?.recurrenceMigration?.legacySeries||[],
    missing=active.filter(auto=>!current.some(r=>
     r.activeLegacyStreams?.includes(auto.seriesKey)&&r.status==='ignored'));
   if(missing.length)throw Error('Review the '+missing.length+
    ' remaining unconfirmed automatic payments before switching.');
   await commitForecastChange(()=>{state().predictions.recurringForecastMode='approved-only'});
   recurringDraft=null;
   reviewNotice='Saved predictions are now the only source of recurring forecasts. '+
    'Previously inferred, unsaved payments are no longer included; bank history is unchanged.';
   render();
  }catch(error){setNotice(String(error.message||error))}
  return;
 }
 const newRecommendation=e.target.closest('[data-review-recommendation]');
 if(newRecommendation){
  const candidate=lastRecommendedRepeating.find(r=>r.key===newRecommendation.dataset.reviewRecommendation);
  if(!candidate){setNotice('That recommendation changed. Open Review again.');return}
  const legacyKey=newRecommendation.dataset.legacySeries||'';
  if(recurringDraft?.reviewRowKey===candidate.key&&
    String(recurringDraft.reviewLegacyKey||'')===legacyKey){
   if(reviewFormDirty()&&!window.confirm('Discard unsaved prediction changes?'))return;
   recurringDraft=null;reviewNotice='';render();return;
  }
  if(reviewFormDirty()&&!window.confirm('Discard unsaved prediction changes?'))return;
  const legacyMatch=legacyKey||null,
   legacy=legacyMatch?(forecastFor(snapshot())?.recurrenceMigration?.legacySeries||[])
    .find(auto=>auto.seriesKey===legacyMatch):null;
  if(legacyKey&&!legacy){setNotice('This automatic estimate changed. Reopen Review.');return}
  // Keep same-payee independent income streams distinct.
  const source=legacy?(legacy.historicalIds||[]).map(id=>
     lastHistoryRows.find(t=>String(t.id)===String(id))).filter(Boolean).at(-1):
    (candidate.examples||[]).map(e=>lastHistoryRows.find(t=>String(t.id)===String(e.id))).find(Boolean);
  try{
   // Reuse the same bank-aware form as History so alternating paychecks,
   // transfers and posted examples are linked safely to ONE approved plan.
   const draft=source?window.HouseholdPlannerHistory.draftFor(source,lastHistoryRows,
    activeAccounts(snapshot()),snapshot().asOf):null;
   if(!draft)throw Error('Bank evidence is no longer available. Keep this recommendation for review.');
   const proposedCategory=candidate.category||source.category,
    category=model.canonicalCategory(state(),proposedCategory)||'Uncategorized';
   recurringDraft={...draft,merchant:candidate.merchant,
    amount:legacy?.amount??draft.amount,
    frequency:legacy?.cadence||draft.frequency,
    nextDate:legacy?.date||draft.nextDate,
    category,
    // For alternating payroll phases only link rows from the chosen stream.
    examples:legacy?(legacy.historicalIds||[]).map(String):draft.examples||[],
    reviewRowKey:candidate.key,reviewLegacyKey:legacyKey};
   reviewNotice='';
   render();
   document.querySelector('.reviews-page [data-review-inline-detail] [name=merchant]')?.focus();
  }catch(error){setNotice(String(error.message||error))}
  return;
 }
 const ignoreRecommendation=e.target.closest('[data-ignore-recommendation],[data-unignore-recommendation]');
 if(ignoreRecommendation){
  const key=ignoreRecommendation.dataset.ignoreRecommendation||ignoreRecommendation.dataset.unignoreRecommendation,
   ignored=Boolean(ignoreRecommendation.dataset.ignoreRecommendation);
  if(!lastRecommendedRepeating.some(r=>r.key===key)){setNotice('That suggestion has changed.');return}
  if(recurringDraft?.reviewRowKey===key&&reviewFormDirty()&&
    !window.confirm('Discard unsaved prediction changes?'))return;
  try{
   await commitForecastChange(()=>{
    const p=state().predictions;
    p.repeatingRecommendationDecisions??={};
    if(ignored)p.repeatingRecommendationDecisions[key]='ignored';
    else delete p.repeatingRecommendationDecisions[key];
   });
   if(recurringDraft?.reviewRowKey===key)recurringDraft=null;
   reviewNotice=ignored?'Marked ignored. This recommendation remains visible. Any older estimate stays in the forecast until you activate saved-predictions-only mode.':
    'Recommendation is available for approval again.';
   render();
  }catch(error){setNotice(String(error.message||error))}
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
  if(activeTab==='history'){historyExpandedId='';historyExpandedAccount='';historyExpandedRuleId=''}
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
  if(!row){setNotice('The recurring prediction changed. Open Predictions and try again.');return}
  try{
   const result=await commitForecastChange(()=>window.HouseholdPlannerTransactions.stopRecurrence(state(),row));
   editingKey='';restoreScheduleAfterOccurrence();transactionNotice=result.autoSeries?
    'Removed only the inferred '+row.merchant+' series. Confirmed income predictions were preserved. Restore in Settings.':
    'Marked '+row.merchant+' as not recurring. Only its matching prediction was removed. Restore in Settings or History.';
   render();
  }catch(err){transactionNotice=String(err.message||err);render()}
  return;
 }
 const resetRecurring=e.target.closest('[data-reset-series]');
 if(resetRecurring){
  try{
   await commitForecastChange(()=>window.HouseholdPlannerTransactions.resetSeries(state(),resetRecurring.dataset.resetSeries));
   editingKey='';restoreScheduleAfterOccurrence();transactionNotice='Recurring prediction restored to its original forecast.';render();
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
  }catch(err){setNotice('Card payment prediction could not be saved: '+String(err.message||err))}
  return;
 }
 const account=e.target.closest('[data-account-id]');
 if(account){selectedAccount=account.dataset.accountId;render();return}
 if(e.target.closest('#refresh-bank')){window.HouseholdLiveSource?.refresh();return}
});

// A payee may legitimately have multiple independently confirmed predictions.
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
 holder.innerHTML='<label>Which existing payment prediction?'+
  '<select name="existingRuleId" required><option value="" selected disabled>Select a prediction</option>'+
  choices+'</select></label>'+
  '<p>Only the chosen recurring prediction will be updated. This does not add a second payment or change your bank history.</p>';
 holder.querySelector('select')?.focus();
 return true;
}
async function commitForecastChange(action){
 await reviewCatalogSave.catch(()=>{});
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
  const label=await commitForecastChange(()=>model.addCategory(state(),field.value));
  // The custom name is stored ONCE, in the canonical forecast category
  // registry. Refresh every currently open category selector from that list
  // without rebuilding an unsaved prediction or adding duplicate <option>s.
  document.querySelectorAll('select[name=category],[data-schedule-category-filter],'+
   '[data-schedule-quick-category],[data-history-category],'+
   '[data-history-category-filter]').forEach(select=>{
    if(![...select.options].some(option=>option.value.toLowerCase()===label.toLowerCase())){
     const option=document.createElement('option');option.value=label;option.textContent=label;
     select.appendChild(option);
    }
    if(select.name==='category')select.value=label;
  });
  field.value='';
  if(notice)notice.textContent='Added '+label+'. Choose it for any prediction.';
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
  if(form.hasAttribute('data-schedule-new-form')&&!String(fields.merchant||'').trim())
   fields.merchant=String(fields.scheduleLabel||'').trim();
  let savedPlanId='';
  if(form.hasAttribute('data-schedule-new-form')){
   const saved=await commitForecastChange(()=>T.defineRecurring(state(),fields,accounts,s.asOf,null,
    model.records(state()),fields.historyExampleId?[fields.historyExampleId]:[]));
   savedPlanId=saved.id;
   scheduleNotice='Plan created. All its upcoming payments are shown below.';
  }else if(form.hasAttribute('data-schedule-edit-form')){
   const id=form.dataset.scheduleEditForm,r=(state().predictions?.futureRecurringRules||[]).find(x=>x.id===id);
   if(!r)throw Error('This prediction changed. Open it again.');
   const reference={kind:r.kind,recurringRuleId:id,
    sourceAccountId:r.originalAccountId||r.accountId||r.fromAccountId,
    fromAccountId:r.fromAccountId,toAccountId:r.toAccountId,
    accountId:r.accountId,originalMerchant:r.originalMerchant||r.merchant,
    originalType:r.originalType||r.type,sourceAmount:r.matchAmount||r.amount,date:r.sourceAnchorDate||r.anchorDate};
   await commitForecastChange(()=>T.defineRecurring(state(),fields,accounts,s.asOf,reference,model.records(state()),[]));
   savedPlanId=id;
   scheduleNotice='Saved — repeating prediction updated. Individual payment edits remain separate.';
  }
  schedulePreset=null;scheduleRemoveTarget='';
  if(activeTab==='schedules'&&savedPlanId&&!transactionDetail){
   scheduleMode='edit';scheduleTarget=savedPlanId;render();
   const card=[...document.querySelectorAll('[data-schedule-card]')].find(x=>x.dataset.scheduleCard===savedPlanId);
   card?.insertAdjacentHTML('afterbegin','<p class="inline-save-result" role="status">'+escapeHTML(scheduleNotice)+'</p>');
  }else if(activeTab==='history'&&savedPlanId&&!transactionDetail){
   historyExpandedRuleId=savedPlanId;recurringDraft=null;
   reviewNotice='Saved — repeating prediction updated. Bank records remain unchanged.';
   render();
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
 historyCategoryFilter=String(fields.historyCategory||'');
 historySort=['newest','oldest','amount-desc','amount-asc','merchant','category']
  .includes(fields.historySort)?fields.historySort:historySort;
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
  if(activeTab==='history'){
   historyExpandedId='';historyExpandedAccount='';historyExpandedRuleId='';
  }
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
 const form=e.target.closest('[data-overdue-date]');
 if(!form)return;
 e.preventDefault();
 const key=form.dataset.overdueDate,button=form.querySelector('button[type="submit"]'),
  s=snapshot(),item=forecastFor(s)?.overduePayments?.find(x=>x.key===key);
 if(!item){setNotice('This payment changed or posted. Refresh Review.');return}
 const target=form.querySelector('[name=date]')?.value||'';
 if(!/^\d{4}-\d{2}-\d{2}$/.test(target)||target<=s.asOf||
  target>shiftDay(s.asOf,horizon)||
  [0,6].includes(new Date(target+'T12:00:00Z').getUTCDay())){
  setNotice('Choose a future business day for this payment.');return;
 }
 if(button)button.disabled=true;
 try{
  await commitForecastChange(()=>window.HouseholdPlannerTransactions.saveEdit(
   state(),key,{date:target,accountId:item.accountId,
    merchant:item.merchant,type:'expense',amount:item.amount},
   activeAccounts(s),s.asOf));
  reviewNotice='Moved only the outstanding payment to '+dayLabel(target)+
   '. The repeating prediction and bank transactions were not changed.';
  render();
 }catch(error){
  if(button)button.disabled=false;
  setNotice('Could not change this payment: '+String(error.message||error));
 }
});
document.addEventListener('submit',async e=>{
 const form=e.target.closest('[data-future-edit-form],[data-future-new-form],[data-warning-form]');
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
    transactionNotice='Saved recurring prediction. All matching future payments will be forecast.';
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
  }else if(form.hasAttribute('data-warning-form')){
   const raw=String(fields.warnBelow??'').trim(),value=Number(raw);
   if(!raw||!Number.isInteger(value)||value<0||value>999999999)
    throw Error('Enter a valid whole-dollar warning amount.');
   await commitForecastChange(()=>{
    state().predictions.warnBelow=value;
    model.setCashCushion(state(),value);
    state().predictions.lowAlertThreshold=value; // keep old saved readers in sync
   });
   transactionNotice='Low-balance warning saved.';
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
 const historyCategory=e.target.closest?.('[data-history-category]');
 if(historyCategory){
  const id=historyCategory.dataset.historyCategory,
   current=(state().transactions||[]).find(t=>String(t.id)===String(id)),
   originalCategory=current?model.categoryFor(state(),id):null,
   previous=JSON.stringify(state().categoryOverrides||{});
  if(!current||!originalCategory){historyCategory.value=originalCategory||'Other';return}
  if(historyCategory.value===originalCategory)return;
  historyCategory.disabled=true;
  try{
   // Only the local classification overlay changes; immutable Plaid history
   // and forecast rules are neither edited nor uploaded.
   model.setCategory(state(),id,historyCategory.value);
   const saved=live()?
    await window.HouseholdLiveSource.persistCategory(id,state().categoryOverrides?.[id]??null):
    savePlanning();
   if(live()&&(!saved||saved.saved!==true))throw Error('Category was not saved');
   reviewNotice='';latestError='';render();
   document.querySelectorAll('[data-history-category]').forEach(select=>{
    if(select.dataset.historyCategory===id)select.focus({preventScroll:true});
   });
  }catch(err){
   state().categoryOverrides=JSON.parse(previous);
   historyCategory.disabled=false;historyCategory.value=originalCategory;
   const alert=document.createElement('span');alert.className='history-category-error';
   alert.setAttribute('role','alert');alert.textContent='Could not save category: '+String(err.message||err);
   historyCategory.parentElement.appendChild(alert);
  }
  return;
 }
 const quick=e.target.closest?.('[data-schedule-quick-category]');
 if(quick){
  const id=quick.dataset.scheduleQuickCategory,
   saved=(state().predictions?.futureRecurringRules||[]).find(rule=>String(rule.id)===String(id)),
   original=saved?.category||'Uncategorized',
   form=document.querySelector('[data-schedule-edit-form],[data-schedule-new-form]');
  if(!saved){quick.value=original;setNotice('Prediction changed. Refresh and try again.');return}
  if(quick.value===original)return;
  const dirty=form&&[...form.querySelectorAll('input,select,textarea')].some(field=>{
   if(field.type==='hidden')return false;
   if(field.type==='checkbox'||field.type==='radio')return field.checked!==field.defaultChecked;
   if(field.tagName==='SELECT')return [...field.options].some(o=>o.selected!==o.defaultSelected);
   return field.value!==field.defaultValue;
  });
  if(dirty&&!window.confirm('Discard unsaved prediction edits to change this category?')){
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
  filter=e.target.closest?.('[data-schedule-category-filter]'),
  schedulePicker=e.target.name==='scheduleAccount'?e.target:null;
 if(sorter||filter||schedulePicker){
  const nextSort=sorter?sorter.value:scheduleSort,
   nextFilter=filter?filter.value:scheduleCategoryFilter,
   nextAccount=schedulePicker?schedulePicker.value:scheduleAccount,
   edit=document.querySelector('[data-schedule-edit-form],[data-schedule-new-form]');
  const dirty=edit&&[...edit.querySelectorAll('input,select,textarea')].some(field=>{
   if(field.type==='hidden')return false;
   if(field.type==='checkbox'||field.type==='radio')return field.checked!==field.defaultChecked;
   if(field.tagName==='SELECT')return [...field.options].some(o=>o.selected!==o.defaultSelected);
   return field.value!==field.defaultValue;
  });
  if(dirty&&!window.confirm('Discard unsaved prediction edits to reorganize the list?')){
   e.target.value=sorter?scheduleSort:schedulePicker?scheduleAccount:scheduleCategoryFilter;return;
  }
  scheduleSort=nextSort;scheduleCategoryFilter=nextFilter;scheduleAccount=nextAccount;
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
  if(transfer)form?.querySelector('[data-schedule-advanced]')?.setAttribute('open','');
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
 if(e.target.matches?.('[data-history-category-filter]')){
  const next=e.target.value;
  if(recurrenceFormDirty('.history-page [data-history-inline-detail] form')&&
   !window.confirm('Discard unsaved prediction changes to filter bank history?')){
   e.target.value=historyCategoryFilter;return;
  }
  historyCategoryFilter=next;historyLimit=90;
  historyExpandedId='';historyExpandedAccount='';historyExpandedRuleId='';recurringDraft=null;
  render();return;
 }
 if(e.target.matches?.('[data-history-sort]')){
  const next=e.target.value;
  if(!['newest','oldest','amount-desc','amount-asc','merchant','category'].includes(next))return;
  if(recurrenceFormDirty('.history-page [data-history-inline-detail] form')&&
   !window.confirm('Discard unsaved prediction changes to sort bank activity?')){
   e.target.value=historySort;return;
  }
  historySort=next;historyLimit=90;
  historyExpandedId='';historyExpandedAccount='';historyExpandedRuleId='';recurringDraft=null;
  render();return;
 }
 if(e.target.name==='historyAccount'){
  historyAccount=e.target.value;historyLimit=90;render();return;
 }
 if(e.target.name==='scope'){
  const form=e.target.closest('[data-future-edit-form]');
  const impact=form?.closest('[data-inline-transaction-editor]')?.querySelector('[data-edit-impact]')||
   document.querySelector('[data-edit-impact]');
  if(impact)impact.textContent=e.target.value==='all'?
   'All future payments will change. Bank records stay unchanged.':
   'Only this payment will change.';
  const section=form?.querySelector('.future-repeat-fields');
  if(section)section.hidden=e.target.value!=='all';
  if(e.target.value==='all')updateHistoryLinks(form);
  return;
 }
 if(e.target.matches?.('[data-schedule-new-form] [name=date],[data-schedule-edit-form] [name=date]')){
  const holder=e.target.closest('form')?.querySelector('[data-schedule-posting-date]'),
   posted=window.HouseholdPlannerTransactions.forecastBusinessDate(e.target.value,snapshot().asOf);
  if(holder){holder.hidden=posted===e.target.value;holder.textContent=holder.hidden?'':'On Calendar: '+dateLong(posted)}
  return;
 }
 if(e.target.matches?.('[data-frequency]')){
  const form=e.target.closest('form');
  const second=form?.querySelector('.future-second-day');
  if(second)second.hidden=e.target.value!=='twice-monthly';
  if(e.target.value==='twice-monthly'&&form?.matches?.('[data-schedule-new-form],[data-schedule-edit-form]'))
   form.querySelector('[data-schedule-advanced]')?.setAttribute('open','');
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
  enterReal(newState,newSnapshot){forecastCache=null;liveState=newState;liveSnapshot=newSnapshot;selectedAccount=null;latestError='';clearAudit()},
  enterDemo(){forecastCache=null;liveState=null;liveSnapshot=null;selectedAccount=null;clearAudit()},
  enterUnavailable(){forecastCache=null;liveState=null;liveSnapshot=null;selectedAccount=null;clearAudit()}
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
 if(target)target.textContent=sha?'Focused Review v1 · Render '+sha.slice(0,9):'Focused Review v1 · Server unverified';
}).catch(()=>{});
})();