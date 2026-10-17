/* Simulated bank connector. Replace with a secure authenticated backend; never store Plaid tokens here. */
(function (root) {
  'use strict';
  const provider = {
    mode: 'demo',
    getSnapshot(today) {
      const asOf = /^\d{4}-\d{2}-\d{2}$/.test(String(today || '')) ? today : new Date().toLocaleDateString('en-CA');
      return {
        source: 'Simulated bank feed — not connected to any institution',
        mode: 'demo',
        connected: false,
        lastSuccessfulSync: null,
        expectedAccountIds: [],
        asOf,
        accounts: [{
          id: 'demo-checking',
          institution: 'Sample Bank (demo)',
          name: 'Everyday Checking ••0042',
          accountType: 'checking',
          currency: 'USD',
          current: 5650.25,
          available: 5400.25,
          transactionAccount: 'Checking',
          simulated: true
        },{
          id:'demo-savings',institution:'Sample Bank (demo)',name:'Emergency Savings ••0189',
          accountType:'savings',currency:'USD',current:2250,available:2250,
          transactionAccount:'Savings',simulated:true
        },{
          id:'demo-visa',institution:'Sample Card (demo)',name:'Rewards Visa ••3201',
          accountType:'credit',currency:'USD',current:810,available:4190,
          transactionAccount:'Visa',simulated:true
        },{
          id:'demo-mastercard',institution:'Sample Card (demo)',name:'Everyday Mastercard ••5520',
          accountType:'credit',currency:'USD',current:390,available:2610,
          transactionAccount:'Mastercard',simulated:true
        }]
      };
    }
  };
  root.HouseholdBankFeed = provider;
  if(typeof module !== 'undefined' && module.exports) module.exports = provider;
})(typeof window !== 'undefined' ? window : globalThis);
