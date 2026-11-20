'use strict';
// Typed, source-calculated investigation tools. No arbitrary model code, URLs or writes.
const {cleanDescription}=require('./ai-private-adapter.cjs');
const dateOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
 Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;
const money=n=>Math.round((n+Number.EPSILON)*100)/100;
const safe=s=>cleanDescription(String(s||'Unknown')).slice(0,65);
const COMPUTE_TOOL={type:'function',function:{name:'compute_financial_view',
 description:'Independently calculate a source-verified aggregation, period comparison and optional interactive graphic from ALL relevant canonical records (not just sampled facts). Choose scope, measure, dimension and filters. Returns immutable Ledger-computed numbers and evidence IDs.',
 parameters:{type:'object',additionalProperties:false,
 required:['source','direction','startDate','endDate','accountId','groupBy','measure','filter','comparePrevious','visualize'],
 properties:{
 source:{type:'string',enum:['actual','expected']},
 direction:{type:'string',enum:['expense','income','all']},
 startDate:{type:'string'},endDate:{type:'string'},
 accountId:{type:['string','null']},groupBy:{type:'string',enum:['day','week','month','category','merchant','account','direction']},
 measure:{type:'string',enum:['sum','count','average','maximum','minimum']},
 filter:{type:'string'},comparePrevious:{type:'boolean'},visualize:{type:'boolean'}
 }}}};
const RESEARCH_TOOL={type:'function',function:{name:'research_public_context',
 description:'Look up PUBLIC economic/financial reference data ONLY when directly relevant to interpreting a finding. No private amounts, account details, user messages, or arbitrary prompts leave Ledger. Web queries are restricted to generic topics. External facts must be labeled as external, not treated as bank evidence.',
 parameters:{type:'object',additionalProperties:false,required:['topic'],
 properties:{topic:{type:'string',enum:['inflation','interest-rates','credit-card-interest','household-spending-benchmarks','bank-deposit-insurance','consumer-price-trends']}}}}};
