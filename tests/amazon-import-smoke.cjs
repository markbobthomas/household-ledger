'use strict';
const assert=require('node:assert/strict');
const A=require('../pilot/amazon-import.cjs');
const csv=[
 'Order ID,Order Date,Product Name,Item Total,Total Charged,Shipment Date',
 '113-1111111-1111111,2026-10-10,"Laundry detergent, 100 oz",$25.00,$120.00,2026-10-11',
 '113-1111111-1111111,2026-10-10,Kids jacket,$45.00,$120.00,2026-10-11',
 '113-1111111-1111111,2026-10-10,Automotive wiper blade,$50.00,$120.00,2026-10-11',
 '113-2222222-2222222,2026-10-12,Unknown gadget model ZX-10,$10.00,$10.00,2026-10-12',
 '113-3333333-3333333,2026-10-13,Kitchen sponge,$2.49,$2.49,2026-10-13'
].join('\n');
const items=A.readFile('Retail.OrderHistory.1.csv',Buffer.from(csv).toString('base64'));
assert.equal(items.length,5);
assert.equal(items[0].title,'Laundry detergent, 100 oz');
assert.equal(items[0].cents,2500);
const categories=['Shopping','Groceries','Health','Kids & Family','Transportation','Other','Uncategorized','Home & Maintenance'];
const tx={
 a:{id:'a',name:'AMAZON MKTPLACE',date:'2026-10-15',amount:120,pending:false,accountId:'credit-one'},
 b:{id:'b',name:'AMZN MKTPLACE',date:'2026-10-14',amount:10,pending:false,accountId:'credit-one'},
 c:{id:'c',name:'AMAZON',date:'2026-10-15',amount:2.49,pending:true,accountId:'credit-one'},
 unrelated:{id:'unrelated',name:'Fictional gas',date:'2026-10-15',amount:120,accountId:'credit-one'},
 cash:{id:'cash',name:'AMAZON',date:'2026-10-15',amount:-45,accountId:'checking'}
};
let analysis=A.match(items,tx,{categoryOverrides:{}},categories);
const a=analysis.matches.find(m=>m.transactionId==='a');
assert.ok(a,'exact posted Amazon match');
assert.equal(a.lines.reduce((n,line)=>n+line.cents,0),12000);
assert.equal(a.lines.length,3);
assert.equal(a.lines.find(x=>/automotive/i.test(x.title)).category,'Transportation');
assert.equal(a.lines.find(x=>/kids/i.test(x.title)).category,'Kids & Family');
assert.equal(a.lines.find(x=>/detergent/i.test(x.title)).category,'Home & Maintenance');
assert.equal(a.needsReview,false);
const b=analysis.matches.find(m=>m.transactionId==='b');
assert.equal(b.needsReview,true);
assert.equal(b.lines[0].category,'Uncategorized');
assert.ok(!analysis.matches.some(m=>m.transactionId==='c'||m.transactionId==='cash'||m.transactionId==='unrelated'));
assert.deepEqual(Object.keys(tx),['a','b','c','unrelated','cash'],'matching cannot mutate bank facts');
const manual=A.match(items,tx,{categoryOverrides:{a:'Groceries'}},categories);
assert.ok(!manual.matches.some(m=>m.transactionId==='a'),'manual category not replaced');
const unassigned=A.match(items,tx,{categoryOverrides:{a:'Uncategorized'}},categories);
assert.ok(unassigned.matches.some(m=>m.transactionId==='a'),'unassigned Amazon charges can be classified');
const reimport=A.match(items,tx,{amazonAllocations:{a:{orderId:a.orderId,lines:a.lines,amountCents:12000}}},categories);
assert.ok(reimport.matches.some(m=>m.transactionId==='a'),'existing import remains linkable');
const ambiguous=A.match(items,{...tx,a2:{...tx.a,id:'a2',accountId:'credit-two'}},{},categories);
assert.ok(!ambiguous.matches.some(m=>m.transactionId==='a'||m.transactionId==='a2'));
const stale=A.match(items,{...tx,a:{...tx.a,date:'2026-11-25'}},{},categories);
assert.ok(!stale.matches.some(m=>m.transactionId==='a'));
const quoted='Order ID,Order Date,Product Name,Item Price,Quantity,Item Subtotal Tax\n'+
 'ABC,10/10/2026,"Batteries ""AA"" 10 pack",3.00,2,0.24';
const parsed=A.readFile('data.csv',Buffer.from(quoted).toString('base64'));
assert.equal(parsed[0].title,'Batteries "AA" 10 pack');
assert.equal(parsed[0].cents,624);
assert.throws(()=>A.readFile('bad.txt',Buffer.from(csv).toString('base64')),/CSV or ZIP/);
assert.throws(()=>A.readFile('Orders.csv',Buffer.from('hello,bad').toString('base64')),/header/);
// Create a minimal stored ZIP with central-directory metadata and no external tooling.
const zipped=Buffer.from(csv);
const name=Buffer.from('Amazon/Orders/Retail.OrderHistory.1.csv');
const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(name.length,26);
const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt32LE(zipped.length,20);central.writeUInt32LE(zipped.length,24);central.writeUInt16LE(name.length,28);
const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);
end.writeUInt32LE(central.length+name.length,12);
end.writeUInt32LE(local.length+name.length+zipped.length,16);
const zip=Buffer.concat([local,name,zipped,central,name,end]);
assert.equal(A.readFile('my-amazon-export.zip',zip.toString('base64')).length,5);
console.log('Amazon item import: CSV/ZIP, exact match, category splits, review, manual priority, ambiguity PASS');


