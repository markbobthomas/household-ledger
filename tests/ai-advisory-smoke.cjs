'use strict';
const assert=require('node:assert/strict');
const {validateAdvisories}=require('../pilot/ai-advisory.cjs');
const rows=[{id:'bank-1',accountId:'checking'}];
const candidate={kind:'missing-payment',accountId:'checking',predictedDate:'2026-12-01',
 predictedAmount:2000,confidence:.82,evidenceTransactionIds:['bank-1'],
 explanation:'Recurring transfer may fund a housing payment'};
const result=validateAdvisories([candidate],rows,['checking']);
assert.equal(result[0].status,'needs-confirmation');
assert.equal(result[0].origin,'ai-advisory');
assert.equal(result[0].predictedAmount,2000);
assert.throws(()=>validateAdvisories([{...candidate,evidenceTransactionIds:['fabricated']}],rows,['checking']),/Evidence/);
assert.throws(()=>validateAdvisories([{...candidate,accountId:'other'}],rows,['checking']),/unknown account/);
assert.throws(()=>validateAdvisories([{...candidate,confidence:1.5}],rows,['checking']),/confidence/);
assert.throws(()=>validateAdvisories([{...candidate,predictedAmount:Infinity}],rows,['checking']),/amount/);
assert.throws(()=>validateAdvisories([{...candidate,kind:'execute-payment'}],rows,['checking']),/kind/);
assert.throws(()=>validateAdvisories([{...candidate,explanation:''}],rows,['checking']),/explanation/);
console.log('AI advisory boundary: passed');
