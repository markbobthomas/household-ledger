'use strict';
// Binary Amazon CSV/ZIP import. Bounded streaming parse: no AI calls,
// whole-archive extraction, password handling, disk writes or bank mutation.
const zlib=require('node:zlib');
const {Readable}=require('node:stream');
const {StringDecoder}=require('node:string_decoder');
const {isoDate,usdCents,ORDER_CSV}=require('./amazon-import.cjs');
const {selectedEntries}=require('./amazon-zip.cjs');
const MAX_FILE=79*1024*1024,MAX_EXPANDED=384*1024*1024,
 MAX_ROWS=90000,MAX_SCANNED_ROWS=2000000;
const nameHeader=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const amazonCharge=t=>t&&t.pending!==true&&Number(t.amount)>0&&
 /(?:^|\W)(?:amazon|amzn|amz)(?:\W|$)/i.test(String(t.merchant||t.name||''))&&
 Number.isSafeInteger(Math.round(Number(t.amount)*100));
function targetWindow(transactions,adjustments={}){
 const overrides=adjustments.categoryOverrides||{},
  notes=adjustments.predictions?.transactionNotes||{};
 // A charge with a manual category may still need its Amazon product Note.
 // Include every Amazon charge missing its bank-note overlay, even if a
 // prior category import or manual category is already present.
 const dates=Object.values(transactions||{}).filter(t=>amazonCharge(t)&&
  (!String(notes['bank:'+JSON.stringify([String(t.accountId||''),String(t.id)])]||'').trim()||
   overrides[t.id]===undefined||overrides[t.id]==='Uncategorized')&&
  isoDate(t.date)).map(t=>isoDate(t.date)).sort();
 if(!dates.length)return null;
 const shift=(d,n)=>{
  const date=new Date(d+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+n);
  return date.toISOString().slice(0,10);
 };
 return {minDate:shift(dates[0],-21),maxDate:shift(dates.at(-1),2),
  outstandingAmazonCharges:dates.length};
}
// Parse CSV across arbitrary stream-chunk boundaries, including embedded
// quoted commas/newlines and escaped quotes.
function parser(window={}){
 const items=[];
 let row=[],cell='',quoted=false,possibleClose=false,afterCR=false,
  scanned=0,header=null,ended=false;
 const eligible=date=>date&&
  (!window.minDate||date>=window.minDate)&&
  (!window.maxDate||date<=window.maxDate);
 function processRow(){
  row.push(cell);cell='';
  if(row.some(v=>v.trim())){
   if(++scanned>MAX_SCANNED_ROWS)throw Error('Amazon export has too many rows');
   if(!header){
    if(scanned>20)throw Error('No Amazon order-history header found');
    if(row.some(v=>/^(orderid|amazonorderid)$/i.test(nameHeader(v))))
     header=row.map(nameHeader);
   }else{
    const col=(...names)=>{
     for(const name of names){
      const i=header.indexOf(nameHeader(name));
      if(i>=0&&row[i]!==undefined&&String(row[i]).trim())return String(row[i]).trim();
     }
     return '';
    };
    const date=isoDate(col('order date','order placed date','purchase date')),
     shipmentDate=isoDate(col('shipment date','ship date','shipped date'));
    const id=col('order id','amazon order id'),
     cancelled=/\bcancell?ed\b/i.test(col('order status','item status'));
    if(window._targetOrders){
     // Second pass: include EVERY line of a relevant order, not just the
     // in-window shipment. Partial orders could allocate incorrect amounts.
    }else if(id&&!cancelled&&(eligible(date)||eligible(shipmentDate))){
     if(window._discoverOrders.size>=MAX_ROWS)
      throw Error('Too many relevant Amazon orders');
     window._discoverOrders.add(id);
    }
    if(window._targetOrders?.has(id)&&!cancelled){
     const title=col('product name','product title','item title','item description','item name','title');
     const qty=Number(col('original quantity','quantity','quantity ordered')||1);
     if(id&&title&&date&&Number.isFinite(qty)&&qty>=1&&qty<=1000){
      // Amazon's Total Amount (2026) / Total Owed (older) is an
      // individual product-line amount. Never treat it as an order total.
      const total=usdCents(col('total amount','total owed','item total','item total amount','item price total','item charged','item total charged')),
       subtotal=usdCents(col('shipment item subtotal','item subtotal','item subtotal amount','item subtotal price')),
       unit=usdCents(col('unit price','price per unit','item price','purchase price')),
       tax=usdCents(col('shipment item subtotal tax','item subtotal tax','item tax','tax charged')),
       cents=total!==null?total:subtotal!==null?subtotal+(tax||0):
        unit!==null?Math.round(unit*qty)+(tax||0):null,
       charged=usdCents(col('total charged','order total charged','order total','grand total')),
       currency=col('currency','currency code');
      if(Number.isSafeInteger(cents)&&cents>0&&
         (!currency||currency.toUpperCase()==='USD'||currency==='$')){
       if(items.length>=MAX_ROWS)throw Error('Too many matching Amazon order items');
       items.push({orderId:id.slice(0,90),title:title.slice(0,240),
        date,shipmentDate,cents,charged:charged!==null&&charged>0?charged:null});
      }
     }
    }
   }
  }
  row=[];
 }
 function write(str){
  if(ended)throw Error('Amazon parser is closed');
  for(let i=0;i<str.length;i++){
   const c=str[i];
   if(afterCR){afterCR=false;if(c==='\n')continue}
   if(possibleClose){
    possibleClose=false;
    if(c==='"'){cell+='"';continue}
    quoted=false;
   }
   if(c==='"'){if(quoted)possibleClose=true;else quoted=true}
   else if(!quoted&&c===','){row.push(cell);cell=''}
   else if(!quoted&&(c==='\r'||c==='\n')){
    processRow();if(c==='\r')afterCR=true;
   }else{
    cell+=c;
    if(cell.length>16384)throw Error('Amazon CSV contains an oversized field');
   }
  }
 }
 function end(){
  if(possibleClose)quoted=false;
  if(quoted)throw Error('Amazon CSV has an unfinished quote');
  if(row.length||cell.trim())processRow();
  if(!header)throw Error('No Amazon order-history header found');
  ended=true;
  return items;
 }
 return {write,end};
}
async function readFile(fileName,buffer,window={}){
 if(typeof fileName!=='string'||!Buffer.isBuffer(buffer)||!buffer.length||
    buffer.length>MAX_FILE)throw Error('Choose an Amazon CSV or ZIP of 79 MB or less');
 let aggregate=[],expanded=0;
 const targetOrders=window._targetOrders||null,
  discoverOrders=targetOrders?null:new Set();
 const decode=async (stream,expected)=>{
  const csv=parser({...window,_discoverOrders:discoverOrders}),decoder=new StringDecoder('utf8');let bytes=0;
  for await (const chunk of stream){
   bytes+=chunk.length;expanded+=chunk.length;
   if(bytes>expected||expanded>MAX_EXPANDED)
    throw Error('Amazon ZIP has too much extracted order history');
   csv.write(decoder.write(chunk));
  }
  csv.write(decoder.end());
  if(bytes!==expected)throw Error('Invalid Amazon ZIP entry length');
  const selected=csv.end();
  if(selected.length+aggregate.length>MAX_ROWS)
   throw Error('Too many relevant Amazon order items');
  aggregate=aggregate.concat(selected);
 };
 const chunks=async function*(part){
  for(let i=0;i<part.length;i+=65536)yield part.subarray(i,i+65536);
 };
 if(/\.csv$/i.test(fileName)){
  await decode(chunks(buffer),buffer.length);
 }else if(/\.zip$/i.test(fileName)){
  const files=selectedEntries(buffer,name=>ORDER_CSV.test(name),{
   maxSelected:30,maxUncompressed:MAX_EXPANDED
  });
  if(!files.length)throw Error('No supported Amazon order-history CSV found in ZIP');
  for(const f of files){
   const part=buffer.subarray(f.start,f.start+f.compressed);
   const input=Readable.from(chunks(part));
   const output=f.method===8?input.pipe(zlib.createInflateRaw()):input;
   try{await decode(output,f.uncompressed)}
   catch(e){output.destroy?.();throw e}
  }
 }else throw Error('Choose a CSV or ZIP exported from Amazon');
 // Two streaming passes avoid accidentally splitting a single multi-shipment
 // order across the date cutoff. The first pass retains only eligible order
 // IDs; the second retains all line items belonging to those IDs.
 if(discoverOrders){
  if(!discoverOrders.size)return [];
  return readFile(fileName,buffer,{...window,_targetOrders:discoverOrders});
 }
 return aggregate;
}
module.exports={readFile,targetWindow,MAX_FILE};