// Large private importer: 79 MiB binary transport, streaming ZIP/CSV, and
// bank-derived date cutoff. Uses fictional amounts, no external AI/API calls.
(async()=>{
 const S=require('../pilot/amazon-stream.cjs'),zlib=require('node:zlib');
 assert.equal(S.MAX_FILE,79*1024*1024);
 const window=S.targetWindow(tx,{categoryOverrides:{b:'Groceries'}});
 assert(window&&window.outstandingAmazonCharges===1,
  'Manually categorized charges do not enlarge required order-history range');
 assert.equal(window.minDate,'2026-09-24');
 assert.equal(window.maxDate,'2026-10-17');
 assert.equal(S.targetWindow(tx,{categoryOverrides:{a:'Shopping',b:'Groceries'}}),null,
  'No unresolved Amazon charges means there is no history to process');
 const old='113-0000000-0000001,2018-01-01,Old clothing,20.00,20.00,2018-01-02';
 const recent='113-1111111-1111111,2026-10-10,"Laundry detergent, 100 oz",25.00,120.00,2026-10-11';
 const header='Order ID,Order Date,Product Name,Item Total,Total Charged,Shipment Date';
 const txt=[header,old,recent].join('\r\n');
 const parsed=await S.readFile('Retail.OrderHistory.csv',Buffer.from(txt),window);
 assert.equal(parsed.length,1,'Old irrelevant orders excluded before categorization');
 assert.equal(parsed[0].title,'Laundry detergent, 100 oz');
 assert.equal(parsed[0].charged,12000);
 const match=A.match(parsed,tx,{categoryOverrides:{}},categories);
 assert(match.matches.some(m=>m.transactionId==='a'));
 const quote='Order ID,Order Date,Product Name,Item Price,Quantity,Item Subtotal Tax\n'+
  'ABC,10/10/2026,"Batteries ""AA""\n10 pack",3.00,2,0.24';
 const multiline=await S.readFile('Orders.csv',Buffer.from(quote),window);
 assert.equal(multiline[0].cents,624);
 assert.equal(multiline[0].title,'Batteries "AA"\n10 pack');
 const filename=Buffer.from('Amazon/Orders/Retail.OrderHistory.1.csv'),
  content=Buffer.from(txt),compressed=zlib.deflateRawSync(content),
  loc=Buffer.alloc(30),dir=Buffer.alloc(46),eocd=Buffer.alloc(22);
 loc.writeUInt32LE(0x04034b50,0);loc.writeUInt16LE(8,8);loc.writeUInt16LE(filename.length,26);
 dir.writeUInt32LE(0x02014b50,0);dir.writeUInt16LE(8,10);
 dir.writeUInt32LE(compressed.length,20);dir.writeUInt32LE(content.length,24);
 dir.writeUInt16LE(filename.length,28);
 eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(1,8);eocd.writeUInt16LE(1,10);
 eocd.writeUInt32LE(dir.length+filename.length,12);
 eocd.writeUInt32LE(loc.length+filename.length+compressed.length,16);
 const zipCompressed=Buffer.concat([loc,filename,compressed,dir,filename,eocd]);
 const fromZip=await S.readFile('Amazon Orders.zip',zipCompressed,window);
 assert.equal(fromZip.length,1,'Compressed ZIP decoded with same date filter');
 assert.equal(fromZip[0].charged,12000);
 await assert.rejects(()=>S.readFile('Orders.zip',Buffer.from('invalid'),window),/ZIP/);
 await assert.rejects(()=>S.readFile('Orders.csv',Buffer.alloc(S.MAX_FILE+1),window),/79 MB/);
 // Realistic 47 MB text export: the old rows must be scanned, but must not
 // be retained, categorized or billed as model tokens.
 const filler='113-0000000-0000001,2018-01-01,Old household item '+('x'.repeat(180))+
  ',3.00,3.00,2018-01-01\r\n';
 const before=Buffer.from(header+'\r\n'+filler.repeat(Math.ceil(47*1024*1024/Buffer.byteLength(filler)))+
  recent+'\r\n');
 assert(before.length>47*1024*1024,'Large fixture exceeds users 47 MB file size');
 const large=await S.readFile('Retail.OrderHistory.csv',before,window);
 assert.equal(large.length,1,'The 47 MB file yields only the one in-window order');
 assert.equal(large[0].orderId,parsed[0].orderId);
 console.log('PASS 79 MB binary Amazon import: 47 MB streaming fixture, compressed ZIP, date-window filtering and zero AI calls');
})().catch(e=>{console.error(e);process.exitCode=1});
