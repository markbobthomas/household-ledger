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
 // A shipment placed long before the bank window must retain every item
 // once any one shipment proves the order is relevant. Dropping half an
 // order could silently misallocate the posted bank amount.
 const splitCsv=[header,
  '113-5555555-5555555,2026-08-01,Home sponge,10.00,20.00,2026-08-03',
  '113-5555555-5555555,2026-08-01,Kids book,10.00,20.00,2026-10-10'].join('\r\n');
 const splitRows=await S.readFile('Orders.csv',Buffer.from(splitCsv),window);
 assert.equal(splitRows.length,2,'All shipment lines of a selected order must survive the cutoff');
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
 // Amazon changed its 2026 export name and renamed several columns.
 // "Total Amount" belongs to a single item, not the whole order: even
 // identical line totals must sum to the actual posted bank charge.
 const modernCsv=[
  'Order ID,Order Date,Product Name,Original Quantity,Total Amount,Unit Price,Unit Price Tax,Order Status,Ship Date,Currency',
  '113-9999999-0000001,2026-10-10T20:00:00Z,Kids jacket,2,25.00,10.00,2.50,Shipped,2026-10-11T11:00:00Z,USD',
  '113-9999999-0000001,2026-10-10T20:00:00Z,Coffee beans,1,25.00,20.00,5.00,Shipped,2026-10-11T11:00:00Z,USD',
  '113-9999999-0000001,2026-10-10T20:00:00Z,Cancelled item,1,99.00,99.00,0.00,Cancelled,2026-10-11T11:00:00Z,USD'
 ].join('\r\n');
 const modernTx={target:{id:'target',name:'AMAZON MKTPLACE',
  amount:50,date:'2026-10-15',pending:false,accountId:'test-credit'}};
 const modernWindow=S.targetWindow(modernTx,{});
 const modern=A.readFile('Order History.csv',Buffer.from(modernCsv).toString('base64'));
 assert.equal(modern.length,2,'Legacy small-CSV handoff recognizes modern columns and excludes cancelled items');
 assert.deepEqual(modern.map(x=>x.cents),[2500,2500],
  'Total Amount is a per-item total and includes tax/shipping/discounts already');
 assert(modern.every(x=>x.charged===null),'Modern item totals must not masquerade as order-level charges');
 const modernBinary=await S.readFile('Order History.csv',Buffer.from(modernCsv),modernWindow);
 assert.equal(modernBinary.length,2,'Binary importer recognizes new 2026 Order History CSV');
 assert.deepEqual(modernBinary.map(x=>x.cents),[2500,2500]);
 const modernMatched=A.match(modernBinary,modernTx,{},categories);
 assert.equal(modernMatched.matches.length,1);
 assert.equal(modernMatched.matches[0].lines.reduce((n,x)=>n+x.cents,0),5000);
 assert.deepEqual(modernMatched.matches[0].lines.map(x=>x.category),
  ['Kids & Family','Groceries']);
 // Amazon ZIP layout since 2026: a spaced filename inside a folder.
 const modernFilename=Buffer.from('Your Orders/Order History.csv'),
  modernContent=Buffer.from(modernCsv),
  modernDeflate=zlib.deflateRawSync(modernContent),
  modernLocal=Buffer.alloc(30),modernCentral=Buffer.alloc(46),
  modernEnd=Buffer.alloc(22);
 modernLocal.writeUInt32LE(0x04034b50);
 modernLocal.writeUInt16LE(8,8);
 modernLocal.writeUInt16LE(modernFilename.length,26);
 modernCentral.writeUInt32LE(0x02014b50);
 modernCentral.writeUInt16LE(8,10);
 modernCentral.writeUInt32LE(modernDeflate.length,20);
 modernCentral.writeUInt32LE(modernContent.length,24);
 modernCentral.writeUInt16LE(modernFilename.length,28);
 modernEnd.writeUInt32LE(0x06054b50);
 modernEnd.writeUInt16LE(1,8);
 modernEnd.writeUInt16LE(1,10);
 modernEnd.writeUInt32LE(modernCentral.length+modernFilename.length,12);
 modernEnd.writeUInt32LE(modernLocal.length+modernFilename.length+modernDeflate.length,16);
 const modernZip=Buffer.concat([modernLocal,modernFilename,modernDeflate,
  modernCentral,modernFilename,modernEnd]);
 assert.equal((await S.readFile('Your Orders.zip',modernZip,modernWindow)).length,2,
  '79 MB streaming ZIP recognizes new Amazon spaced order-history filename');
 assert.equal(A.readFile('Your Orders.zip',modernZip.toString('base64')).length,2,
  'Existing extension handoff accepts modern ZIP data too');

 // Real Amazon export bundles may include >500 auxiliary ZIP entries. An
 // arbitrary central-directory file-count cap previously rejected them before
 // any product data was examined. ZIP64 uses 64-bit directory metadata.
 function largeAmazonZip({metadataFiles=725,zip64=false,entry64=false}={}){
  const locals=[],central=[];
  let localOffset=0;
  for(let i=0;i<=metadataFiles;i++){
   const target=i===metadataFiles,
    path=Buffer.from(target?'Your Orders/Order History.csv':'Other Data/file-'+i+'.json'),
    raw=target?Buffer.from(modernCsv):Buffer.from('{}'),
    data=target?zlib.deflateRawSync(raw):raw,
    method=target?8:0;
   const head=Buffer.alloc(30);
   head.writeUInt32LE(0x04034b50);
   head.writeUInt16LE(method,8);
   head.writeUInt16LE(data.length,18);
   head.writeUInt32LE(raw.length,22);
   head.writeUInt16LE(path.length,26);
   locals.push(head,path,data);
   const extension=entry64&&target?Buffer.alloc(28):Buffer.alloc(0);
   if(extension.length){
    extension.writeUInt16LE(0x0001,0);
    extension.writeUInt16LE(24,2);
    extension.writeBigUInt64LE(BigInt(raw.length),4);
    extension.writeBigUInt64LE(BigInt(data.length),12);
    extension.writeBigUInt64LE(BigInt(localOffset),20);
   }
   const desc=Buffer.alloc(46);
   desc.writeUInt32LE(0x02014b50);
   desc.writeUInt16LE(method,10);
   desc.writeUInt32LE(extension.length?0xffffffff:data.length,20);
   desc.writeUInt32LE(extension.length?0xffffffff:raw.length,24);
   desc.writeUInt16LE(path.length,28);
   desc.writeUInt16LE(extension.length,30);
   desc.writeUInt32LE(extension.length?0xffffffff:localOffset,42);
   central.push(desc,path,extension);
   localOffset+=head.length+path.length+data.length;
  }
  const cd=Buffer.concat(central),count=metadataFiles+1,
   end=Buffer.alloc(22),parts=[...locals,cd];
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(zip64?0xffff:count,8);
  end.writeUInt16LE(zip64?0xffff:count,10);
  end.writeUInt32LE(zip64?0xffffffff:cd.length,12);
  end.writeUInt32LE(zip64?0xffffffff:localOffset,16);
  if(zip64){
   const record=Buffer.alloc(56),locator=Buffer.alloc(20);
   record.writeUInt32LE(0x06064b50);
   record.writeBigUInt64LE(44n,4);
   record.writeBigUInt64LE(BigInt(count),24);
   record.writeBigUInt64LE(BigInt(count),32);
   record.writeBigUInt64LE(BigInt(cd.length),40);
   record.writeBigUInt64LE(BigInt(localOffset),48);
   locator.writeUInt32LE(0x07064b50);
   locator.writeBigUInt64LE(BigInt(localOffset+cd.length),8);
   locator.writeUInt32LE(1,16);
   parts.push(record,locator);
  }
  parts.push(end);
  return Buffer.concat(parts);
 }
 const complex=largeAmazonZip();
 assert.equal((await S.readFile('Amazon Orders.zip',complex,modernWindow)).length,2,
  'A bundle with 725 unrelated ZIP files must not hit the old 500-entry cap');
 assert.equal(A.readFile('Amazon Orders.zip',complex.toString('base64')).length,2,
  'Legacy ZIP parser must also support >500 auxiliary files');
 const complex64=largeAmazonZip({zip64:true,entry64:true});
 const zip64Rows=await S.readFile('Amazon Orders.zip',complex64,modernWindow);
 assert.deepEqual(zip64Rows.map(x=>x.cents),[2500,2500],
  'ZIP64 directory counts, sizes and entry offsets must import safely');
 assert.equal(A.readFile('Amazon Orders.zip',complex64.toString('base64')).length,2);
 const corrupt=Buffer.from(complex64);
 // ZIP64 locator is mandatory when EOCD stores sentinel values.
 corrupt.writeUInt32LE(0,corrupt.length-42);
 await assert.rejects(()=>S.readFile('Amazon Orders.zip',corrupt,modernWindow),
  /ZIP64 directory locator/,'Malformed ZIP64 metadata must be rejected');
 const multipart=Buffer.from(complex);
 multipart.writeUInt16LE(1,multipart.length-22+4);
 await assert.rejects(()=>S.readFile('Amazon Orders.zip',multipart,modernWindow),
  /Multi-part/,'Do not incorrectly parse a multi-disk ZIP');
 console.log('PASS Amazon ZIP64 and 726-entry archive: validated directory, large ZIP, modern order CSV, rejected corrupt/multi-disk');
 console.log('PASS 79 MB binary Amazon import: 47 MB streaming fixture, compressed ZIP, date-window filtering and zero AI calls');
})().catch(e=>{console.error(e);process.exitCode=1});
