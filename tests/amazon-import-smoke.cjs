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
