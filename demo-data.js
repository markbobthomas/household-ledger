// Fictional demo transactions only. This file never contains real household financial records.
(function () {
  'use strict';
  window.createHouseholdLedgerDemo = function createHouseholdLedgerDemo() {
    const transactions = [];
    const items = [];
    let serial = 0;
    function add(date, merchant, amount, category, type = 'expense', account = 'Checking') {
      const row = {
        id: 'demo-tx-' + (++serial),
        date, merchant, amount, category, type, account,
        description: type === 'transfer' ? 'Sample account transfer' : 'Fictional sample transaction',
        demo: true
      };
      transactions.push(row);
      return row;
    }
    function itemize(date, merchant, parts) {
      const parent = transactions.find(t => t.date === date && t.merchant === merchant && t.type === 'expense');
      if (!parent) return;
      let subtotal = 0;
      parts.forEach(([description, amount], index) => {
        subtotal += amount;
        items.push({
          id: 'demo-item-' + parent.id + '-' + index, transactionId: parent.id,
          description, amount: Number(amount.toFixed(2)), demo: true
        });
      });
      const remainder = Math.round((parent.amount - subtotal) * 100) / 100;
      if (remainder > 0) {
        items.push({
          id: 'demo-item-' + parent.id + '-other', transactionId: parent.id,
          description: 'Other items and tax', amount: remainder, demo: true
        });
      }
    }
    const months = ['2026-07', '2026-08', '2026-09'];
    const variations = [
      {electric: 124.10, costco: 193.82, amazon: 86.24, car: 72.40, target: 64.90},
      {electric: 139.36, costco: 211.65, amazon: 119.58, car: 58.14, target: 43.22},
      {electric: 111.42, costco: 187.94, amazon: 93.35, car: 95.16, target: 76.29}
    ];
    for (let i = 0; i < months.length; i++) {
      const m = months[i];
      const v = variations[i];
      const day = n => m + '-' + String(n).padStart(2, '0');
      [
        [1, 'Household Paycheck', 3920, 'Other', 'income'],
        [15, 'Household Paycheck', 3920, 'Other', 'income'],
        [5, 'Partner Paycheck', 1850, 'Other', 'income'],
        [19, 'Partner Paycheck', 1850, 'Other', 'income'],
        [2, 'Mortgage', 2650, 'Housing'],
        [3, 'Daycare', 825, 'Kids & Family'],
        [4, 'Puget Sound Energy', v.electric, 'Utilities'],
        [5, 'Xfinity Internet', 79.99, 'Utilities'],
        [6, 'Costco Warehouse', v.costco, 'Groceries'],
        [7, 'Costco Gas', 54.61 + i * 3, 'Transportation'],
        [8, 'Amazon', v.amazon, 'Shopping'],
        [9, 'Safeway', 98.72 + i * 8, 'Groceries'],
        [10, 'State Farm Insurance', 186.40, 'Insurance'],
        [11, 'City Water Utility', 67.30, 'Utilities'],
        [12, 'Netflix', 17.99, 'Subscriptions'],
        [13, 'Walmart', 72.11 + i * 12, 'Shopping'],
        [14, 'Safeway', 126.21 - i * 7, 'Groceries'],
        [15, 'Transfer to Savings', 600, 'Other', 'transfer'],
        [16, 'Shell Gas', v.car, 'Transportation'],
        [17, 'Starbucks', 12.80 + i * 3, 'Dining'],
        [18, 'Costco Warehouse', 156.33 + i * 8, 'Groceries'],
        [19, 'Spotify', 11.99, 'Subscriptions'],
        [20, 'Target', v.target, 'Shopping'],
        [21, 'Safeway', 104.19 + i * 5, 'Groceries'],
        [22, 'Chipotle', 33.74, 'Dining'],
        [23, 'Verizon Wireless', 118.54, 'Utilities'],
        [24, 'Costco Gas', 49.32 + i * 5, 'Transportation'],
        [25, 'Amazon', 52.46 + i * 12, 'Shopping'],
        [26, 'Safeway', 86.23 + i * 9, 'Groceries'],
        [27, 'Home Depot', 96.32 + i * 13, 'Housing'],
        [28, 'Family Pizza Night', 51.70 + i * 6, 'Dining'],
        [29, 'Chase Credit Card Payment', 1250, 'Other', 'transfer'],
        [30, 'Costco Warehouse', 112.54 + i * 15, 'Groceries'],
        [30, 'Kids Activities', 58.00 + i * 13, 'Kids & Family']
      ].forEach(([d, merchant, amount, category, type]) => add(day(d), merchant, Math.round(amount * 100) / 100, category, type || 'expense'));
      itemize(day(6), 'Costco Warehouse', [['Fresh produce', 38.24], ['Dairy and eggs', 29.85], ['Household paper goods', 24.99]]);
      itemize(day(8), 'Amazon', [['USB cable', 12.99], ['School supplies', 18.75]]);
      itemize(day(13), 'Walmart', [['Cleaning supplies', 16.48], ['Pantry food', 14.92]]);
      itemize(day(18), 'Costco Warehouse', [['Frozen meals', 37.46], ['Kids snacks', 21.64]]);
    }
    // Partial current month, so date filters can test the October view too.
    [
      ['2026-10-01', 'Household Paycheck', 3920, 'Other', 'income'],
      ['2026-10-02', 'Mortgage', 2650, 'Housing'],
      ['2026-10-03', 'Daycare', 825, 'Kids & Family'],
      ['2026-10-04', 'Puget Sound Energy', 106.70, 'Utilities'],
      ['2026-10-05', 'Partner Paycheck', 1850, 'Other', 'income'],
      ['2026-10-05', 'Xfinity Internet', 79.99, 'Utilities'],
      ['2026-10-06', 'Costco Warehouse', 205.44, 'Groceries'],
      ['2026-10-07', 'Costco Gas', 59.12, 'Transportation'],
      ['2026-10-08', 'Amazon', 77.91, 'Shopping'],
      ['2026-10-09', 'Safeway', 115.65, 'Groceries'],
      ['2026-10-10', 'State Farm Insurance', 186.40, 'Insurance'],
      ['2026-10-11', 'City Water Utility', 67.30, 'Utilities'],
      ['2026-10-12', 'Netflix', 17.99, 'Subscriptions'],
      ['2026-10-13', 'Walmart', 63.82, 'Shopping'],
      ['2026-10-14', 'Safeway', 84.75, 'Groceries'],
      ['2026-10-15', 'Household Paycheck', 3920, 'Other', 'income'],
      ['2026-10-15', 'Transfer to Savings', 600, 'Other', 'transfer']
    ].forEach(([date, merchant, amount, category, type]) => add(date, merchant, amount, category, type || 'expense'));
    itemize('2026-10-06', 'Costco Warehouse', [['Produce', 42.68], ['Meat and seafood', 67.21], ['Cleaning supplies', 23.99]]);
    itemize('2026-10-08', 'Amazon', [['Lunch containers', 24.95], ['Office supplies', 18.76]]);
    return {
      transactions, items,
      budgets: {
        'Groceries': 1050, 'Shopping': 450, 'Housing': 2900, 'Utilities': 440,
        'Transportation': 250, 'Dining': 220, 'Kids & Family': 1000,
        'Insurance': 210, 'Subscriptions': 50
      }
    };
  };
})();
