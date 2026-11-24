/* Runs only after a user gesture on an open amazon.com Your Orders page.
 * Read-only: requests a maximum of four additional same-origin history pages.
 * Never reads cookies, credentials, payments pages, or unrelated Amazon pages.
 */
(function(root){
 'use strict';
 const ORDER_ID=/\b\d{3}-\d{7}-\d{7}\b/;
 const MAX_PAGES=5,MAX_ROWS=80;
 const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
 const textOf=e=>clean(e?.innerText||e?.textContent||'');
 function parseMoney(s){
  const x=clean(s).replace(/,/g,'').match(/^\$?\s*(\d+)\.(\d{2})$/);
  if(!x)return null;
  const cents=Number(x[1])*100+Number(x[2]);
  return Number.isSafeInteger(cents)&&cents>0&&cents<=20000000?cents:null;
 }
 function parseDate(s){
  const v=clean(s).replace(/(\d+)(st|nd|rd|th)\b/gi,'$1');
  const iso=v.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  let date;
  if(iso)date=iso[1]+'-'+iso[2]+'-'+iso[3];
  else{
   const m=v.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2}),?\s+(\d{4})/i);
   if(!m)return '';
   const names=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
   const month=names.indexOf(m[1].slice(0,3).toLowerCase())+1;
   date=m[3]+'-'+String(month).padStart(2,'0')+'-'+m[2].padStart(2,'0');
  }
  const d=new Date(date+'T12:00:00Z');
  return Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==date?'':date;
 }
 const generic=/^(?:view (?:your )?order|order details|track package|buy it again|return items?|write a product review|view item|view details|delivery|delivered|cancel items?|get help|archive order|invoice|leave seller feedback|problem with order|view or edit order|visit the .*store)$/i;
 const productSelector=[
  'a.yohtmlc-product-title','a[href*="/dp/"]','a[href*="/gp/product/"]',
  'a[href*="/gp/aw/d/"]','.product-title','[data-test-id="product-title"]'
 ].join(',');
 function titles(card){
  const values=[],seen=new Set();
  for(const e of card.querySelectorAll(productSelector)){
   const t=textOf(e);
   if(t.length<4||t.length>240||generic.test(t)||ORDER_ID.test(t)||seen.has(t.toLowerCase()))continue;
   seen.add(t.toLowerCase());values.push(t);
  }
  return values;
 }
 function parseCard(card){
  const text=textOf(card);
  const ids=[...new Set(text.match(/\b\d{3}-\d{7}-\d{7}\b/g)||[])];
  if(ids.length!==1||text.length>35000)return {reason:'invalid-order'};
  if(/\b(?:cancelled|canceled)\b/i.test(text)&&!/\b(?:delivered|shipped)\b/i.test(text))return {reason:'canceled'};
  const orderId=ids[0],products=titles(card);
  // Never silently treat a multi-item order as a one-item order.
  const count=text.match(/\b(\d{1,3})\s+items?\b/i);
  if(products.length!==1||(count&&Number(count[1])>1)||/\b(?:more items?|other items?)\b/i.test(text))
   return {reason:'multi-item-or-unreadable'};
  const placed=text.match(/\border\s*placed\s*:?\s*(?:on\s*)?((?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+)?\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
  const date=placed?parseDate(placed[1]):'';
  // Require an explicitly labeled ORDER TOTAL, not some unrelated price.
  const total=text.match(/\border\s*total\s*:?\s*(\$\s*[\d,]+\.\d{2})/i)||
   text.match(/\btotal\s*:?\s*(\$\s*[\d,]+\.\d{2})/i);
  const cents=total?parseMoney(total[1]):null;
  if(!date||!cents)return {reason:'date-or-charge-unknown'};
  return {row:{orderId,date,title:products[0],cents}};
 }
 function cards(doc){
  const selectors='.order-card,.js-order-card,[data-order-id],.a-box-group,.order-card__list,[class*="order-card"]';
  const all=Array.from(doc.querySelectorAll(selectors));
  // Prefer the smallest block that contains exactly one order ID.
  return all.filter(e=>{
   const ids=[...new Set(textOf(e).match(/\b\d{3}-\d{7}-\d{7}\b/g)||[])];
   return ids.length===1;
  }).sort((a,b)=>textOf(a).length-textOf(b).length);
 }
 function scanDocument(doc,seen){
  const rows=[],skipped=[];
  const candidates=cards(doc),found=new Set();
  for(const card of candidates){
   const id=textOf(card).match(ORDER_ID)?.[0];
   if(!id||found.has(id)||seen.has(id))continue;
   found.add(id);seen.add(id);
   const result=parseCard(card);
   if(result.row)rows.push(result.row);else skipped.push({id,reason:result.reason});
  }
  return {rows,skipped,seenCount:found.size};
 }
 function nextUrl(doc,base){
  const candidates=Array.from(doc.querySelectorAll('li.a-last a, a[aria-label*="Next"], a[aria-label*="next"], a[href*="startIndex="]'));
  for(const a of candidates){
   try{
    const url=new URL(a.getAttribute('href'),base);
    if(url.origin===new URL(base).origin&&/\/(?:your-orders|gp\/your-account\/order-history)/i.test(url.pathname))
     return url.href;
   }catch(_){}
  }
  return null;
 }
 const csvCell=s=>'"'+String(s??'').replace(/"/g,'""').replace(/[\r\n]+/g,' ')+'"';
 function toCSV(rows){
  return ['Order ID,Order Date,Product Name,Item Total,Total Charged',...rows.map(r=>
   [r.orderId,r.date,r.title,(r.cents/100).toFixed(2),(r.cents/100).toFixed(2)].map(csvCell).join(',')
  )].join('\r\n');
 }
 async function scan(){
  if(!/^https:\/\/(?:[a-z0-9-]+\.)?amazon\.com$/i.test(location.origin)||
      !/\/(?:your-orders|gp\/your-account\/order-history|gp\/your-account\/order-details)/i.test(location.pathname))
   throw Error('Open Amazon Your Orders before syncing.');
  const rows=[],seen=new Set(),visited=new Set(),skipped=[];
  let doc=document,url=location.href,pages=0,stoppedForLogin=false;
  while(doc&&pages<MAX_PAGES&&rows.length<MAX_ROWS&&!visited.has(url)){
   visited.add(url);pages++;
   const s=scanDocument(doc,seen);
   rows.push(...s.rows);skipped.push(...s.skipped);
   const next=nextUrl(doc,url);
   if(!next||visited.has(next)||pages>=MAX_PAGES)break;
   // Voluntary, limited, same-origin reads. Do not follow payments or account links.
   await new Promise(resolve=>setTimeout(resolve,300));
   const response=await fetch(next,{method:'GET',credentials:'same-origin',redirect:'follow',cache:'no-store'});
   if(!response.ok||new URL(response.url).origin!==location.origin||
      !/\/(?:your-orders|gp\/your-account\/order-history)/i.test(new URL(response.url).pathname)){
    stoppedForLogin=true;break;
   }
   const html=await response.text();
   if(html.length>4000000||/\b(?:enter the characters you see|validatecaptcha|sign in to your account)\b/i.test(html)){
    stoppedForLogin=true;break;
   }
   doc=new DOMParser().parseFromString(html,'text/html');url=next;
  }
  if(!rows.length)throw Error('No safe single-item purchases were readable. Amazon may have changed its page layout. Use the CSV/ZIP import, or view recent orders on amazon.com.');
  return {csv:toCSV(rows.slice(0,MAX_ROWS)),items:Math.min(rows.length,MAX_ROWS),pages,skipped:skipped.length,stoppedForLogin};
 }
 const api={parseMoney,parseDate,parseCard,scanDocument,toCSV,scan};
 root.LedgerAmazonScraper=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
