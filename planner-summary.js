/* One quiet, inspectable balance forecast derived ONLY from the canonical future ledger.
   No new financial data source, confidence score, or automatic prediction is invented. */
(function(root){
'use strict';
let series=[],selected=0;
const range=(n,a,b)=>Math.max(a,Math.min(b,n));
const plotWidth=920,plotLeft=20,plotRight=900,top=18,bottom=274;
const money=n=>Number.isFinite(n)?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n):'Unverified';
const dateLabel=d=>new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
const shortDate=d=>new Date(d+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;'}[c]));
function getPoints(derived,asOf,days){
 const end=new Date(asOf+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+days);
 const through=end.toISOString().slice(0,10);
 return (derived?.series||[]).filter(x=>x.date>=asOf&&x.date<=through);
}

/* Daily calendar uses ONLY the same per-account daily projection and its
 * movements as the Summary balance graph and the Predictions tab. */
let calendarMonth='',calendarDate='',calendarAccount='',calendarAsOf='',calendarContext=null;
let extrasOpen=false,calendarEditor=null,calendarNotice='',calendarFocus=null,reviewOpen=false;
const monthName=m=>new Date(m+'-15T12:00:00Z').toLocaleDateString('en-US',
 {month:'long',year:'numeric',timeZone:'UTC'});
const signed=(e,card)=>card?
 (['card_purchase','transfer_out'].includes(e.kind)?1:-1):
 (['income','refund','transfer_in'].includes(e.kind)?1:-1);
const fullSigned=(e,card)=>(signed(e,card)>0?'+':'−')+money(Number(e.amount));
const shortMoney=n=>new Intl.NumberFormat('en-US',{
 style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(n);
const dayShort=d=>String(Number(d.slice(-2)));

const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const calendarTypes={expense:'Withdrawal',income:'Deposit',refund:'Refund',transfer:'Account transfer'};
const dateDelta=(a,b)=>Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000);
const moneyDelta=(e,card)=>signed(e,card)*Number(e.amount);
function knownGaps(prefs,asOf,through,accountId,points){
 const dates=new Map(),tools=root.HouseholdPlannerTransactions;
 if(!tools?.recurrenceDates)return dates;
 for(const r of prefs?.futureRecurringRules||[]){
  if(r.kind==='movement'||!['income','expense'].includes(r.type)||
   String(r.accountId)!==String(accountId)||!r.id)continue;
  for(const due of tools.recurrenceDates(r,asOf,through)){
   if(dateDelta(due,asOf)<=7)continue;
   const exists=points.some(p=>Math.abs(dateDelta(p.date,due))<=6&&
    (p.events||[]).some(e=>e.kind===r.type&&
     (String(e.recurringRuleId||'')===String(r.id)||
      norm(e.sourceMerchant||e.merchant)===norm(r.originalMerchant||r.merchant))));
   const skipped=Boolean(prefs?.futureTransactionEdits?.[
    tools.keyEvent('user|'+r.id+'|'+due,accountId)]?.skipped);
   if(exists||skipped)continue;
   const matches=dates.get(due)||[];
   matches.push({date:due,merchant:r.merchant||'Recurring payment',
    amount:Number(r.amount),type:r.type,accountId:String(accountId)});
   dates.set(due,matches);
  }
 }
 return dates;
}
const accountOptions=(accounts,chosen)=>accounts.map(a=>
 '<option value="'+esc(a.id)+'"'+(String(a.id)===String(chosen)?' selected':'')+
 '>'+esc(a.name||a.id)+'</option>').join('');
function quickEditor(){
 if(!calendarEditor)return '';
 const {mode,row,accountId,accounts,asOf,through}=calendarEditor;
 const entry=mode==='edit'?row:calendarEditor.preset||{},
  transfer=mode==='edit'?row.kind==='movement':entry.type==='transfer',
  kind=transfer?'transfer':entry.type||'expense',
  first=accountId||accounts[0]?.id,other=accounts.find(a=>String(a.id)!==String(first))?.id||first;
 const choices=mode==='add'?'<label>Type<select name="type" data-calendar-type>'+
  Object.entries(calendarTypes).filter(([k])=>k!=='transfer'||accounts.length>1)
   .map(([k,name])=>'<option value="'+k+'"'+(kind===k?' selected':'')+'>'+
    name+'</option>').join('')+'</select></label>':
   '<label>Type<strong>'+esc(transfer?'Account transfer':calendarTypes[kind]||'Payment')+
    '</strong><input type="hidden" name="type" value="'+esc(kind)+'"></label>';
 const repeatable=mode==='edit'&&row.seriesKey&&
  ['weekly','biweekly','every-4-weeks','monthly','quarterly','semiannual','annual','twice-monthly','twice monthly','every 2 weeks'].includes(row.cadence);
 return '<form data-calendar-quick-form="'+mode+'" class="calendar-quick-form"'+
  ' data-calendar-quick-key="'+esc(row?.key||'')+'" data-quick-kind="'+kind+'">'+
  '<div class="calendar-quick-head"><strong>'+(mode==='edit'?'Edit prediction':'Add prediction')+
   '</strong><button type="button" data-calendar-cancel aria-label="Close transaction editor">×</button></div>'+
  '<p>Forecast only · No changes to bank records</p>'+
  '<div class="calendar-quick-fields">'+choices+
   '<label>Description<input name="merchant" maxlength="160" placeholder="e.g. Insurance" value="'+
    esc(entry.merchant||'')+'" required></label>'+
   '<label>Amount ($)<input type="number" inputmode="decimal" name="amount" min=".01" max="999999999" step=".01" value="'+
    esc(entry.amount??'')+'" placeholder="0.00" required></label>'+
   '<label>Date<input type="date" name="date" min="'+esc(asOf)+'" max="'+esc(through)+
    '" value="'+esc(entry.date||calendarDate)+'" required></label>'+
   '<label class="calendar-single-account">Account<select name="accountId">'+
    accountOptions(accounts,entry.accountId||first)+'</select></label>'+
   '<label class="calendar-transfer-field">From<select name="fromAccountId">'+
    accountOptions(accounts,entry.fromAccountId||first)+'</select></label>'+
   '<label class="calendar-transfer-field">To<select name="toAccountId">'+
    accountOptions(accounts,entry.toAccountId||other)+'</select></label>'+
   (mode==='add'?'<label>Repeat<select name="frequency">'+
    [['once','One time'],['weekly','Weekly'],['biweekly','Every 2 weeks'],
    ['every-4-weeks','Every 4 weeks'],['monthly','Monthly'],
    ['quarterly','Every 3 months'],['annual','Every year']]
     .map(([v,name])=>'<option value="'+v+'">'+name+'</option>').join('')+
    '</select></label>':'')+'</div>'+
  (mode==='add'?'<label class="schedule-separate-choice"><input type="checkbox" name="separateSchedule"> This is an additional independent bill from a merchant I already use</label>':'')+
  (repeatable?'<fieldset class="calendar-quick-scope"><legend>Apply to</legend>'+
   '<label><input type="radio" name="scope" value="one" checked> This payment only</label>'+
   '<label><input type="radio" name="scope" value="all"> This and all future payments</label></fieldset>':'')+
  '<div class="calendar-quick-actions"><button class="btn primary" type="submit">'+
   (mode==='edit'?'Save changes':'Add to forecast')+'</button>'+
  '<button class="btn" type="button" data-calendar-cancel>Cancel</button>'+
  (mode==='edit'?'<button class="btn" type="button" data-calendar-skip>Skip payment</button>':'')+
  '</div><p class="calendar-quick-error" role="alert" data-calendar-error></p></form>';
}


function postedDay(date){
 const rows=calendarContext.actual.get(date)||[];
 const body=rows.map(t=>{
  const incoming=['income','refund'].includes(t.type)||t.type==='transfer'&&t.cashDirection==='in';
  return '<div class="calendar-detail-item calendar-actual-row"><span class="calendar-transaction-name">'+
   esc(t.merchant||'Bank transaction')+
   '<small>'+(t.pending?'Pending bank transaction':'Posted bank transaction')+'</small></span>'+
   '<strong class="'+(incoming?'in':'out')+'">'+(incoming?'+':'−')+money(Number(t.amount))+
   '</strong><button type="button" class="calendar-item-edit" data-calendar-history-plan="'+
   esc(t.id)+'" data-history-account="'+esc(calendarContext.chosen)+'">Make recurring</button></div>';
 }).join('');
 return '<section class="calendar-day-detail calendar-actual-detail" data-calendar-detail>'+
  '<div class="calendar-detail-heading"><div><span>BANK HISTORY · NOT A PREDICTION</span><strong>'+
   esc(dateLabel(date))+'</strong></div><div class="calendar-detail-balance"><small>Recorded transactions</small>'+
   '<strong>'+rows.length+'</strong></div></div>'+
  (rows.length?'<div class="calendar-detail-items">'+body+'</div>':
   '<p class="calendar-empty">No bank transactions recorded on this date.</p>')+
  '<p class="calendar-actual-note">Past balances cannot be reconstructed from today’s balance. Bank records remain unchanged.</p>'+
  '<button type="button" class="calendar-edit" data-view="history">All bank history →</button></section>';
}
function coverageChecklist(){
 const coverage=calendarContext?.coverage,month=calendarMonth;
 const idx=coverage?.months?.findIndex(m=>m.key===month)??-1;
 if(idx<0)return '';
 const rows=coverage.rows.map((r,i)=>{
  const cell=r.cells[idx];if(!cell)return '';
  const warning=['missing','setup','review','unknown'].includes(cell.status),
   ok=['covered','posted'].includes(cell.status),
   label=ok?'Included':cell.status==='external'?'Other account':
    cell.status==='na'?'Not due':warning?'Review':'Check';
  return '<button type="button" class="calendar-check-row'+(warning?' needs-review':'')+
   '" data-coverage-focus="'+i+'|'+idx+'" title="'+esc(cell.detail)+'" aria-label="'+
   esc(r.title+', '+label+'. '+cell.detail)+'"><span class="calendar-check-icon">'+
   (ok?'✓':warning?'!':'—')+'</span><span>'+esc(r.title)+'</span>'+
   '<strong>'+label+'</strong></button>';
 }).join('');
 return '<div class="calendar-checklist" aria-label="Monthly payment checklist">'+
  '<div class="calendar-check-heading"><strong>Major payments · '+esc(monthName(month))+
  '</strong><small>Tap a payment to inspect</small></div>'+
  '<div class="calendar-check-rows">'+rows+'</div></div>';
}
function dayDetail(point,card){
 const events=point.events||[],first=calendarContext.points[0],
  previousIndex=calendarContext.points.indexOf(point)-1,
  previous=previousIndex>=0?calendarContext.points[previousIndex].balance:point.balance,
  plus=events.reduce((n,e)=>n+Math.max(0,moneyDelta(e,card)),0),
  minus=events.reduce((n,e)=>n+Math.max(0,-moneyDelta(e,card)),0),
  gaps=calendarContext.gaps.get(point.date)||[],
  label=card?'Projected card debt':'Projected account balance';
 return '<section class="calendar-day-detail" data-calendar-detail aria-label="Selected day predictions">'+
  '<div class="calendar-detail-heading"><div><span>SELECTED DAY</span><strong>'+
   esc(dateLabel(point.date))+'</strong></div><div class="calendar-detail-balance"><small>'+
   label+' · end of day</small><strong>'+money(point.balance)+'</strong></div></div>'+
  '<div class="calendar-math">'+
   '<div><span>'+(previousIndex<0?'Reported starting balance':'Yesterday')+'</span><strong>'+money(previous)+'</strong></div>'+
   '<div><span>'+(card?'Debt increases':'Deposits')+'</span><strong class="in">+'+money(plus)+'</strong></div>'+
   '<div><span>'+(card?'Debt payments':'Withdrawals')+'</span><strong class="out">−'+money(minus)+'</strong></div>'+
   '<div class="calendar-math-total"><span>End of day</span><strong>'+money(point.balance)+'</strong></div></div>'+
  (events.length?'<div class="calendar-detail-items">'+events.map((e,i)=>{
   const dir=signed(e,card)>0?'in':'out';
   return '<button type="button" class="calendar-detail-item calendar-tap-edit" data-calendar-edit="'+i+'"><span class="calendar-transaction-name">'+
    esc(e.merchant||'Predicted transaction')+
    (e.kind==='transfer_in'||e.kind==='transfer_out'?'<small>Linked transfer</small>':e.amountEstimate?'<small>Estimated prediction</small>':'<small>Predicted · not posted</small>')+
    '</span><strong class="'+dir+'">'+fullSigned(e,card)+'</strong>'+
    '<span class="calendar-item-edit">Edit</span></button>';
  }).join('')+'</div>':
   '<p class="calendar-empty">'+(point.date===first.date?
    'Starting balance. No future transactions yet.':
    'No predicted transactions on this day. Balance carries forward.')+'</p>')+
  (gaps.length?'<div class="calendar-gaps"><strong>Expected, not predicted</strong>'+
   gaps.map((g,i)=>'<div><span>'+esc(g.merchant)+' · '+money(g.amount)+
    '</span><button type="button" data-calendar-fill-gap="'+i+'">Review and add</button></div>').join('')+
   '<small>Only confirmed schedules. These items do not change your balance.</small></div>':'')+
  (calendarNotice?'<p class="calendar-notice" role="status">'+esc(calendarNotice)+'</p>':'')+
  (calendarEditor?'<button type="button" class="calendar-editor-backdrop" data-calendar-cancel aria-label="Close editor"></button>':'')+
  quickEditor()+
  '<div class="calendar-day-actions"><button type="button" class="calendar-add" data-calendar-add'+
   (point.date===first.date?' disabled':'')+'>+ Add transaction</button>'+
   '<button type="button" class="calendar-edit" data-view="transactions">All predictions →</button></div>'+
 '</section>';
}

function monthlyPredictions(state){
 const rows=state.points.filter(p=>p.date.startsWith(calendarMonth)).flatMap(p=>
  (p.events||[]).map((e,i)=>({date:p.date,event:e,index:i})));
 const credit=state.card;
 const deposits=rows.filter(r=>signed(r.event,credit)>0)
  .reduce((sum,r)=>sum+Number(r.event.amount||0),0),
  withdrawals=rows.filter(r=>signed(r.event,credit)<=0)
  .reduce((sum,r)=>sum+Number(r.event.amount||0),0);
 const uncertain=!credit?(state.cardEstimates||[]).filter(c=>!c.eligible):[];
 const unplanned=uncertain.length?'<div class="calendar-monthly-unplanned"><strong>Card payments not yet included</strong>'+
  uncertain.map(c=>'<div><span>'+esc(c.cardName)+' · '+money(Number(c.observedCharges||0))+
   ' in recent posted purchases (not an issued statement)</span>'+
   '<button type="button" class="btn" data-view="settings">Set payment date →</button></div>').join('')+'</div>':'';
 return '<details class="calendar-monthly-list" open>'+
  '<summary>All '+rows.length+' predicted transactions in '+esc(monthName(calendarMonth))+
   '<span>View every dated prediction</span></summary>'+
  '<div class="calendar-monthly-totals"><span>'+esc(credit?'Debt increases':'Deposits')+
   ': <strong>'+money(deposits)+'</strong></span><span>'+
   esc(credit?'Debt reductions':'Withdrawals')+': <strong>'+money(withdrawals)+'</strong></span></div>'+
  (rows.length?'<div class="calendar-monthly-rows">'+rows.map(({date,event:e,index})=>
   '<button type="button" class="calendar-monthly-row" data-calendar-list-date="'+date+
   '" data-calendar-list-index="'+index+'"><span class="calendar-monthly-date">'+esc(shortDate(date))+
   '</span><span class="calendar-monthly-name">'+esc(e.merchant||'Predicted payment')+
   (e.amountEstimate?'<small>Estimated</small>':'')+'</span>'+
   '<strong class="'+(signed(e,credit)>0?'in':'out')+'">'+fullSigned(e,credit)+
   '</strong><span class="calendar-monthly-view">View</span></button>').join('')+
   '</div>':'<p class="calendar-empty">No predicted deposits or withdrawals for the selected account this month.</p>')+
   unplanned+'</details>';
}
function calendarGrid(){
 const state=calendarContext;
 if(!state||!state.points.length)return '';
 const keys=[...new Set([...state.points.map(p=>p.date.slice(0,7)),
  ...[...state.actual.keys()].map(d=>d.slice(0,7))])].sort();
 if(!keys.includes(calendarMonth))calendarMonth=keys[0];
 const currentPoints=state.points.filter(p=>p.date.startsWith(calendarMonth));
 if(!currentPoints.length&&![...state.actual.keys()].some(d=>d.startsWith(calendarMonth)))return '';
 if(!currentPoints.some(p=>p.date===calendarDate)&&!state.actual.has(calendarDate))
  calendarDate=currentPoints[0]?.date||[...state.actual.keys()].find(d=>d.startsWith(calendarMonth));
 const start=calendarMonth+'-01',
  firstWeek=(new Date(start+'T12:00:00Z').getUTCDay()+6)%7,
  monthDays=new Date(Number(calendarMonth.slice(0,4)),
   Number(calendarMonth.slice(5,7)),0).getDate(),
  count=Math.ceil((firstWeek+monthDays)/7)*7,
  points=new Map(currentPoints.map(p=>[p.date,p])),
  caption=state.card?'Card debt after daily activity':'Account balance after daily activity';
 const header=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>
  '<div class="calendar-weekday" aria-hidden="true">'+d+'</div>').join('');
 const cells=Array.from({length:count},(_,i)=>{
  const dom=i-firstWeek+1;
  if(dom<1||dom>monthDays)return '<div class="calendar-blank" aria-hidden="true"></div>';
  const iso=calendarMonth+'-'+String(dom).padStart(2,'0'),p=points.get(iso);
  if(!p&&state.actual.has(iso)){
   const rows=state.actual.get(iso)||[];
   return '<button type="button" class="calendar-day actual'+(calendarDate===iso?' selected':'')+
    '" data-calendar-actual-day="'+iso+'" aria-label="'+esc(dateLabel(iso)+', '+
    rows.length+' actual bank transactions, no predicted balance')+'">'+
    '<span class="calendar-day-number">'+dom+'</span><span class="calendar-day-balance">'+(rows.length?rows.every(t=>t.pending)?'Pending':'Bank activity':'No activity')+'</span>'+
    '<span class="calendar-day-events">'+rows.slice(0,2).map(t=>
     '<span class="calendar-event"><span class="calendar-event-name">'+
     esc(t.merchant||'Transaction')+'</span></span>').join('')+
    (rows.length>2?'<span class="calendar-more">+'+(rows.length-2)+' more</span>':'')+
    '</span></button>';
  }
  if(!p)return '<div class="calendar-outside" aria-hidden="true"><span>'+
   dom+'</span></div>';
  const events=p.events||[],gaps=state.gaps.get(iso)||[],low=!state.card&&p.balance<state.cushion,
   negative=!state.card&&p.balance<0,
   delta=events.slice(0,2).map(e=>{
    const amount=(signed(e,state.card)>0?'+':'−')+shortMoney(Number(e.amount));
    return '<span class="calendar-event '+(signed(e,state.card)>0?'in':'out')+
     '" title="'+esc((e.merchant||'Predicted transaction')+' '+fullSigned(e,state.card))+'">'+
     '<span class="calendar-event-name">'+esc(e.merchant||'Payment')+'</span>'+
     '<span class="calendar-event-amount">'+amount+'</span></span>';
   }).join('');
  const aria=dateLabel(iso)+', '+money(p.balance)+
   (events.length?', '+events.length+' predicted transaction'+(events.length===1?'':'s'):
    ', no predicted transactions')+
   (negative?', below zero':low?', below cash cushion':'');
  return '<button type="button" class="calendar-day'+
   (calendarDate===iso?' selected':'')+(iso===state.asOf?' today':'')+
   (calendarFocus?.dates?.includes(iso)?' coverage-highlight':'')+
   (negative?' negative':low?' low':'')+
   '" data-calendar-day="'+iso+'" aria-pressed="'+(calendarDate===iso)+
   '" aria-label="'+esc(aria)+'">'+
   '<span class="calendar-day-number">'+dom+'</span>'+
   '<span class="calendar-day-balance"><span class="calendar-money-wide">'+
    money(p.balance)+'</span><span class="calendar-money-narrow">'+
    shortMoney(p.balance)+'</span></span>'+
   '<span class="calendar-day-events">'+delta+
    (events.length>2?'<span class="calendar-more">+'+(events.length-2)+' more</span>':'')+
    (gaps.length?'<span class="calendar-unplanned">? '+esc(gaps[0].merchant)+'</span>':'')+
   '</span></button>';
 }).join('');
 const index=keys.indexOf(calendarMonth);
 const active=state.points.find(p=>p.date===calendarDate)||currentPoints[0];
 return '<div class="calendar-wrapper" data-calendar-stage>'+
  '<div class="calendar-navigation">'+
   '<div><h2>'+esc(monthName(calendarMonth))+'</h2><small>'+caption+'</small></div>'+
   '<div class="calendar-nav-actions"><button type="button" data-calendar-nav="-1"'+
    (index===0?' disabled':'')+' aria-label="Previous forecast month">‹</button>'+
   '<button type="button" class="calendar-today" data-calendar-today'+
    (calendarMonth===keys[0]&&calendarDate===state.asOf?' disabled':'')+
    '>Start</button>'+
   '<button type="button" data-calendar-nav="1"'+
    (index===keys.length-1?' disabled':'')+' aria-label="Next forecast month">›</button></div>'+
  '</div>'+coverageChecklist()+'<div class="calendar-grid" role="group" aria-label="'+
   esc(monthName(calendarMonth)+' forecast calendar')+'">'+header+cells+'</div>'+
   (active?.date===calendarDate?dayDetail(active,state.card):postedDay(calendarDate))+
   monthlyPredictions(state)+'</div>';
}
function showCalendar(date){
 if(!calendarContext||!calendarContext.points.some(p=>p.date===date)&&
  !calendarContext.actual.has(date))return;
 calendarDate=date;calendarMonth=date.slice(0,7);calendarEditor=null;calendarNotice='';
 const stage=document.querySelector('[data-calendar-stage]');
 if(stage)stage.outerHTML=calendarGrid();
}

function reviewDetails(bundle,accounts,chosen,prefs,ready,coverage){
 const rows=[],seen=new Set();
 const add=(label,detail,action='reviews',month=null,index=null)=>{
  const key=[label,detail,month,index].join('|');
  if(seen.has(key))return;seen.add(key);
  rows.push({label:String(label),detail:String(detail),action,month,index});
 };
 for(const card of accounts.filter(a=>String(a.accountType||a.type)==='credit'&&
  !ready(prefs?.paymentRules?.[a.id],a,accounts))){
  const candidate=(bundle?.payments?.cardEstimates||[]).find(c=>String(c.cardId)===String(card.id));
  add(card.name+' · card payment',candidate?.eligible?
   'A provisional monthly checking withdrawal is included using paired Plaid transfers. The amount is an estimate, not an issued statement. Confirm its cycle and withdrawal date in Settings.':
   'No checking withdrawal has been forecast. Settled Plaid card spending over the last 30 days: '+
    money(Number(candidate?.observedCharges||0))+
    '. This is not necessarily the issued statement balance. The paying account and payment date cannot be established from purchases alone. '+
    (candidate?.reason||'Confirm card billing and payment details.'),'settings');
 }
 for(const item of (bundle?.historyCandidates||[]).filter(t=>String(t.accountId)===String(chosen.id)))
  add(item.merchant||'Recurring suggestion','Potential repeating payment; '+(item.reason||'Review its bank history.'),'reviews');
 for(const item of (bundle?.missingMortgages||[]).filter(t=>String(t.accountId)===String(chosen.id)))
  add(item.merchant||'Mortgage','Potential missing mortgage prediction: '+(item.reason||'Review the bank transaction.'),'reviews');
 for(const item of bundle?.duplicateConflicts||[]){
  if(item.accountId&&String(item.accountId)!==String(chosen.id))continue;
  add(item.merchant||'Duplicate prediction',item.reason||'This prediction needs review.','reviews');
 }
 for(const message of [...(bundle?.payments?.warnings||[]),...(bundle?.routines?.warnings||[])])
  if(!accounts.some(c=>String(c.accountType||c.type)==='credit'&&
   !ready(prefs?.paymentRules?.[c.id],c,accounts)&&String(message).startsWith(c.name+':')))
   add('Forecast warning',message,'reviews');
 for(const issue of bundle?.projection?.diagnostics?.unassigned||[])
  add('Unassigned payment',issue.merchant||issue.reason||'A payment is missing its account.','reviews');
 for(const issue of bundle?.projection?.diagnostics?.unmatchedTransfers||[])
  add('Unmatched transfer',issue.merchant||issue.reason||'A transfer is missing its counterpart.','reviews');
 // Coverage rows describe specific future months, not generic review counts.
 (coverage?.rows||[]).forEach((row,i)=>(row.cells||[]).forEach((cell,j)=>{
  if(!['missing','setup','review','unknown'].includes(cell.status))return;
  add(row.title+' · '+coverage.months[j].key,cell.detail,'coverage',j,i);
 }));
 return rows;
}
function reviewPanel(items){
 if(!items.length)return '';
 return '<section class="summary-review-details"'+(reviewOpen?'':' hidden')+
  ' aria-label="Payments and predictions needing review">'+
  '<strong>What needs attention?</strong>'+
  '<p>These are specific forecast uncertainties, not additional withdrawals. Select an item to inspect it.</p>'+
  items.map((x,i)=>'<div class="summary-review-row"><div><strong>'+esc(x.label)+
   '</strong><small>'+esc(x.detail)+'</small></div>'+
   '<button class="btn" type="button" '+(x.action==='coverage'?
    'data-coverage-focus="'+x.index+'|'+x.month+'"':
    'data-view="'+x.action+'"')+'>'+
    (x.action==='coverage'?'Inspect':x.action==='settings'?'Set up card':'Review')+
   '</button></div>').join('')+'</section>';
}
function issues(bundle,accounts,chosen,prefs,ready){
 const match=x=>String(x.accountId||'')===String(chosen.id);
 const pending=[...(bundle?.historyCandidates||[]).filter(match),
  ...(bundle?.missingMortgages||[]).filter(match),
  ...(bundle?.duplicateConflicts||[]).filter(match)].length;
 const general=(bundle?.payments?.warnings||[]).length+
  (bundle?.routines?.warnings||[]).length+
  (bundle?.projection?.diagnostics?.unassigned||[]).length+
  (bundle?.projection?.diagnostics?.unmatchedTransfers||[]).length;
 const missing=accounts.filter(a=>String(a.accountType||a.type)==='credit'&&
  !ready(prefs?.paymentRules?.[a.id],a,accounts)).length;
 return pending+general+missing;
}
function render({snapshot,chosen,derived,bundle,days,prefs,accounts,fresh,ready}){
 const credit=String(chosen.accountType||chosen.type)==='credit';
 const choices=[30,60,90,120,180,360].map(n=>
  '<button type="button" data-summary-days="'+n+'" aria-pressed="'+(days===n)+
  '" class="summary-range'+(days===n?' active':'')+'">'+n+'d</button>').join('');
 const options=accounts.map(a=>'<option value="'+esc(a.id)+'"'+
  (String(a.id)===String(chosen.id)?' selected':'')+'>'+
  esc(a.name+(a.mask?' · '+a.mask:'')+(String(a.id)===String(prefs?.primaryAccountId)?' · Main':''))+
  '</option>').join('');
 const lead='<div class="summary-heading"><span class="summary-eyebrow">YOUR FORECAST</span>'+
  '<label class="summary-account-picker">Account <select id="summary-account" aria-label="Summary account">'+
  options+'</select></label></div>'+
  '<div class="summary-ranges" role="group" aria-label="Forecast period">'+choices+'</div>';
 const points=getPoints(derived,snapshot.asOf,days);
 series=fresh&&points.length>=2&&points.every(p=>Number.isFinite(p.balance))?points:[];
 if(calendarAccount!==String(chosen.id)||calendarAsOf!==snapshot.asOf){
  calendarAccount=String(chosen.id);calendarAsOf=snapshot.asOf;
  calendarMonth=snapshot.asOf.slice(0,7);calendarDate=snapshot.asOf;calendarFocus=null;
   calendarEditor=null;calendarNotice='';
 }
 const actual=new Map(),accountOf=root.HouseholdPlannerHistory?.accountOf;
 for(let n=45;n>=1;n--){
  const dt=new Date(snapshot.asOf+'T12:00:00Z');dt.setUTCDate(dt.getUTCDate()-n);
  actual.set(dt.toISOString().slice(0,10),[]);
 }
 for(const r of bundle?.rows||[]){
  if(!actual.has(r.date)||String(accountOf?.(r,accounts)||r.accountId)!==String(chosen.id))continue;
  actual.get(r.date).push(r);
 }
 calendarContext={points:series,actual,coverage:null,asOf:snapshot.asOf,card:credit,
  cardEstimates:bundle?.payments?.cardEstimates||[],
  cushion:Number(prefs?.cashCushion??500),accounts,
  chosen:String(chosen.id),through:series.at(-1)?.date,
  gaps:!credit&&series.length>1?knownGaps(prefs,snapshot.asOf,
   series.at(-1).date,chosen.id,series):new Map()};
 if(series.length<2)return '<div class="planner-page summary-page"><section class="summary-stage">'+lead+
  '<div class="summary-empty">A current, verifiable account balance is required before this forecast can be shown. Refresh your bank data and check its balance date.</div>'+
  '</section></div>';
 const vals=series.map(p=>p.balance),low=Math.min(...vals),high=Math.max(...vals),
  pad=Math.max(50,(high-low)*.14),floor=low-pad,ceil=high+pad,
  x=i=>plotLeft+i*(plotRight-plotLeft)/(series.length-1),
  y=v=>bottom-(v-floor)/(ceil-floor)*(bottom-top),
  locate=i=>[x(i).toFixed(2),y(vals[i]).toFixed(2)];
 const path=series.map((p,i)=>{const [a,b]=locate(i);return (i?'L':'M')+a+' '+b}).join(' ');
 const lowIndex=vals.indexOf(low),first=series[0],last=series.at(-1),lowDay=series[lowIndex],
  cushion=Number(prefs?.cashCushion??500),below=!credit&&low<cushion,
  negative=!credit&&low<0;
 selected=lowIndex;
 const coverageTool=root.HouseholdPlannerCoverage;
 const coverage=coverageTool?.analyze?.({snapshot,chosen,bundle,prefs,days,accounts,ready});
 calendarContext.coverage=coverage;
 const coverageHtml=coverage?coverageTool.render(coverage):'';
 const pin=locate(lowIndex),
  reviews=reviewDetails(bundle,accounts,chosen,prefs,ready,coverage),
  warnings=reviews.length,
  moves=(derived.events||[]).filter(e=>e.date>snapshot.asOf&&e.date<=last.date).length,
  emptySchedule=moves===0,
  quality=emptySchedule?
   '<strong class="summary-risk">No dated predictions yet</strong> · The balance may be incomplete.':
   warnings?
   '<strong class="summary-risk">Needs review</strong> · Some payments may be missing or uncertain.':
   '<strong class="summary-ok">No flagged issues</strong> · Not a guarantee that every expense is captured.';
 const zero=!credit&&floor<0&&ceil>0?
  '<line x1="'+plotLeft+'" x2="'+plotRight+'" y1="'+y(0).toFixed(2)+'" y2="'+y(0).toFixed(2)+
  '" stroke="#c68687" stroke-width="1" stroke-dasharray="4 7"/>':'';
 const listed=lowDay.events||[];
 const causes=listed.length?listed.slice(0,2).map(e=>esc(e.merchant||'Expected payment')).join(' · ')+
  (listed.length>2?' · +'+(listed.length-2)+' more':''):'No dated transactions that day';
 return '<div class="planner-page summary-page"><section class="summary-stage">'+lead+
  '<div class="summary-numbers"><div class="summary-current"><div class="summary-overline">'+(credit?'Reported card debt':'Available now')+' · '+esc(shortDate(snapshot.asOf))+'</div><strong>'+money(first.balance)+'</strong></div><div><div class="summary-overline">'+
  (credit?'Lowest estimated card debt':'Lowest projected balance')+'</div>'+
  '<div class="summary-low'+(below?' summary-low-alert':'')+'">'+money(low)+'</div>'+
  '<div class="summary-date">'+esc(dateLabel(lowDay.date))+
  (negative?' · below $0':below?' · below your cash cushion':'')+'</div></div>'+
  '<div class="summary-end"><span>End of '+days+' days</span><strong>'+money(last.balance)+'</strong>'+
  '<small>'+esc(shortDate(last.date))+'</small></div><div class="summary-coverage-metric"><span>Payment checklist</span>'+
  (warnings?'<button type="button" data-summary-review-toggle aria-expanded="'+reviewOpen+
   '" class="summary-review-trigger">'+warnings+' to review <span>⌄</span></button>':
   '<strong>No flagged gaps</strong>')+'</div></div>'+
  reviewPanel(reviews)+calendarGrid()+'</section>'+
  '<details class="summary-extras"'+(extrasOpen?' open':'')+'><summary>Balance trend &amp; coverage checks</summary>'+
  '<section class="summary-stage summary-legacy">'+
  '<div class="summary-plot"><svg data-summary-plot role="img" tabindex="0" viewBox="0 0 '+plotWidth+
  ' 294" aria-label="Interactive '+days+'-day forecast. Use arrow keys or tap the curve to inspect a day.">'+
  '<defs><linearGradient id="summary-blue-fill" x1="0" y1="0" x2="0" y2="1">'+
  '<stop offset="0" stop-color="#315ebd" stop-opacity=".14"/><stop offset="1" stop-color="#315ebd" stop-opacity="0"/></linearGradient></defs>'+
  '<line x1="'+plotLeft+'" x2="'+plotRight+'" y1="'+bottom+'" y2="'+bottom+'" stroke="#e8edf2"/>'+
  zero+'<path d="'+path+' L '+plotRight+' '+bottom+' L '+plotLeft+' '+bottom+
  ' Z" fill="url(#summary-blue-fill)"/>'+
  '<path d="'+path+'" stroke="#315ebd" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/>'+
  '<circle cx="'+pin[0]+'" cy="'+pin[1]+'" r="6" fill="'+(below?'#b9444b':'#315ebd')+
  '" stroke="#fff" stroke-width="3"/>'+
  '<line data-summary-cursor x1="'+pin[0]+'" x2="'+pin[0]+'" y1="'+top+'" y2="'+bottom+
  '" stroke="#8395ae" stroke-width="1" stroke-dasharray="3 7"/>'+
  '<circle data-summary-dot cx="'+pin[0]+'" cy="'+pin[1]+'" r="7" stroke="#315ebd" stroke-width="2.5" fill="#fff"/>'+
  '</svg><div class="summary-axis"><span>'+esc(shortDate(first.date))+'</span><span>'+
  esc(shortDate(last.date))+'</span></div></div>'+
  '<div class="summary-peek" aria-live="off"><div><span data-summary-peek-date>'+esc(dateLabel(lowDay.date))+
  '</span><strong data-summary-peek-amount>'+money(low)+'</strong></div>'+
  '<small data-summary-peek-events>'+causes+'</small></div>'+
  '<div class="summary-caption">'+(credit?'Credit card debt · Higher means more owed':
  'Spendable cash · From scheduled deposits and withdrawals')+' · '+
  moves+' dated movement'+(moves===1?'':'s')+
  '<span>Tap or move along the curve to explore a day</span></div></section>'+
  coverageHtml+'</details>'+
  '<section class="summary-trust" aria-label="Forecast coverage"><div class="summary-trust-line">'+
  '<strong>Forecast coverage</strong><span>'+quality+'</span>'+
  (emptySchedule?'<button type="button" data-view="transactions" class="summary-review-link">Add predictions →</button>':
   warnings?'<button type="button" data-summary-review-toggle aria-expanded="'+reviewOpen+
    '" class="summary-review-link">Show '+warnings+' issues →</button>':'')+
  '</div><p>Includes scheduled and detected recurring payments; excludes unplanned everyday spending.'+
  (days>=120?' Longer-range forecasts are less certain.':'')+
  '</p></section></div>';
}
function setDay(index){
 const svg=document.querySelector('[data-summary-plot]');
 if(!svg||!series.length)return;
 selected=range(index,0,series.length-1);
 const point=series[selected],vals=series.map(p=>p.balance),
  lo=Math.min(...vals),hi=Math.max(...vals),pad=Math.max(50,(hi-lo)*.14),
  x=plotLeft+selected*(plotRight-plotLeft)/(series.length-1),
  y=bottom-(point.balance-(lo-pad))/(hi+pad-(lo-pad))*(bottom-top);
 const guide=svg.querySelector('[data-summary-cursor]'),dot=svg.querySelector('[data-summary-dot]');
 guide.setAttribute('x1',x);guide.setAttribute('x2',x);
 dot.setAttribute('cx',x);dot.setAttribute('cy',y);
 document.querySelector('[data-summary-peek-date]').textContent=dateLabel(point.date);
 document.querySelector('[data-summary-peek-amount]').textContent=money(point.balance);
 const events=point.events||[];
 document.querySelector('[data-summary-peek-events]').textContent=events.length?
  events.slice(0,2).map(e=>e.merchant||'Expected payment').join(' · ')+
  (events.length>2?' · +'+(events.length-2)+' more':''):'No dated transactions that day';
 svg.setAttribute('aria-valuetext',dateLabel(point.date)+': '+money(point.balance));
}
function byPointer(e){
 const svg=e.target.closest?.('[data-summary-plot]');
 if(!svg||series.length<2)return;
 const rect=svg.getBoundingClientRect();
 const position=(e.clientX-rect.left)/rect.width;
 setDay(Math.round((position*plotWidth-plotLeft)/(plotRight-plotLeft)*(series.length-1)));
}
document.addEventListener('pointermove',e=>{
 if(e.pointerType!=='touch')byPointer(e);
});
document.addEventListener('click',byPointer);
document.addEventListener('keydown',e=>{
 if(!e.target.matches?.('[data-summary-plot]')||
  !['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 e.preventDefault();
 setDay(e.key==='Home'?0:e.key==='End'?series.length-1:
  selected+(e.key==='ArrowRight'?1:-1));
});
document.addEventListener('click',e=>{
 const review=e.target.closest?.('[data-summary-review-toggle]');
 if(review){
  reviewOpen=!reviewOpen;
  const panel=document.querySelector('.summary-review-details');
  if(panel)panel.hidden=!reviewOpen;
  document.querySelectorAll('[data-summary-review-toggle]').forEach(b=>
   b.setAttribute('aria-expanded',String(reviewOpen)));
  if(reviewOpen)panel?.scrollIntoView({behavior:'smooth',block:'nearest'});
  return;
 }
 const monthly=e.target.closest?.('[data-calendar-list-date]');
 if(monthly){
  showCalendar(monthly.dataset.calendarListDate);
  document.querySelector('[data-calendar-detail]')?.scrollIntoView({block:'nearest',behavior:'smooth'});
  return;
 }
 const legacy=e.target.closest?.('.summary-extras > summary');
 if(legacy){extrasOpen=!legacy.parentElement.open;return;}
 const coverageButton=e.target.closest?.('[data-coverage-focus]');
 if(coverageButton){
  const [ri,mi]=coverageButton.dataset.coverageFocus.split('|').map(Number),
   cell=calendarContext?.coverage?.rows?.[ri]?.cells?.[mi],
   dates=(cell?.items||[]).map(x=>x.date).filter(Boolean);
  calendarFocus={dates};
  const selectedDate=dates.find(d=>calendarContext.points.some(p=>p.date===d)||calendarContext.actual.has(d));
  if(selectedDate)showCalendar(selectedDate);
  else{const stage=document.querySelector('[data-calendar-stage]');if(stage)stage.outerHTML=calendarGrid();}
  if(!selectedDate||['missing','review','setup','unknown'].includes(cell?.status)){
   const extra=document.querySelector('.summary-extras');if(extra){extra.open=true;extrasOpen=true;}
   const target=document.querySelector('[data-coverage-cell="'+(ri*calendarContext.coverage.months.length+mi)+'"]');
   target?.click();target?.scrollIntoView({block:'nearest',behavior:'smooth'});
  }
  return;
 }
 const actual=e.target.closest?.('[data-calendar-actual-day]');
 if(actual){showCalendar(actual.dataset.calendarActualDay);return;}
 const day=e.target.closest?.('[data-calendar-day]');
 if(day){showCalendar(day.dataset.calendarDay);return;}
 const nav=e.target.closest?.('[data-calendar-nav]');
 if(nav&&calendarContext?.points?.length){
  const keys=[...new Set([...calendarContext.points.map(p=>p.date.slice(0,7)),
  ...[...calendarContext.actual.keys()].map(d=>d.slice(0,7))])].sort(),
   index=keys.indexOf(calendarMonth),next=keys[index+Number(nav.dataset.calendarNav)];
  if(next)showCalendar(calendarContext.points.find(p=>p.date.startsWith(next))?.date||
   [...calendarContext.actual.keys()].find(d=>d.startsWith(next)));

  return;
 }
 if(e.target.closest?.('[data-calendar-today]')&&calendarContext?.points?.length)
  showCalendar(calendarContext.points[0].date);
});
document.addEventListener('keydown',e=>{
 const target=e.target.closest?.('[data-calendar-day]');
 if(!target||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||
  !calendarContext)return;
 const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[e.key],
  days=calendarContext.points,idx=days.findIndex(p=>p.date===target.dataset.calendarDay);
 if(idx<0)return;
 e.preventDefault();
 const next=days[range(idx+delta,0,days.length-1)];
 showCalendar(next.date);
 document.querySelector('[data-calendar-day="'+next.date+'"]')?.focus();
});

root.HouseholdPlannerSummary={render,getPoints,
 currentDay:()=>calendarDate,
 currentEvent:index=>{
  const point=calendarContext?.points.find(p=>p.date===calendarDate);
  return point?.events?.[Number(index)]||null;
 },
 currentGap:index=>calendarContext?.gaps.get(calendarDate)?.[Number(index)]||null,
 openEditor:draft=>{
  if(!calendarContext?.points.some(p=>p.date===calendarDate))return;
  calendarEditor={...draft,accountId:calendarContext.chosen,
   accounts:calendarContext.accounts,asOf:calendarContext.asOf,
   through:calendarContext.through};
  calendarNotice='';
  const stage=document.querySelector('[data-calendar-stage]');
  if(stage)stage.outerHTML=calendarGrid();
 },
 closeEditor:()=>{
  calendarEditor=null;
  const stage=document.querySelector('[data-calendar-stage]');
  if(stage)stage.outerHTML=calendarGrid();
 },
 refreshNotice:message=>{
  calendarEditor=null;calendarNotice=message||'';
  const stage=document.querySelector('[data-calendar-stage]');
  if(stage)stage.outerHTML=calendarGrid();
 }
};
})(typeof window!=='undefined'?window:globalThis);
