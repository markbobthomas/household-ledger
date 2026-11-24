'use strict';
// Binary Amazon CSV/ZIP import. Bounded streaming parse: no AI calls,
// whole-archive extraction, password handling, disk writes or bank mutation.
const zlib=require('node:zlib');
const {Readable}=require('node:stream');
const {StringDecoder}=require('node:string_decoder');
const {isoDate,usdCents}=require('./amazon-import.cjs');
const MAX_FILE=79*1024*1024,MAX_EXPANDED=384*1024*1024,
 MAX_ROWS=90000,MAX_SCANNED_ROWS=2000000;
const nameHeader=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const amazonCharge=t=>t&&t.pending!==true&&Number(t.amount)>0&&
 /(?:^|\W)(?:amazon|amzn|amz)(?:\W|$)/i.test(String(t.merchant||t.name||''))&&
 Number.isSafeInteger(Math.round(Number(t.amount)*100));
function targetWindow(transactions,adjustments={}){
 const overrides=adjustments.categoryOverrides||{},
  existing=adjustments.amazonAllocations||{};
 const dates=Object.values(transactions||{}).filter(t=>amazonCharge(t)&&
  (overrides[t.id]===undefined||overrides[t.id]==='Uncategorized')&&
  !existing[t.id]&&isoDate(t.date)).map(t=>isoDate(t.date)).sort();
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
    if(eligible(date)||eligible(shipmentDate)){
     const id=col('order id','amazon order id'),
      title=col('product name','product title','item title','item description','item name','title');
     const qty=Number(col('quantity','quantity ordered')||1);
     if(id&&title&&date&&Number.isFinite(qty)&&qty>=1&&qty<=1000){
      const total=usdCents(col('item total','item total amount','item price total','item charged','item total charged')),
       subtotal=usdCents(col('item subtotal','item subtotal amount','item subtotal price')),
       unit=usdCents(col('unit price','price per unit','item price','purchase price')),
       tax=usdCents(col('item subtotal tax','item tax','tax charged')),
       cents=total!==null?total:subtotal!==null?subtotal+(tax||0):
        unit!==null?Math.round(unit*qty)+(tax||0):null,
       charged=usdCents(col('total charged','order total charged','order total','total owed','grand total')),
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
 const decode=async (stream,expected)=>{
  const csv=parser(window),decoder=new StringDecoder('utf8');let bytes=0;
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
  let eocd=-1;
  for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--){
   if(buffer.readUInt32LE(i)===0x06054b50){eocd=i;break}
  }
  if(eocd<0)throw Error('Invalid Amazon ZIP');
  const count=buffer.readUInt16LE(eocd+10),offset=buffer.readUInt32LE(eocd+16);
  if(count>500||offset>=buffer.length)throw Error('Invalid Amazon ZIP entries');
  const files=[];let ptr=offset;
  for(let i=0;i<count;i++){
   if(ptr+46>buffer.length||buffer.readUInt32LE(ptr)!==0x02014b50)
    throw Error('Invalid Amazon ZIP directory');
   const method=buffer.readUInt16LE(ptr+10),compressed=buffer.readUInt32LE(ptr+20),
    uncompressed=buffer.readUInt32LE(ptr+24),n=buffer.readUInt16LE(ptr+28),
    e=buffer.readUInt16LE(ptr+30),c=buffer.readUInt16LE(ptr+32),
    local=buffer.readUInt32LE(ptr+42);
   if(ptr+46+n+e+c>buffer.length)throw Error('Invalid ZIP filename');
   const name=buffer.subarray(ptr+46,ptr+46+n).toString('utf8');
   ptr+=46+n+e+c;
   if(!/(?:^|\/)(?:Retail\.OrderHistory(?:\.\d+)?|OrderHistory|Amazon[-_ ]Orders?|Orders)(?:\.\d+)?\.csv$/i.test(name))continue;
   if(files.length>=30||uncompressed>MAX_EXPANDED)
    throw Error('Amazon ZIP contains too much order history');
   if(local+30>buffer.length||buffer.readUInt32LE(local)!==0x04034b50)
    throw Error('Invalid ZIP entry');
   const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28);
   if(start+compressed>buffer.length)throw Error('Truncated Amazon ZIP');
   if(method!==0&&method!==8)throw Error('Unsupported Amazon ZIP compression');
   files.push({start,compressed,uncompressed,method});
  }
  if(!files.length)throw Error('No supported Amazon order-history CSV found in ZIP');
  for(const f of files){
   const part=buffer.subarray(f.start,f.start+f.compressed);
   const input=Readable.from(chunks(part));
   const output=f.method===8?input.pipe(zlib.createInflateRaw()):input;
   try{await decode(output,f.uncompressed)}
   catch(e){output.destroy?.();throw e}
  }
 }else throw Error('Choose a CSV or ZIP exported from Amazon');
 return aggregate;
}
module.exports={readFile,targetWindow,MAX_FILE};