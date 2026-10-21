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
 const pin=locate(lowIndex),warnings=issues(bundle,accounts,chosen,prefs,ready),
  moves=(derived.events||[]).filter(e=>e.date>snapshot.asOf&&e.date<=last.date).length,
  quality=warnings?
   '<strong class="summary-risk">Needs review</strong> · Some payments may be missing or uncertain.':
   '<strong class="summary-ok">No flagged issues</strong> · Not a guarantee that every expense is captured.';
 const zero=!credit&&floor<0&&ceil>0?
  '<line x1="'+plotLeft+'" x2="'+plotRight+'" y1="'+y(0).toFixed(2)+'" y2="'+y(0).toFixed(2)+
  '" stroke="#c68687" stroke-width="1" stroke-dasharray="4 7"/>':'';
 const listed=lowDay.events||[];
 const causes=listed.length?listed.slice(0,2).map(e=>esc(e.merchant||'Expected payment')).join(' · ')+
  (listed.length>2?' · +'+(listed.length-2)+' more':''):'No dated transactions that day';
 return '<div class="planner-page summary-page"><section class="summary-stage">'+lead+
  '<div class="summary-numbers"><div><div class="summary-overline">'+
  (credit?'Lowest estimated card debt':'Lowest projected balance')+'</div>'+
  '<div class="summary-low'+(below?' summary-low-alert':'')+'">'+money(low)+'</div>'+
  '<div class="summary-date">'+esc(dateLabel(lowDay.date))+
  (negative?' · below $0':below?' · below your cash cushion':'')+'</div></div>'+
  '<div class="summary-end"><span>End of '+days+' days</span><strong>'+money(last.balance)+'</strong>'+
  '<small>'+esc(shortDate(last.date))+'</small></div></div>'+
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
  '<section class="summary-trust" aria-label="Forecast coverage"><div class="summary-trust-line">'+
  '<strong>Forecast coverage</strong><span>'+quality+'</span>'+
  (warnings?'<button type="button" data-view="reviews" class="summary-review-link">Review →</button>':'')+
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
root.HouseholdPlannerSummary={render,getPoints};
})(typeof window!=='undefined'?window:globalThis);