const TOPICS={
 'inflation':'latest US inflation CPI releases and interpretation',
 'interest-rates':'current US federal funds interest rate and official Federal Reserve sources',
 'credit-card-interest':'current US average credit card interest rate official statistics',
 'household-spending-benchmarks':'latest US Bureau of Labor Statistics Consumer Expenditure Survey household expenditure benchmarks',
 'bank-deposit-insurance':'FDIC deposit insurance coverage official limits',
 'consumer-price-trends':'BLS CPI price trend for groceries energy and housing'
};
function computeFinancialView(context,r,index){
 if(!r||!['actual','expected'].includes(r.source)||
 !['expense','income','all'].includes(r.direction)||
 !['day','week','month','category','merchant','account','direction'].includes(r.groupBy)||
 !['sum','count','average','maximum','minimum'].includes(r.measure)||
 !dateOK(r.startDate)||!dateOK(r.endDate)||r.startDate>r.endDate||
 (Date.parse(r.endDate)-Date.parse(r.startDate))/86400000>1095||
 (r.accountId!==null&&!context.accounts.some(a=>a.id===r.accountId))||
 typeof r.filter!=='string'||r.filter.length>65||
 typeof r.comparePrevious!=='boolean'||typeof r.visualize!=='boolean')return {error:'Invalid calculation specification'};
 const range=r.source==='actual'?
  r.startDate>=context.scope.pastDataStart&&r.endDate<=context.scope.pastDataEnd:
  r.startDate>=context.asOf&&r.endDate<=
   new Date(Date.parse(context.asOf+'T12:00:00Z')+
   Number(context.scope.forecastHorizonDays||1095)*86400000).toISOString().slice(0,10);
 if(!range)return {error:'Calculation outside available source dates'};
 const rows=r.source==='actual'?context.source.history:context.source.projection.events||[];
 const alias=id=>context.privateIds.get(String(id))||'unknown';
 const filter=r.filter.toLowerCase();
 const normalized=[];
 const priorDays=Math.round((Date.parse(r.endDate)-Date.parse(r.startDate))/86400000)+1;
 const priorStart=new Date(Date.parse(r.startDate+'T12:00:00Z')-priorDays*86400000).toISOString().slice(0,10);
 const previousOK=r.source==='actual'?priorStart>=context.scope.pastDataStart:priorStart>=context.asOf;
 for(const row of rows){
  if(!row||!dateOK(row.date)||typeof row.amount!=='number'||!Number.isFinite(row.amount))continue;
  if(r.accountId!==null&&alias(row.accountId)!==r.accountId)continue;
  const direction=r.source==='actual'?String(row.type||'').toLowerCase():
   String(row.kind||'').toLowerCase();
  const category=direction==='income'||direction==='deposit'?'income':
   direction==='expense'||direction==='withdrawal'?'expense':'other';
  if(r.direction!=='all'&&category!==r.direction)continue;
  const merchant=safe(row.merchant||row.description);
  const groupCategory=safe(row.category||'Unassigned');
  if(filter&&!merchant.toLowerCase().includes(filter)&&!groupCategory.toLowerCase().includes(filter))continue;
  const period=row.date>=r.startDate&&row.date<=r.endDate?'current':
   r.comparePrevious&&previousOK&&row.date>=priorStart&&row.date<r.startDate?'previous':null;
  if(!period)continue;
  const week=new Date(row.date+'T12:00:00Z');
  const day=week.getUTCDay();week.setUTCDate(week.getUTCDate()-((day+6)%7));
  const key=r.groupBy==='day'?row.date:r.groupBy==='week'?week.toISOString().slice(0,10):
   r.groupBy==='month'?row.date.slice(0,7):r.groupBy==='category'?groupCategory:
   r.groupBy==='merchant'?merchant:r.groupBy==='account'?alias(row.accountId):category;
  normalized.push({key,period,value:Math.abs(row.amount)});
 }
 const aggregate=period=>{
  const m=new Map();
  for(const row of normalized){if(row.period!==period)continue;
   const group=m.get(row.key)||{count:0,sum:0,maximum:-Infinity,minimum:Infinity};
   group.count++;group.sum+=row.value;
   group.maximum=Math.max(group.maximum,row.value);group.minimum=Math.min(group.minimum,row.value);
   m.set(row.key,group);
  }
  return m;
 };
 const groups=aggregate('current'),prev=aggregate('previous');
 const value=g=>g?(r.measure==='sum'?money(g.sum):r.measure==='count'?g.count:
  r.measure==='average'?money(g.sum/g.count):r.measure==='maximum'?money(g.maximum):money(g.minimum)):0;
 const sorted=[...groups].map(([label,g])=>({label,value:value(g),count:g.count,
  ...(r.comparePrevious&&previousOK?{previous:value(prev.get(label)),
   change:money(value(g)-value(prev.get(label)))}:{})}));
 if(['day','week','month'].includes(r.groupBy))sorted.sort((a,b)=>a.label.localeCompare(b.label));
 else sorted.sort((a,b)=>b.value-a.value);
 const truncated=sorted.length>90,points=sorted.slice(0,90);
 const total=normalized.filter(x=>x.period==='current').reduce((acc,r)=>acc+r.value,0);
 const previousTotal=normalized.filter(x=>x.period==='previous').reduce((acc,r)=>acc+r.value,0);
 const text=r.source+' '+r.direction+' '+r.measure+' grouped by '+r.groupBy+' from '+
  r.startDate+' through '+r.endDate+'; matched '+normalized.filter(x=>x.period==='current').length+
  ' source records; gross amount '+('$'+money(total).toFixed(2))+
  (r.comparePrevious&&previousOK?'; preceding equal-length period '+priorStart+' through '+
   new Date(Date.parse(r.startDate+'T12:00:00Z')-86400000).toISOString().slice(0,10)+
   ' gross '+('$'+money(previousTotal).toFixed(2)):'')+
  (truncated?'; display truncated to 90 groups':'')+
  (r.source==='expected'?'; canonical future event legs may include internal transfers':'');
 const id='calc-'+index;
 const facts=[{id:id+'-total',kind:'calculation',text:text.slice(0,480)},...points.slice(0,35)
  .map((p,i)=>({id:id+'-'+(i+1),kind:'calculation',text:
  r.groupBy+' '+p.label+' '+r.measure+' '+(r.measure==='count'?p.value:'$'+p.value.toFixed(2))+
  ' from '+p.count+' '+r.source+' records, '+r.startDate+' to '+r.endDate+
  (p.previous===undefined?'':'; previous '+(r.measure==='count'?p.previous:'$'+p.previous.toFixed(2))+
   ', change '+(r.measure==='count'?p.change:'$'+p.change.toFixed(2)))}))];
 const chart=r.visualize&&points.length>=2?{
  id:'analysis-chart-'+index,kind:r.source+'-'+r.measure,type:['day','week','month'].includes(r.groupBy)?'line':'bar',
  title:safe(r.source+' '+r.direction+' '+r.measure+' by '+r.groupBy),
  subtitle:'All matching '+r.source+' Ledger records; '+r.startDate+' to '+r.endDate+
   (truncated?'; top 90 groups shown':''),
  unit:r.measure==='count'?'count':'USD',points:points.map(p=>({label:p.label,value:p.value}))
 }:null;
 return {facts,chart,summary:{matched:normalized.filter(x=>x.period==='current').length,groups:groups.size,
  measure:r.measure,source:r.source,previousCompared:r.comparePrevious&&previousOK,truncated},
  points:points.slice(0,40)};
}
async function researchPublic(topic,{apiKey,model='gpt-4.1',fetchImpl=fetch}){
 if(!Object.hasOwn(TOPICS,topic))return {error:'Unsupported public topic'};
 // The external lookup sees ONLY a predefined public topic, never household context.
 let response;
 try{response=await fetchImpl('https://api.openai.com/v1/responses',{
  method:'POST',signal:AbortSignal.timeout(90000),
  headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
  body:JSON.stringify({model,store:false,tools:[{type:'web_search'}],
   input:'Public facts only. Research '+TOPICS[topic]+
    '. Give a brief precise summary and source URLs. Do not ask for or infer private household data.'})
 })}catch{return {error:'Public research service unavailable'};}
 if(!response.ok)return {error:'Public research request unavailable'};
 let json;try{json=await response.json()}catch{return {error:'Public research response invalid'};}
 const parts=(json.output||[]).flatMap(x=>x.type==='message'?(x.content||[]):[]);
 const text=parts.map(x=>x.text||'').join(' ').slice(0,850);
 const urls=[...new Set(parts.flatMap(x=>(x.annotations||[]).map(a=>a.url)).filter(u=>{
  try{const v=new URL(u);return v.protocol==='https:'&&!v.username&&!v.password&&u.length<450;}catch{return false;}
 }))].slice(0,5);
 if(!text||!urls.length)return {error:'Public evidence could not be cited'};
 return {topic,text,sources:urls,notice:'External public research, not Ledger bank evidence'};
}
module.exports={COMPUTE_TOOL,RESEARCH_TOOL,computeFinancialView,researchPublic};
