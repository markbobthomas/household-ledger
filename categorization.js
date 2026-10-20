/* Conservative household categorization for incoming bank transactions.
 * Priority is handled in ledger-data: manual -> learned rule -> provider category
 * -> recognizable merchant -> Other. Never fabricate merchant evidence.
 */
(function(root){
'use strict';
const CATEGORIES=['Groceries','Shopping','Housing','Utilities','Transportation','Dining','Health',
 'Entertainment','Kids & Family','Insurance','Subscriptions','Other'];
const confidence={VERY_HIGH:0.99,HIGH:0.93,MEDIUM:0.75,LOW:0.4,UNKNOWN:0};
const nameOf=t=>String(t?.merchant_name||t?.merchant||t?.name||t?.description||'').toLowerCase().trim()
 .replace(/^(?:refund|reversal|return|returned|credit|purchase return)\s*[:#-]?\s*/,'');
const safeWord=(s,r)=>r.test(s);

/* Bank-coded loan repayments are withdrawals, not internal transfers.
 * Card settlements and explicit own-account transfers are different: never
 * count either a second time as a household expense. Plaid PFC detail and
 * recognizable lender descriptions can identify an external mortgage bill.
 */
function loanBill(t){
 const pfc=t?.personal_finance_category||t?.personalFinanceCategory||
   t?.source?.personalFinanceCategory||t?.source?.personal_finance_category||t?.category;
 const primary=String(pfc?.primary||'').toUpperCase(),detail=String(pfc?.detailed||'').toUpperCase();
 const name=nameOf(t),loanCode=primary==='LOAN_PAYMENTS';
 const mortgage=/\b(?:mortgage|mtg|home\s+loan|home\s+mtg|pennymac|loandepot|newrez|shellpoint|mr\.?\s+cooper)\b/i.test(name)||
   /(?:MORTGAGE|HOME_LOAN|HOME_EQUITY)/.test(detail);
 const creditCode=/(?:CREDIT_CARD|CARD_PAYMENT)/.test(detail);
 const cardName=/\b(?:credit\s+card|cardmember|visa|mastercard|amex|american\s+express|discover\s+card|card\s+autopay|cc\s+pymt)\b/i.test(name);
 const internal=/\b(?:transfer\s+(?:to|from)|internal\s+transfer|xfer\s+(?:to|from))\b/i.test(name);
 const isBill=(loanCode||mortgage)&&!creditCode&&!cardName&&!internal;
 return {isBill,isMortgage:isBill&&mortgage,isCardSettlement:creditCode||cardName};
}

function pfcCategory(pfc){
 if(!pfc||typeof pfc!=='object')return null;
 const primary=String(pfc.primary||'').toUpperCase(),detailed=String(pfc.detailed||'').toUpperCase();
 if(!primary)return null;
 if(primary==='FOOD_AND_DRINK'){
  if(/GROCER|SUPERMARKET/.test(detailed))return 'Groceries';
  if(/RESTAURANT|FAST_FOOD|COFFEE|BAR|CAFE|BAKERY|FOOD_TRUCK/.test(detailed))return 'Dining';
  return null; // FOOD_AND_DRINK alone could mean groceries or restaurants.
 }
 if(primary==='RESTAURANTS')return 'Dining';
 if(primary==='GROCERIES')return 'Groceries';
 if(primary==='TRANSPORTATION'||primary==='AUTO_AND_TRANSPORT')return 'Transportation';
 if(primary==='TRAVEL')return 'Transportation';
 if(primary==='RENT_AND_UTILITIES'){
  const utilityDetail=detailed.replace(/^RENT_AND_UTILITIES_/,'');
  return /^(?:RENT|MORTGAGE|PROPERTY_TAX)(?:_|$)/.test(utilityDetail)?'Housing':'Utilities';
 }
 if(primary==='HOME_AND_GARDEN'||primary==='HOME_IMPROVEMENT')return 'Shopping';
 if(primary==='GENERAL_MERCHANDISE'||primary==='SHOPPING')return 'Shopping';
 if(primary==='MEDICAL'||primary==='HEALTH_AND_FITNESS')return 'Health';
 if(primary==='ENTERTAINMENT'||primary==='RECREATION')return 'Entertainment';
 if(primary==='PERSONAL_CARE')return 'Shopping';
 if(primary==='INSURANCE')return 'Insurance';
 if(primary==='CHILDCARE'||primary==='EDUCATION')return 'Kids & Family';
 if(primary==='SUBSCRIPTIONS')return 'Subscriptions';
 if(primary==='BANK_FEES')return 'Other';
 // Transfer/loan/payroll categories belong to accounting classification, not consumption.
 return null;
}
function merchantCategory(t){
 const name=nameOf(t);
 // Do not infer a grocery category from a multipurpose merchant.
 // Plaid can still provide an explicit groceries PFC above this fallback.
 if(/\b(costco|amazon|amzn|walmart|wal-mart|target|paypal|venmo|etsy|ebay)\b/.test(name))
  return null;
 const rules=[
  ['Groceries',/\b(grocery|groceries|supermarket|safeway|trader joe'?s|whole foods|kroger|albertsons|fred meyer|winco|publix|aldi)\b/],
  ['Transportation',/\b(gas station|gasoline|shell|chevron|exxon|arco|bp fuel|fuel station|parking|toll|uber|lyft|metro fare|transit)\b/],
  ['Housing',/\b(rent payment|mortgage|landlord|property management|hoa dues)\b/],
  ['Utilities',/\b(electricity|power bill|water utility|sewer|garbage service|internet service|xfinity|comcast|verizon|t-mobile|at&t|utility bill)\b/],
  ['Dining',/\b(restaurant|pizzeria|pizza|starbucks|coffee shop|cafe|caf[eé]|burger king|mcdonald'?s|chipotle|doordash|grubhub|ubereats)\b/],
  ['Health',/\b(pharmacy|walgreens|cvs pharmacy|hospital|clinic|dentist|dental|vision care)\b/],
  ['Insurance',/\b(insurance premium|state farm|geico|progressive insurance|allstate)\b/],
  ['Entertainment',/\b(cinema|movie theater|concert tickets|steam games|gaming|amusement park)\b/],
  ['Kids & Family',/\b(daycare|childcare|preschool|school lunch|kids camp)\b/],
  ['Subscriptions',/\b(netflix|spotify|youtube premium|hulu|disney plus|apple music|membership subscription)\b/],
  ['Shopping',/\b(home depot|best buy|hardware store|clothing shop|electronics store|ikea|office depot)\b/]
 ];
 for(const [cat,re] of rules)if(safeWord(name,re))return cat;
 return null;
}
function classify(t){
 const obligation=loanBill(t);
 if(obligation.isMortgage)return {category:'Housing',method:'mortgage-payment',confidence:.93,confidenceLevel:'RULE'};
 const src=t?.source||{};
 const pfc=t?.personal_finance_category||t?.personalFinanceCategory||
  src.personalFinanceCategory||src.personal_finance_category;
 const pfcCat=pfcCategory(pfc),level=String(pfc?.confidence_level||pfc?.confidenceLevel||'UNKNOWN').toUpperCase();
 if(pfcCat&&confidence[level]>=0.7)
  return {category:pfcCat,method:'plaid-category',confidence:confidence[level],confidenceLevel:level};
 // If Plaid isn't confident, only a clearly recognizable merchant is categorized.
 const merchant=merchantCategory(t);
 if(merchant)return {category:merchant,method:'merchant-match',confidence:0.7,
  confidenceLevel:'RULE'};
 return {category:'Other',method:'unclassified',confidence:0,confidenceLevel:'UNKNOWN'};
}
const api={classify,pfcCategory,merchantCategory,loanBill,CATEGORIES};
root.HouseholdCategorization=api;
if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
