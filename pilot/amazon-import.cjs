'use strict';
// Private Amazon order-history importer. Never creates, deletes or edits a bank transaction.
const zlib=require('node:zlib');
const MAX_FILE=6*1024*1024,MAX_TEXT=24*1024*1024,MAX_ROWS=90000;
const usdCents=value=>{
 if(value===null||value===undefined||String(value).trim()==='')return null;
 const s=String(value).trim().replace(/[$,\s]/g,'');
 if(!/^\(?-?\d+(?:\.\d{1,2})?\)?$/.test(s))return null;
 const negative=s.startsWith('-')||s.startsWith('('),m=s.match(/\d+(?:\.\d+)?/);
 const n=Math.round(Number(m[0])*100)*(negative?-1:1);
 return Number.isSafeInteger(n)?n:null;
};
function csvRows(text){
 const rows=[],row=[];let cell='',quoted=false;
 text=String(text).replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='"'){
   if(quoted&&text[i+1]==='"'){cell+='"';i++}
   else quoted=!quoted;
  }else if(!quoted&&c===','){row.push(cell);cell=''}
  else if(!quoted&&(c==='\r'||c==='\n')){
   if(c==='\r'&&text[i+1]==='\n')i++;
   row.push(cell);if(row.some(v=>v.trim()))rows.push(row.slice());
   if(rows.length>MAX_ROWS)throw Error('Amazon history has too many rows');
   row.length=0;cell='';
  }else cell+=c;
 }
 if(quoted)throw Error('The CSV has an unfinished quoted field');
 row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
 return rows;
}
const normalHeader=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
function extractCSV(text){
 if(Buffer.byteLength(text,'utf8')>MAX_TEXT)throw Error('Amazon CSV is too large');
 const rows=csvRows(text);if(!rows.length)return [];
 let headerAt=-1;
 for(let i=0;i<Math.min(rows.length,20);i++)
  if(rows[i].some(v=>/^(orderid|amazonorderid)$/i.test(normalHeader(v)))){headerAt=i;break}
 if(headerAt<0)throw Error('No Amazon order-history header found');
 const header=rows[headerAt].map(normalHeader);
 const col=(row,...names)=>{
  for(const name of names){const idx=header.indexOf(normalHeader(name));if(idx>=0&&row[idx]!==undefined&&String(row[idx]).trim())return String(row[idx]).trim()}
  return '';
 };
 const out=[];
 for(const row of rows.slice(headerAt+1)){
  const orderId=col(row,'order id','amazon order id'),
   title=col(row,'product name','product title','item title','item description','item name','title'),
   date=isoDate(col(row,'order date','order placed date','purchase date')),
   shipmentDate=isoDate(col(row,'shipment date','ship date','shipped date'));
  if(!orderId||!title||!date)continue;
  const qty=Number(col(row,'quantity','quantity ordered')||1);
  if(!Number.isFinite(qty)||qty<1||qty>1000)continue;
  const itemTotal=usdCents(col(row,'item total','item total amount','item price total','item charged','item total charged'));
  const subtotal=usdCents(col(row,'item subtotal','item subtotal amount','item subtotal price'));
  const unit=usdCents(col(row,'unit price','price per unit','item price','purchase price'));
  const tax=usdCents(col(row,'item subtotal tax','item tax','tax charged'));
  let cents=itemTotal!==null?itemTotal:subtotal!==null?subtotal+(tax||0):unit!==null?Math.round(unit*qty)+(tax||0):null;
  if(!Number.isSafeInteger(cents)||cents<=0)continue;
  const charged=usdCents(col(row,'total charged','order total charged','order total','total owed','grand total'));
  const currency=col(row,'currency','currency code');
  if(currency&&currency.toUpperCase()!=='USD'&&currency!=='$')continue;
  out.push({orderId:orderId.slice(0,90),title:title.slice(0,240),date,shipmentDate,
   cents,charged:charged!==null&&charged>0?charged:null});
 }
 return out;
}
function isoDate(value){
 const s=String(value||'').trim();if(!s)return '';
 let iso='';
 if(/^\d{4}-\d{2}-\d{2}/.test(s))iso=s.slice(0,10);
 else{const m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(m)iso=m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0')}
 if(!iso)return '';
 const d=new Date(iso+'T12:00:00Z');
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===iso?iso:'';
}
function zipTexts(buf){
 let eocd=-1;
 for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--){
  if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break}
 }
 if(eocd<0)throw Error('Invalid Amazon ZIP');
 const count=buf.readUInt16LE(eocd+10),offset=buf.readUInt32LE(eocd+16);
 if(count>500||offset>=buf.length)throw Error('Invalid Amazon ZIP entries');
 const files=[];let ptr=offset,total=0;
 for(let i=0;i<count;i++){
  if(ptr+46>buf.length||buf.readUInt32LE(ptr)!==0x02014b50)throw Error('Invalid Amazon ZIP directory');
  const method=buf.readUInt16LE(ptr+10),compressed=buf.readUInt32LE(ptr+20),
   uncompressed=buf.readUInt32LE(ptr+24),
   n=buf.readUInt16LE(ptr+28),e=buf.readUInt16LE(ptr+30),c=buf.readUInt16LE(ptr+32),
   local=buf.readUInt32LE(ptr+42);
  if(ptr+46+n+e+c>buf.length)throw Error('Invalid ZIP filename');
  const name=buf.subarray(ptr+46,ptr+46+n).toString('utf8');
  ptr+=46+n+e+c;
  if(!/(?:^|\/)(?:Retail\.OrderHistory(?:\.\d+)?|OrderHistory|Amazon[-_ ]Orders?|Orders)(?:\.\d+)?\.csv$/i.test(name))continue;
  if(files.length>=30||uncompressed>MAX_TEXT||total+uncompressed>MAX_TEXT)
   throw Error('Amazon ZIP contains too much order history');
  if(local+30>buf.length||buf.readUInt32LE(local)!==0x04034b50)throw Error('Invalid ZIP entry');
  const start=local+30+buf.readUInt16LE(local+26)+buf.readUInt16LE(local+28);
  if(start+compressed>buf.length)throw Error('Truncated Amazon ZIP');
  let text;
  if(method===0)text=buf.subarray(start,start+compressed);
  else if(method===8)text=zlib.inflateRawSync(buf.subarray(start,start+compressed),{maxOutputLength:MAX_TEXT-total});
  else continue;
  if(text.length!==uncompressed)throw Error('Invalid ZIP entry length');
  total+=text.length;files.push(text.toString('utf8'));
 }
 if(!files.length)throw Error('No supported Amazon order-history CSV found in ZIP');
 return files;
}
function readFile(fileName,base64){
 if(typeof fileName!=='string'||typeof base64!=='string'||base64.length>MAX_FILE*1.4||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64))
  throw Error('Choose an Amazon CSV or ZIP under 6 MB');
 const buf=Buffer.from(base64,'base64');
 if(!buf.length||buf.length>MAX_FILE)throw Error('Choose an Amazon CSV or ZIP under 6 MB');
 let texts;
 if(/\.zip$/i.test(fileName))texts=zipTexts(buf);
 else if(/\.csv$/i.test(fileName))texts=[buf.toString('utf8')];
 else throw Error('Choose a CSV or ZIP exported from Amazon');
 const all=texts.flatMap(extractCSV);
 if(!all.length)throw Error('No usable item-level Amazon orders found. Export Retail.OrderHistory with product names, dates, and prices.');
 return all;
}
function classify(title,categories){
 const name=String(title).toLowerCase();
 const pick=options=>options.map(o=>categories.find(c=>c.toLowerCase()===o.toLowerCase())).find(Boolean);
 const rules=[
  [/(\bdiapers?\b|\bwipes?\b.*\bbaby\b|\bbaby\b.*\bwipes?\b|\btoddler\b|\bstroller\b|\bcrib\b|\bchildren'?s\b|\bkids?\b.*\b(toy|clothes|pajama|shoe|book|jacket|shirt|dress|pants|clothing)\b|\bpreschool\b|\blego\b|\bformula\b)/i,['Kids & Family','Kids','Children']],
  [/(\bcoffee\b|\bcereal\b|\bsnack\b|\bfood\b|\bprotein bar\b|\bpasta\b|\brice\b|\btea bags?\b|\bspices?\b|\bgranola\b|\bchocolate\b|\bcandy\b|\bbeverage\b|\bdrink mix\b|\boatmeal\b|\bpantry\b|\bolive oil\b|\bnuts?\b)/i,['Groceries','Food']],
  [/(\bvitamin\b|\bsupplements?\b|\bmedicine\b|\bibuprofen\b|\bfirst aid\b|\bbandages?\b|\bthermometer\b|\bskin care\b|\btoothpaste\b|\btoothbrush\b|\bdental floss\b|\bshampoo\b|\blotion\b|\bsunscreen\b|\bprescription\b)/i,['Health','Medical']],
  [/(\bauto\b|\bautomotive\b|\bcar battery\b|\bengine\b|\boil filter\b|\bwiper blade\b|\btires?\b|\bbrake pads?\b|\bvehicle\b|\bcar seat cover\b)/i,['Transportation','Auto']],
  [/(\bxbox\b|\bplaystation\b|\bnintendo\b|\bvideo game\b|\bboard game\b|\bpuzzle game\b|\bmovie\b|\bblu-?ray\b|\bgaming\b)/i,['Entertainment']],
  [/(\bprime membership\b|\bkindle unlimited\b|\bsubscription\b)/i,['Subscriptions']],
  [/(\bdetergent\b|\bcleaner\b|\blaundry\b|\bpaper towels?\b|\btoilet paper\b|\btrash bags?\b|\bdish soap\b|\bhand soap\b|\bsponges?\b|\bvacuum\b|\btools?\b|\bhardware\b|\bhome\b|\bpaint\b|\bfaucet\b|\bfilter\b|\bkitchen\b|\bfurniture\b|\bbedding\b)/i,['Home & Maintenance','Household','Shopping']],
  [/(\bclothes?\b|\bshirt\b|\bpants\b|\bjeans\b|\bsocks?\b|\bshoes?\b|\bdress\b|\bjackets?\b|\bshorts\b|\bhoodie\b|\bcharger\b|\bcables?\b|\bkeyboard\b|\bcomputer\b|\bheadphones?\b|\bphone case\b|\blaptop\b|\bbatteries?\b|\bbook\b|\bnotebook\b|\bpens?\b|\boffice\b|\blamp\b|\baccessor(?:y|ies)\b)/i,['Shopping']]
 ];
 for(const [pattern,choices] of rules)if(pattern.test(name)){
  const c=pick(choices);if(c)return c;
 }
 return 'Uncategorized'; // Never invent a category for an unfamiliar product.
}
function groupsOf(rows){
 const orders=new Map();
 for(const row of rows){
  if(!orders.has(row.orderId))orders.set(row.orderId,[]);
  orders.get(row.orderId).push(row);
 }
 const groups=[];
 const push=(id,items)=>{
  const prices=items.map(x=>x.cents),sum=prices.reduce((a,b)=>a+b,0);
  if(!sum||items.length>150)return;
  const charged=[...new Set(items.map(x=>x.charged).filter(n=>n!==null))];
  // An explicit order-level charge is trustworthy only when every item agrees.
  const amount=charged.length===1&&items.every(x=>x.charged===charged[0])?charged[0]:sum;
  const dates=items.map(x=>x.shipmentDate||x.date).filter(Boolean);
  groups.push({id,items,amount,date:dates.sort()[0]||items[0].date});
 };
 for(const [orderId,items] of orders){
  push(orderId,items);
  const byShip=new Map();
  for(const item of items)if(item.shipmentDate){
   if(!byShip.has(item.shipmentDate))byShip.set(item.shipmentDate,[]);
   byShip.get(item.shipmentDate).push(item);
  }
  if(byShip.size>1)for(const [date,subset] of byShip)
   push(orderId+' · '+date,subset);
 }
 // Discard duplicate candidate shapes when an order has only one shipment.
 return [...new Map(groups.map(g=>[g.id+'|'+g.amount,g])).values()];
}
function allocate(items,total,categories){
 const weight=items.reduce((n,i)=>n+i.cents,0);
 if(weight<=0||total<=0)return null;
 const fractions=items.map(i=>({i,exact:total*i.cents/weight}));
 const base=fractions.map(o=>Math.floor(o.exact));
 let remaining=total-base.reduce((a,b)=>a+b,0);
 const sorted=fractions.map((v,i)=>({i,d:v.exact-base[i]})).sort((a,b)=>b.d-a.d||a.i-b.i);
 for(let i=0;i<remaining;i++)base[sorted[i].i]++;
 return items.map((item,i)=>({title:item.title,category:classify(item.title,categories),cents:base[i]}))
  .filter(line=>line.cents>0);
}
function match(rows,transactions,adjustments,validCategories){
 const groups=groupsOf(rows),overrides=adjustments.categoryOverrides||{},
  existing=adjustments.amazonAllocations||{},
  txs=Object.values(transactions||{}).filter(t=>t&&t.pending!==true&&Number(t.amount)>0&&
   /(?:^|\W)(?:amazon|amzn|amz)(?:\W|$)/i.test(String(t.merchant||t.name||''))&&
   Number.isSafeInteger(Math.round(Number(t.amount)*100)));
 const matches=[],attempted=[],ambiguous=new Set(),used=new Set();
 const days=(a,b)=>Math.round((Date.parse(a+'T12:00:00Z')-Date.parse(b+'T12:00:00Z'))/86400000);
 for(const g of groups){
  // Do not trust ambiguous same-value charges across cards or same-day orders.
  const options=txs.filter(t=>Math.round(Number(t.amount)*100)===g.amount&&
   days(t.date,g.date)>=-2&&days(t.date,g.date)<=21&&
   (overrides[t.id]===undefined||overrides[t.id]==='Uncategorized'||existing[t.id]));
  if(options.length===1)attempted.push({g,t:options[0]});
  else if(options.length>1)ambiguous.add(g.id);
 }
 const byTx=new Map();
 for(const a of attempted){
  if(!byTx.has(a.t.id))byTx.set(a.t.id,[]);
  byTx.get(a.t.id).push(a);
 }
 for(const a of attempted){
  if(byTx.get(a.t.id).length!==1){ambiguous.add(a.g.id);continue}
  if(used.has(a.t.id))continue;
  const lines=allocate(a.g.items,a.g.amount,validCategories);
  if(!lines||lines.reduce((n,l)=>n+l.cents,0)!==a.g.amount)continue;
  used.add(a.t.id);
  const categoryNames=[...new Set(lines.map(x=>x.category))],needsReview=categoryNames.includes('Uncategorized');
  const proposed={transactionId:a.t.id,orderId:a.g.id,
   date:a.t.date,amountCents:a.g.amount,lines,categories:categoryNames,
   needsReview,alreadyImported:Boolean(existing[a.t.id])};
  matches.push(proposed);
 }
 return {matches,importedItems:rows.length,orderGroups:groups.length,
  ambiguousOrders:ambiguous.size,unmatchedOrders:Math.max(0,groups.length-matches.length-ambiguous.size)};
}
module.exports={readFile,match,extractCSV,csvRows,usdCents,isoDate,classify};