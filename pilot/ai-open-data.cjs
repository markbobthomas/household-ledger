'use strict';
// Read-only, model-visible financial source. This is a broad structured
// snapshot, NOT a set of chosen financial hypotheses or finding categories.
// Never serialize raw provider objects, owner IDs, tokens, personal notes,
// account numbers or source transaction identifiers.
const {cleanDescription}=require('./ai-private-adapter.cjs');
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v);
const money=v=>Math.round((v+Number.EPSILON)*100)/100;
const safe=v=>cleanDescription(String(v??'')).slice(0,100);
const READ_TOOL={type:'function',function:{
 name:'read_financial_dataset',
 description:'Read the actual sanitized Ledger financial dataset, not a preselected summary. Pick any section and page through all records. Every returned row has a source evidence ID. The manifest reports the exact total record count and offsets; no bank data may be changed.',
 parameters:{type:'object',additionalProperties:false,required:['section','offset','limit'],properties:{
 section:{type:'string',enum:['history','future','balances','cards','indices','evidence']},
 offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200}
 }}}};
function createDataset(context){
 if(!context?.source?.projection||!Array.isArray(context.source.history)||
  !Array.isArray(context.facts)||!(context.privateIds instanceof Map))
  throw Error('Missing canonical financial data');
 const alias=id=>context.privateIds.get(String(id))||'unknown-account';
 const sections={history:[],future:[],balances:[],cards:[],indices:[],evidence:[]};
 const facts=[];
 // Every model-visible row gets a stable, opaque evidence ID. Actual IDs and
 // account references never leave the existing private backend.
 const add=(section,fields,description)=>{
  const id='dataset-'+section+'-'+(sections[section].length+1);
  sections[section].push({id,...fields});
  facts.push({id,kind:'dataset-'+section,text:description.slice(0,460)});
 };
 for(const row of [...context.source.history].filter(x=>x&&date(x.date)&&finite(x.amount))
  .sort((a,b)=>b.date.localeCompare(a.date))){
  const accountId=alias(row.accountId),amount=money(row.amount),
   merchant=safe(row.merchant||row.description||row.name),
   original=safe(row.name||row.description||row.originalName||row.source?.bankName||''),
   description=original&&original.toLowerCase()!==merchant.toLowerCase()?original:null,
   category=safe(row.category||'Unassigned'),type=safe(row.type||'unclassified');
  const fields={accountId,date:row.date,amount,merchant,description,category,type,pending:!!row.pending};
  add('history',fields,
   accountId+' '+row.date+' '+type+' 
 for(const row of [...(context.source.projection.events||[])]
  .filter(x=>x&&date(x.date)&&finite(x.amount)).sort((a,b)=>a.date.localeCompare(b.date))){
  const accountId=alias(row.accountId),amount=money(row.amount),
   merchant=safe(row.merchant),kind=safe(row.kind||'event'),
   transfer=!!row.transferGroupId,recurring=!!(row.recurringRuleId||row.seriesKey||row.cadence);
  add('future',{accountId,date:row.date,amount,merchant,kind,transfer,recurring},
   accountId+' '+row.date+' projected '+kind+' $'+amount.toFixed(2)+' '+merchant+
   (recurring?'; scheduled recurrence':'')+(transfer?'; linked transfer leg':''));
 }
 for(const account of context.source.projection.accounts||[]){
  const accountId=alias(account.id);
  for(const row of account.series||[]){
   if(!row||!date(row.date)||!finite(row.balance))continue;
   const balance=money(row.balance),income=finite(row.income)?money(row.income):0,
    outflow=finite(row.outflow)?money(row.outflow):0;
   add('balances',{accountId,date:row.date,balance,income,outflow},
    accountId+' '+row.date+' projected balance $'+balance.toFixed(2)+
    '; scheduled inflows $'+income.toFixed(2)+'; outflows $'+outflow.toFixed(2));
  }
 }
 for(const row of context.source.payments?.statements||[]){
  const card=alias(row.cardId),funding=alias(row.fromAccountId),
   dueDate=date(row.dueDate)?row.dueDate:null,
   periodStart=date(row.periodStart)?row.periodStart:null,
   periodEnd=date(row.periodEnd)?row.periodEnd:null,
   withdrawalDate=date(row.withdrawalDate)?row.withdrawalDate:null,
   amount=finite(row.amount)?money(row.amount):null,
   statementBalance=finite(row.statementBalance)?money(row.statementBalance):null;
  add('cards',{card,funding,dueDate,periodStart,periodEnd,withdrawalDate,amount,
   statementBalance,autopay:!!row.autopayEnabled,alreadyPaid:!!row.alreadyPaid,
   estimated:!!row.estimated,pendingReserved:!!row.pendingReserved},
  card+' statement period '+(periodStart||'unknown')+' to '+(periodEnd||'unknown')+
   ', due '+(dueDate||'unknown')+'; withdrawal '+(withdrawalDate||'unknown')+
   ', amount '+(amount===null?'unknown':'$'+amount.toFixed(2))+
   ', statement '+(statementBalance===null?'unknown':'$'+statementBalance.toFixed(2))+
   ', funding '+funding+'; autopay '+!!row.autopayEnabled+
   ', paid '+!!row.alreadyPaid+', estimated '+!!row.estimated);
 }
 // Build a neutral navigation index over ALL accessible records. The AI
 // chooses what is interesting; these are standard data pivots, not diagnoses
 // or suggested findings. Counts and totals stay tied to source evidence.
 const grouped=new Map();
 const group=(family,period,accountId,type,label,value)=>{
  const key=JSON.stringify([family,period,accountId,type,label]);
  const row=grouped.get(key)||{family,period,accountId,type,label,count:0,total:0};
  row.count++;row.total+=Math.abs(value);grouped.set(key,row);
 };
 for(const row of sections.history){
  const month=row.date.slice(0,7),kind=row.type;
  group('monthly-flow',month,row.accountId,kind,'All records',row.amount);
  group('merchant',null,null,kind,row.merchant,row.amount);
  group('category',null,null,kind,row.category,row.amount);
  group('merchant-month',month,null,kind,row.merchant,row.amount);
  group('category-month',month,null,kind,row.category,row.amount);
 }
 for(const row of sections.future){
  group('scheduled-month',row.date.slice(0,7),row.accountId,row.kind,
   'Canonical projected event legs',row.amount);
 }
 for(const row of sections.cards){
  if(finite(row.amount)&&row.dueDate)
   group('card-obligations-month',row.dueDate.slice(0,7),row.funding,
    row.estimated?'estimated':'recorded','Card statements',row.amount);
 }
 // Order within each dimension by absolute magnitude and interleave families
 // so no particular analysis topic dominates the initial evidence.
 const byFamily=new Map();
 for(const row of grouped.values()){
  row.total=money(row.total);
  if(!byFamily.has(row.family))byFamily.set(row.family,[]);
  byFamily.get(row.family).push(row);
 }
 for(const family of byFamily.keys())
  byFamily.get(family).sort((a,b)=>b.total-a.total||
   String(b.period||'').localeCompare(String(a.period||'')));
 const families=[...byFamily.keys()],positions=new Map(families.map(k=>[k,0]));
 let remaining=true;
 while(remaining){
  remaining=false;
  for(const family of families){
   const offset=positions.get(family),row=byFamily.get(family)[offset];
   if(!row)continue;
   remaining=true;positions.set(family,offset+1);
   const text='Source index '+row.family+'; period '+(row.period||'all available')+
    '; '+row.accountId+'; transaction kind '+row.type+'; '+
    row.label+'; '+row.count+' normalized records; gross absolute amount $'+
    row.total.toFixed(2)+'. Not net household spending or adjusted for transfers.';
   add('indices',row,text);
  }
 }
 for(const f of context.facts){
  if(f?.id&&typeof f.text==='string')
   sections.evidence.push({id:f.id,kind:safe(f.kind),text:f.text.slice(0,340)});
 }
 const counts=Object.fromEntries(Object.entries(sections).map(([k,v])=>[k,v.length]));
 function page(section,offset=0,limit=100){
  if(!Object.hasOwn(sections,section)||!Number.isInteger(offset)||offset<0||
   !Number.isInteger(limit)||limit<1||limit>200)
   return {error:'Invalid dataset page request'};
  const rows=sections[section].slice(offset,offset+limit);
  return {section,offset,returned:rows.length,total:sections[section].length,
   hasMore:offset+rows.length<sections[section].length,
   nextOffset:offset+rows.length,rows};
 }
 function initial(maxChars=160000){
  // Give the model a genuine broad cross-section of *records* rather than
  // preselecting findings. Remaining records are all available through pages.
  const orders=['indices','history','future','balances','cards','evidence'];
  const cursors=Object.fromEntries(orders.map(k=>[k,0]));
  const records=Object.fromEntries(orders.map(k=>[k,[]]));
  let remaining=Math.max(3000,maxChars);
  let more=true;
  while(more&&remaining>1200){
   more=false;
   for(const section of orders){
    const index=cursors[section],row=sections[section][index];
    if(!row)continue;
    const size=JSON.stringify(row).length+20;
    if(size>remaining)continue;
    records[section].push(row);cursors[section]++;remaining-=size;
    more=true;
   }
  }
  return {source:'Private Ledger sanitized financial data',
   asOf:context.asOf,accounts:context.accounts,primary:context.primary,
   coverage:context.scope,manifest:{counts,columns:{
    history:['accountId','date','amount','merchant','description','category','type','pending'],
    future:['accountId','date','amount','merchant','kind','transfer','recurring'],
    balances:['accountId','date','balance','income','outflow'],
    cards:['card','funding','dueDate','periodStart','periodEnd','withdrawalDate','amount',
     'statementBalance','autopay','alreadyPaid','estimated','pendingReserved'],
    indices:['family','period','accountId','type','label','count','total'],
    evidence:['kind','text']
   },initialIncluded:cursors,
   note:'Initial records are the beginning of each independently ordered section. Page all remaining records with read_financial_dataset. Historical rows newest first; future events and balances earliest first. The index is an unbiased set of simple pivots over every eligible record, with gross absolute totals that must not be treated as net spending. These are normalized provider records, not raw bank credentials or original IDs.'},
   records};
 }
 return {manifest:counts,page,initial:initial(),facts};
}
module.exports={READ_TOOL,createDataset};
+amount.toFixed(2)+' '+merchant+
   (description?'; original bank description '+description:'')+
   '; category '+category+(row.pending?'; pending':''));
 }
 for(const row of [...(context.source.projection.events||[])]
  .filter(x=>x&&date(x.date)&&finite(x.amount)).sort((a,b)=>a.date.localeCompare(b.date))){
  const accountId=alias(row.accountId),amount=money(row.amount),
   merchant=safe(row.merchant),kind=safe(row.kind||'event'),
   transfer=!!row.transferGroupId,recurring=!!(row.recurringRuleId||row.seriesKey||row.cadence);
  add('future',{accountId,date:row.date,amount,merchant,kind,transfer,recurring},
   accountId+' '+row.date+' projected '+kind+' $'+amount.toFixed(2)+' '+merchant+
   (recurring?'; scheduled recurrence':'')+(transfer?'; linked transfer leg':''));
 }
 for(const account of context.source.projection.accounts||[]){
  const accountId=alias(account.id);
  for(const row of account.series||[]){
   if(!row||!date(row.date)||!finite(row.balance))continue;
   const balance=money(row.balance),income=finite(row.income)?money(row.income):0,
    outflow=finite(row.outflow)?money(row.outflow):0;
   add('balances',{accountId,date:row.date,balance,income,outflow},
    accountId+' '+row.date+' projected balance $'+balance.toFixed(2)+
    '; scheduled inflows $'+income.toFixed(2)+'; outflows $'+outflow.toFixed(2));
  }
 }
 for(const row of context.source.payments?.statements||[]){
  const card=alias(row.cardId),funding=alias(row.fromAccountId),
   dueDate=date(row.dueDate)?row.dueDate:null,
   periodStart=date(row.periodStart)?row.periodStart:null,
   periodEnd=date(row.periodEnd)?row.periodEnd:null,
   withdrawalDate=date(row.withdrawalDate)?row.withdrawalDate:null,
   amount=finite(row.amount)?money(row.amount):null,
   statementBalance=finite(row.statementBalance)?money(row.statementBalance):null;
  add('cards',{card,funding,dueDate,periodStart,periodEnd,withdrawalDate,amount,
   statementBalance,autopay:!!row.autopayEnabled,alreadyPaid:!!row.alreadyPaid,
   estimated:!!row.estimated,pendingReserved:!!row.pendingReserved},
  card+' statement period '+(periodStart||'unknown')+' to '+(periodEnd||'unknown')+
   ', due '+(dueDate||'unknown')+'; withdrawal '+(withdrawalDate||'unknown')+
   ', amount '+(amount===null?'unknown':'$'+amount.toFixed(2))+
   ', statement '+(statementBalance===null?'unknown':'$'+statementBalance.toFixed(2))+
   ', funding '+funding+'; autopay '+!!row.autopayEnabled+
   ', paid '+!!row.alreadyPaid+', estimated '+!!row.estimated);
 }
 // Build a neutral navigation index over ALL accessible records. The AI
 // chooses what is interesting; these are standard data pivots, not diagnoses
 // or suggested findings. Counts and totals stay tied to source evidence.
 const grouped=new Map();
 const group=(family,period,accountId,type,label,value)=>{
  const key=JSON.stringify([family,period,accountId,type,label]);
  const row=grouped.get(key)||{family,period,accountId,type,label,count:0,total:0};
  row.count++;row.total+=Math.abs(value);grouped.set(key,row);
 };
 for(const row of sections.history){
  const month=row.date.slice(0,7),kind=row.type;
  group('monthly-flow',month,row.accountId,kind,'All records',row.amount);
  group('merchant',null,null,kind,row.merchant,row.amount);
  group('category',null,null,kind,row.category,row.amount);
  group('merchant-month',month,null,kind,row.merchant,row.amount);
  group('category-month',month,null,kind,row.category,row.amount);
 }
 for(const row of sections.future){
  group('scheduled-month',row.date.slice(0,7),row.accountId,row.kind,
   'Canonical projected event legs',row.amount);
 }
 for(const row of sections.cards){
  if(finite(row.amount)&&row.dueDate)
   group('card-obligations-month',row.dueDate.slice(0,7),row.funding,
    row.estimated?'estimated':'recorded','Card statements',row.amount);
 }
 // Order within each dimension by absolute magnitude and interleave families
 // so no particular analysis topic dominates the initial evidence.
 const byFamily=new Map();
 for(const row of grouped.values()){
  row.total=money(row.total);
  if(!byFamily.has(row.family))byFamily.set(row.family,[]);
  byFamily.get(row.family).push(row);
 }
 for(const family of byFamily.keys())
  byFamily.get(family).sort((a,b)=>b.total-a.total||
   String(b.period||'').localeCompare(String(a.period||'')));
 const families=[...byFamily.keys()],positions=new Map(families.map(k=>[k,0]));
 let remaining=true;
 while(remaining){
  remaining=false;
  for(const family of families){
   const offset=positions.get(family),row=byFamily.get(family)[offset];
   if(!row)continue;
   remaining=true;positions.set(family,offset+1);
   const text='Source index '+row.family+'; period '+(row.period||'all available')+
    '; '+row.accountId+'; transaction kind '+row.type+'; '+
    row.label+'; '+row.count+' normalized records; gross absolute amount $'+
    row.total.toFixed(2)+'. Not net household spending or adjusted for transfers.';
   add('indices',row,text);
  }
 }
 for(const f of context.facts){
  if(f?.id&&typeof f.text==='string')
   sections.evidence.push({id:f.id,kind:safe(f.kind),text:f.text.slice(0,340)});
 }
 const counts=Object.fromEntries(Object.entries(sections).map(([k,v])=>[k,v.length]));
 function page(section,offset=0,limit=100){
  if(!Object.hasOwn(sections,section)||!Number.isInteger(offset)||offset<0||
   !Number.isInteger(limit)||limit<1||limit>200)
   return {error:'Invalid dataset page request'};
  const rows=sections[section].slice(offset,offset+limit);
  return {section,offset,returned:rows.length,total:sections[section].length,
   hasMore:offset+rows.length<sections[section].length,
   nextOffset:offset+rows.length,rows};
 }
 function initial(maxChars=160000){
  // Give the model a genuine broad cross-section of *records* rather than
  // preselecting findings. Remaining records are all available through pages.
  const orders=['indices','history','future','balances','cards','evidence'];
  const cursors=Object.fromEntries(orders.map(k=>[k,0]));
  const records=Object.fromEntries(orders.map(k=>[k,[]]));
  let remaining=Math.max(3000,maxChars);
  let more=true;
  while(more&&remaining>1200){
   more=false;
   for(const section of orders){
    const index=cursors[section],row=sections[section][index];
    if(!row)continue;
    const size=JSON.stringify(row).length+20;
    if(size>remaining)continue;
    records[section].push(row);cursors[section]++;remaining-=size;
    more=true;
   }
  }
  return {source:'Private Ledger sanitized financial data',
   asOf:context.asOf,accounts:context.accounts,primary:context.primary,
   coverage:context.scope,manifest:{counts,columns:{
    history:['accountId','date','amount','merchant','category','type','pending'],
    future:['accountId','date','amount','merchant','kind','transfer','recurring'],
    balances:['accountId','date','balance','income','outflow'],
    cards:['card','funding','dueDate','periodStart','periodEnd','withdrawalDate','amount',
     'statementBalance','autopay','alreadyPaid','estimated','pendingReserved'],
    indices:['family','period','accountId','type','label','count','total'],
    evidence:['kind','text']
   },initialIncluded:cursors,
   note:'Initial records are the beginning of each independently ordered section. Page all remaining records with read_financial_dataset. Historical rows newest first; future events and balances earliest first. The index is an unbiased set of simple pivots over every eligible record, with gross absolute totals that must not be treated as net spending. These are normalized provider records, not raw bank credentials or original IDs.'},
   records};
 }
 return {manifest:counts,page,initial:initial(),facts};
}
module.exports={READ_TOOL,createDataset};
+amount.toFixed(2)+' '+merchant+
   (description?'; original bank description '+description:'')+
   '; category '+category+(row.pending?'; pending':''));
 }
 for(const row of [...(context.source.projection.events||[])]
  .filter(x=>x&&date(x.date)&&finite(x.amount)).sort((a,b)=>a.date.localeCompare(b.date))){
  const accountId=alias(row.accountId),amount=money(row.amount),
   merchant=safe(row.merchant),kind=safe(row.kind||'event'),
   transfer=!!row.transferGroupId,recurring=!!(row.recurringRuleId||row.seriesKey||row.cadence);
  add('future',{accountId,date:row.date,amount,merchant,kind,transfer,recurring},
   accountId+' '+row.date+' projected '+kind+' $'+amount.toFixed(2)+' '+merchant+
   (recurring?'; scheduled recurrence':'')+(transfer?'; linked transfer leg':''));
 }
 for(const account of context.source.projection.accounts||[]){
  const accountId=alias(account.id);
  for(const row of account.series||[]){
   if(!row||!date(row.date)||!finite(row.balance))continue;
   const balance=money(row.balance),income=finite(row.income)?money(row.income):0,
    outflow=finite(row.outflow)?money(row.outflow):0;
   add('balances',{accountId,date:row.date,balance,income,outflow},
    accountId+' '+row.date+' projected balance $'+balance.toFixed(2)+
    '; scheduled inflows $'+income.toFixed(2)+'; outflows $'+outflow.toFixed(2));
  }
 }
 for(const row of context.source.payments?.statements||[]){
  const card=alias(row.cardId),funding=alias(row.fromAccountId),
   dueDate=date(row.dueDate)?row.dueDate:null,
   periodStart=date(row.periodStart)?row.periodStart:null,
   periodEnd=date(row.periodEnd)?row.periodEnd:null,
   withdrawalDate=date(row.withdrawalDate)?row.withdrawalDate:null,
   amount=finite(row.amount)?money(row.amount):null,
   statementBalance=finite(row.statementBalance)?money(row.statementBalance):null;
  add('cards',{card,funding,dueDate,periodStart,periodEnd,withdrawalDate,amount,
   statementBalance,autopay:!!row.autopayEnabled,alreadyPaid:!!row.alreadyPaid,
   estimated:!!row.estimated,pendingReserved:!!row.pendingReserved},
  card+' statement period '+(periodStart||'unknown')+' to '+(periodEnd||'unknown')+
   ', due '+(dueDate||'unknown')+'; withdrawal '+(withdrawalDate||'unknown')+
   ', amount '+(amount===null?'unknown':'$'+amount.toFixed(2))+
   ', statement '+(statementBalance===null?'unknown':'$'+statementBalance.toFixed(2))+
   ', funding '+funding+'; autopay '+!!row.autopayEnabled+
   ', paid '+!!row.alreadyPaid+', estimated '+!!row.estimated);
 }
 // Build a neutral navigation index over ALL accessible records. The AI
 // chooses what is interesting; these are standard data pivots, not diagnoses
 // or suggested findings. Counts and totals stay tied to source evidence.
 const grouped=new Map();
 const group=(family,period,accountId,type,label,value)=>{
  const key=JSON.stringify([family,period,accountId,type,label]);
  const row=grouped.get(key)||{family,period,accountId,type,label,count:0,total:0};
  row.count++;row.total+=Math.abs(value);grouped.set(key,row);
 };
 for(const row of sections.history){
  const month=row.date.slice(0,7),kind=row.type;
  group('monthly-flow',month,row.accountId,kind,'All records',row.amount);
  group('merchant',null,null,kind,row.merchant,row.amount);
  group('category',null,null,kind,row.category,row.amount);
  group('merchant-month',month,null,kind,row.merchant,row.amount);
  group('category-month',month,null,kind,row.category,row.amount);
 }
 for(const row of sections.future){
  group('scheduled-month',row.date.slice(0,7),row.accountId,row.kind,
   'Canonical projected event legs',row.amount);
 }
 for(const row of sections.cards){
  if(finite(row.amount)&&row.dueDate)
   group('card-obligations-month',row.dueDate.slice(0,7),row.funding,
    row.estimated?'estimated':'recorded','Card statements',row.amount);
 }
 // Order within each dimension by absolute magnitude and interleave families
 // so no particular analysis topic dominates the initial evidence.
 const byFamily=new Map();
 for(const row of grouped.values()){
  row.total=money(row.total);
  if(!byFamily.has(row.family))byFamily.set(row.family,[]);
  byFamily.get(row.family).push(row);
 }
 for(const family of byFamily.keys())
  byFamily.get(family).sort((a,b)=>b.total-a.total||
   String(b.period||'').localeCompare(String(a.period||'')));
 const families=[...byFamily.keys()],positions=new Map(families.map(k=>[k,0]));
 let remaining=true;
 while(remaining){
  remaining=false;
  for(const family of families){
   const offset=positions.get(family),row=byFamily.get(family)[offset];
   if(!row)continue;
   remaining=true;positions.set(family,offset+1);
   const text='Source index '+row.family+'; period '+(row.period||'all available')+
    '; '+row.accountId+'; transaction kind '+row.type+'; '+
    row.label+'; '+row.count+' normalized records; gross absolute amount $'+
    row.total.toFixed(2)+'. Not net household spending or adjusted for transfers.';
   add('indices',row,text);
  }
 }
 for(const f of context.facts){
  if(f?.id&&typeof f.text==='string')
   sections.evidence.push({id:f.id,kind:safe(f.kind),text:f.text.slice(0,340)});
 }
 const counts=Object.fromEntries(Object.entries(sections).map(([k,v])=>[k,v.length]));
 function page(section,offset=0,limit=100){
  if(!Object.hasOwn(sections,section)||!Number.isInteger(offset)||offset<0||
   !Number.isInteger(limit)||limit<1||limit>200)
   return {error:'Invalid dataset page request'};
  const rows=sections[section].slice(offset,offset+limit);
  return {section,offset,returned:rows.length,total:sections[section].length,
   hasMore:offset+rows.length<sections[section].length,
   nextOffset:offset+rows.length,rows};
 }
 function initial(maxChars=160000){
  // Give the model a genuine broad cross-section of *records* rather than
  // preselecting findings. Remaining records are all available through pages.
  const orders=['indices','history','future','balances','cards','evidence'];
  const cursors=Object.fromEntries(orders.map(k=>[k,0]));
  const records=Object.fromEntries(orders.map(k=>[k,[]]));
  let remaining=Math.max(3000,maxChars);
  let more=true;
  while(more&&remaining>1200){
   more=false;
   for(const section of orders){
    const index=cursors[section],row=sections[section][index];
    if(!row)continue;
    const size=JSON.stringify(row).length+20;
    if(size>remaining)continue;
    records[section].push(row);cursors[section]++;remaining-=size;
    more=true;
   }
  }
  return {source:'Private Ledger sanitized financial data',
   asOf:context.asOf,accounts:context.accounts,primary:context.primary,
   coverage:context.scope,manifest:{counts,columns:{
    history:['accountId','date','amount','merchant','description','category','type','pending'],
    future:['accountId','date','amount','merchant','kind','transfer','recurring'],
    balances:['accountId','date','balance','income','outflow'],
    cards:['card','funding','dueDate','periodStart','periodEnd','withdrawalDate','amount',
     'statementBalance','autopay','alreadyPaid','estimated','pendingReserved'],
    indices:['family','period','accountId','type','label','count','total'],
    evidence:['kind','text']
   },initialIncluded:cursors,
   note:'Initial records are the beginning of each independently ordered section. Page all remaining records with read_financial_dataset. Historical rows newest first; future events and balances earliest first. The index is an unbiased set of simple pivots over every eligible record, with gross absolute totals that must not be treated as net spending. These are normalized provider records, not raw bank credentials or original IDs.'},
   records};
 }
 return {manifest:counts,page,initial:initial(),facts};
}
module.exports={READ_TOOL,createDataset};
+amount.toFixed(2)+' '+merchant+
   (description?'; original bank description '+description:'')+
   '; category '+category+(row.pending?'; pending':''));
 }
 for(const row of [...(context.source.projection.events||[])]
  .filter(x=>x&&date(x.date)&&finite(x.amount)).sort((a,b)=>a.date.localeCompare(b.date))){
  const accountId=alias(row.accountId),amount=money(row.amount),
   merchant=safe(row.merchant),kind=safe(row.kind||'event'),
   transfer=!!row.transferGroupId,recurring=!!(row.recurringRuleId||row.seriesKey||row.cadence);
  add('future',{accountId,date:row.date,amount,merchant,kind,transfer,recurring},
   accountId+' '+row.date+' projected '+kind+' $'+amount.toFixed(2)+' '+merchant+
   (recurring?'; scheduled recurrence':'')+(transfer?'; linked transfer leg':''));
 }
 for(const account of context.source.projection.accounts||[]){
  const accountId=alias(account.id);
  for(const row of account.series||[]){
   if(!row||!date(row.date)||!finite(row.balance))continue;
   const balance=money(row.balance),income=finite(row.income)?money(row.income):0,
    outflow=finite(row.outflow)?money(row.outflow):0;
   add('balances',{accountId,date:row.date,balance,income,outflow},
    accountId+' '+row.date+' projected balance $'+balance.toFixed(2)+
    '; scheduled inflows $'+income.toFixed(2)+'; outflows $'+outflow.toFixed(2));
  }
 }
 for(const row of context.source.payments?.statements||[]){
  const card=alias(row.cardId),funding=alias(row.fromAccountId),
   dueDate=date(row.dueDate)?row.dueDate:null,
   periodStart=date(row.periodStart)?row.periodStart:null,
   periodEnd=date(row.periodEnd)?row.periodEnd:null,
   withdrawalDate=date(row.withdrawalDate)?row.withdrawalDate:null,
   amount=finite(row.amount)?money(row.amount):null,
   statementBalance=finite(row.statementBalance)?money(row.statementBalance):null;
  add('cards',{card,funding,dueDate,periodStart,periodEnd,withdrawalDate,amount,
   statementBalance,autopay:!!row.autopayEnabled,alreadyPaid:!!row.alreadyPaid,
   estimated:!!row.estimated,pendingReserved:!!row.pendingReserved},
  card+' statement period '+(periodStart||'unknown')+' to '+(periodEnd||'unknown')+
   ', due '+(dueDate||'unknown')+'; withdrawal '+(withdrawalDate||'unknown')+
   ', amount '+(amount===null?'unknown':'$'+amount.toFixed(2))+
   ', statement '+(statementBalance===null?'unknown':'$'+statementBalance.toFixed(2))+
   ', funding '+funding+'; autopay '+!!row.autopayEnabled+
   ', paid '+!!row.alreadyPaid+', estimated '+!!row.estimated);
 }
 // Build a neutral navigation index over ALL accessible records. The AI
 // chooses what is interesting; these are standard data pivots, not diagnoses
 // or suggested findings. Counts and totals stay tied to source evidence.
 const grouped=new Map();
 const group=(family,period,accountId,type,label,value)=>{
  const key=JSON.stringify([family,period,accountId,type,label]);
  const row=grouped.get(key)||{family,period,accountId,type,label,count:0,total:0};
  row.count++;row.total+=Math.abs(value);grouped.set(key,row);
 };
 for(const row of sections.history){
  const month=row.date.slice(0,7),kind=row.type;
  group('monthly-flow',month,row.accountId,kind,'All records',row.amount);
  group('merchant',null,null,kind,row.merchant,row.amount);
  group('category',null,null,kind,row.category,row.amount);
  group('merchant-month',month,null,kind,row.merchant,row.amount);
  group('category-month',month,null,kind,row.category,row.amount);
 }
 for(const row of sections.future){
  group('scheduled-month',row.date.slice(0,7),row.accountId,row.kind,
   'Canonical projected event legs',row.amount);
 }
 for(const row of sections.cards){
  if(finite(row.amount)&&row.dueDate)
   group('card-obligations-month',row.dueDate.slice(0,7),row.funding,
    row.estimated?'estimated':'recorded','Card statements',row.amount);
 }
 // Order within each dimension by absolute magnitude and interleave families
 // so no particular analysis topic dominates the initial evidence.
 const byFamily=new Map();
 for(const row of grouped.values()){
  row.total=money(row.total);
  if(!byFamily.has(row.family))byFamily.set(row.family,[]);
  byFamily.get(row.family).push(row);
 }
 for(const family of byFamily.keys())
  byFamily.get(family).sort((a,b)=>b.total-a.total||
   String(b.period||'').localeCompare(String(a.period||'')));
 const families=[...byFamily.keys()],positions=new Map(families.map(k=>[k,0]));
 let remaining=true;
 while(remaining){
  remaining=false;
  for(const family of families){
   const offset=positions.get(family),row=byFamily.get(family)[offset];
   if(!row)continue;
   remaining=true;positions.set(family,offset+1);
   const text='Source index '+row.family+'; period '+(row.period||'all available')+
    '; '+row.accountId+'; transaction kind '+row.type+'; '+
    row.label+'; '+row.count+' normalized records; gross absolute amount $'+
    row.total.toFixed(2)+'. Not net household spending or adjusted for transfers.';
   add('indices',row,text);
  }
 }
 for(const f of context.facts){
  if(f?.id&&typeof f.text==='string')
   sections.evidence.push({id:f.id,kind:safe(f.kind),text:f.text.slice(0,340)});
 }
 const counts=Object.fromEntries(Object.entries(sections).map(([k,v])=>[k,v.length]));
 function page(section,offset=0,limit=100){
  if(!Object.hasOwn(sections,section)||!Number.isInteger(offset)||offset<0||
   !Number.isInteger(limit)||limit<1||limit>200)
   return {error:'Invalid dataset page request'};
  const rows=sections[section].slice(offset,offset+limit);
  return {section,offset,returned:rows.length,total:sections[section].length,
   hasMore:offset+rows.length<sections[section].length,
   nextOffset:offset+rows.length,rows};
 }
 function initial(maxChars=160000){
  // Give the model a genuine broad cross-section of *records* rather than
  // preselecting findings. Remaining records are all available through pages.
  const orders=['indices','history','future','balances','cards','evidence'];
  const cursors=Object.fromEntries(orders.map(k=>[k,0]));
  const records=Object.fromEntries(orders.map(k=>[k,[]]));
  let remaining=Math.max(3000,maxChars);
  let more=true;
  while(more&&remaining>1200){
   more=false;
   for(const section of orders){
    const index=cursors[section],row=sections[section][index];
    if(!row)continue;
    const size=JSON.stringify(row).length+20;
    if(size>remaining)continue;
    records[section].push(row);cursors[section]++;remaining-=size;
    more=true;
   }
  }
  return {source:'Private Ledger sanitized financial data',
   asOf:context.asOf,accounts:context.accounts,primary:context.primary,
   coverage:context.scope,manifest:{counts,columns:{
    history:['accountId','date','amount','merchant','category','type','pending'],
    future:['accountId','date','amount','merchant','kind','transfer','recurring'],
    balances:['accountId','date','balance','income','outflow'],
    cards:['card','funding','dueDate','periodStart','periodEnd','withdrawalDate','amount',
     'statementBalance','autopay','alreadyPaid','estimated','pendingReserved'],
    indices:['family','period','accountId','type','label','count','total'],
    evidence:['kind','text']
   },initialIncluded:cursors,
   note:'Initial records are the beginning of each independently ordered section. Page all remaining records with read_financial_dataset. Historical rows newest first; future events and balances earliest first. The index is an unbiased set of simple pivots over every eligible record, with gross absolute totals that must not be treated as net spending. These are normalized provider records, not raw bank credentials or original IDs.'},
   records};
 }
 return {manifest:counts,page,initial:initial(),facts};
}
module.exports={READ_TOOL,createDataset};
