'use strict';
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const crypto=require('node:crypto'),os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const {chromium,webkit}=require('playwright');
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'household-planner-'));
 const demoPort=18765,privatePort=18766,pass=crypto.randomBytes(24).toString('hex');
 const children=[];
 let chrome,iphone;
 const fixedDate=()=>{const Base=Date;class FixedDate extends Base{
  constructor(...xs){if(xs.length)super(...xs);else super('2026-10-19T12:00:00Z')}
  static now(){return new Base('2026-10-19T12:00:00Z').getTime()}
 }window.Date=FixedDate;};
 const startup=async(url)=>{for(let n=0;n<80;n++){try{const r=await fetch(url);if(r.status<500)return}catch{}await new Promise(r=>setTimeout(r,80))}throw Error('Server not available: '+url)};
 try{
  children.push(spawn('python3',['-m','http.server',String(demoPort),'--bind','127.0.0.1'],
   {cwd:path.resolve(__dirname,'..'),stdio:'ignore'}));
  children.push(spawn(process.execPath,['sandbox/server.cjs'],{cwd:path.resolve(__dirname,'..'),stdio:'ignore',
   env:{...process.env,LIVE_PLAID_ENABLED:'1',PORT:String(privatePort),PILOT_PASSWORD:pass,
    PILOT_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),PLAID_CLIENT_ID:'fictional',
    PLAID_SECRET:'fictional',PLAID_ENV:'sandbox',PILOT_STATE_PATH:path.join(dir,'private.enc')}}));
  await Promise.all([startup('http://127.0.0.1:'+demoPort+'/index.html'),
   startup('http://127.0.0.1:'+privatePort+'/healthz')]);
  chrome=await chromium.launch({headless:true});
  iphone=await webkit.launch({headless:true});
  const staticUrl='http://127.0.0.1:'+demoPort;
  for(const [browser,mobile] of [[chrome,false],[iphone,true]]){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:900}});
   await context.addInitScript(fixedDate);
   const page=await context.newPage(),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto(staticUrl,{waitUntil:'load'});
   assert.equal(await page.locator('h1').innerText(),'Know your balance before the bill.');
   assert.equal(await page.locator('.side-link').count(),1,'Legacy Budget/Insights/Reviews navigation removed');
   assert.equal(await page.locator('#ledger-mode-switch option[value=real]').isDisabled(),true,
    'Public Demo cannot pretend it is authenticated Real');
   assert.match(await page.locator('#source-type').innerText(),/DEMO/);
   assert.ok((await page.locator('.account-tile').count())>=2,'Sample account selection works');
   const checking=page.locator('.account-tile').filter({hasText:'Everyday Checking'});
   await checking.click();
   assert.match(await page.locator('.balance-main').innerText(),/\$5,400\.25/,
    'Demo checking displays an illustrative bank-feed available balance');
   assert.ok((await page.locator('.chart-wrap svg').count())>0,'90-day chart is rendered from forecasting engine');
   assert.match(await page.locator('[aria-label="Selected account projection"]').innerText(),/Lowest balance · next 90 days/);
   assert.match(await page.locator('[aria-label="Selected account projection"]').innerText(),/Available after this month's dated payments/);
   assert.match(await page.locator('[aria-label="Selected account projection"]').innerText(),/First projected shortfall/);
   const demoMortgage=page.locator('.routine-review-line').filter({hasText:'Mortgage'});
   await demoMortgage.waitFor();
   await demoMortgage.locator('[data-confirm-routine]').click();
   assert.equal(await page.locator('.routine-review-line').filter({hasText:'Mortgage'}).count(),0,
    'Confirming a routine once removes its repeated confirmation prompts');
   assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('household-planner-sample-settings-v1')||'{}')
    ?.plannerRoutineDecisions?.['expense|Checking|mortgage']?.status==='confirmed'),
    'Confirm once survives a reload without storing bank facts');
   await page.reload({waitUntil:'load'});
   assert.equal(await page.locator('.routine-review-line').filter({hasText:'Mortgage'}).count(),0,
    'Confirmed recurring mortgage stays confirmed after page reload');
   await page.locator('#horizon').selectOption('30');
   assert.match(await page.locator('.chart-caption').innerText(),/projection/i);
   assert.match(await page.locator('[aria-label="Projected balance curve"] .section-title').innerText(),/30 days/);
   await page.locator('.account-tile').filter({hasText:'Rewards Visa'}).click();
   assert.match(await page.locator('.balance-main').innerText(),/\$810\.00/,'Credit card balance is shown as debt, not checking cash');
   assert.match(await page.locator('.hero-footnote').first().innerText(),/debt/);
   assert.equal(await page.locator('button[data-page=budgets]').count(),0,'No old spending tabs');
   assert.equal(await page.locator('main .budget-entry').count(),0,'No category budget UI');
   assert.deepEqual(errors,[],'No JavaScript exceptions on public Demo');
   if(mobile){
    const sizes=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,window:innerWidth}));
    assert.ok(sizes.scroll<=sizes.window+2,'Mobile planner does not overflow: '+JSON.stringify(sizes));
   }
   await context.close();
  }
  const privateUrl='http://127.0.0.1:'+privatePort;
  const empty=await chrome.newContext({httpCredentials:{username:'pilot',password:pass}});
  await empty.addInitScript(fixedDate);
  await empty.addInitScript(()=>localStorage.setItem('household-ledger-view-mode','real'));
  const emptyPage=await empty.newPage(),emptyErrors=[];emptyPage.on('pageerror',e=>emptyErrors.push(e.message));
  await emptyPage.goto(privateUrl,{waitUntil:'load'});
  await emptyPage.getByText('Real bank information is not available yet.').waitFor();
  assert.equal(await emptyPage.locator('#ledger-mode-switch').inputValue(),'real',
   'An unavailable Real bank does not switch itself to fictional Demo');
  assert.equal(await emptyPage.locator('.account-tile').count(),0,
   'Disconnected Real does not show a fabricated balance');
  assert.ok((await emptyPage.locator('a[href="/bank-connect"]').count())>0,
   'Bank connection workflow is preserved');
  assert.deepEqual(emptyErrors,[]);
  await empty.close();

  const account={id:'checking-real',name:'Household Checking',mask:'1842',type:'depository',
   subtype:'checking',itemId:'bank-1',current:5000,available:4800,balanceObservedAt:'2026-10-19T09:00:00Z'};
  const card={id:'credit-real',name:'Household Visa',mask:'6555',type:'credit',
   subtype:'credit card',itemId:'bank-1',current:1200,available:null,balanceObservedAt:'2026-10-19T09:00:00Z'};
  const mortgagePfc={primary:'LOAN_PAYMENTS',detailed:'LOAN_PAYMENTS_MORTGAGE_PAYMENT',confidence_level:'HIGH'};
  const dates=['2026-06-02','2026-07-02','2026-08-02','2026-09-02','2026-10-02'];
  const transactions=dates.map((date,i)=>({id:'mort-'+i,accountId:'checking-real',
   date,name:'Home Mortgage ACH',merchant:'Home Mortgage ACH',amount:2590,pending:false,category:mortgagePfc}));
  transactions.push({id:'card-purchase',accountId:'credit-real',date:'2026-10-10',
   name:'Grocery Card Charge',merchant:'Grocery Card Charge',amount:300,pending:false,
   category:{primary:'FOOD_AND_DRINK',detailed:'FOOD_AND_DRINK_GROCERIES',confidence_level:'HIGH'}});
  const realPayload={connected:true,accounts:[account,card],account,lastSync:'2026-10-19T09:00:00Z',
   transactions,adjustments:{}};
  const real=await chrome.newContext({httpCredentials:{username:'pilot',password:pass},viewport:{width:1280,height:900}});
  await real.addInitScript(fixedDate);
  await real.addInitScript(()=>localStorage.setItem('household-ledger-view-mode','real'));
  const page=await real.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/ledger',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(realPayload)}));
  const writes=[];
  await page.route('**/api/ledger/adjustments',r=>{
   writes.push(r.request().postDataJSON());
   return r.fulfill({status:200,contentType:'application/json',body:'{"saved":true}'});
  });
  let refreshed=0;
  await page.route('**/api/sync',r=>{refreshed++;return r.fulfill({status:200,contentType:'application/json',body:'{"ok":true}'})});
  await page.goto(privateUrl,{waitUntil:'load'});
  await page.locator('#source-type').getByText('REAL BANK').waitFor();
  assert.equal(await page.locator('.account-tile').count(),2);
  assert.equal(await page.locator('.balance-main').innerText(),'$4,800.00',
   'Real checking starts at bank-reported available cash, not credit card debt');
  assert.match(await page.locator('[aria-label="Expected cash movements"]').innerText(),/Home Mortgage ACH/,
   'Real mortgage history produces future cash withdrawals');
  assert.ok(await page.locator('.payment-line').count()>=1);
  assert.match(await page.locator('[aria-label="Selected account projection"]').innerText(),/First projected shortfall/);
  const setMain=page.locator('[data-set-main="checking-real"]');
  if(await setMain.count())await setMain.click();
  assert.match(await page.locator('[aria-label="Selected account projection"]').innerText(),/MAIN ACCOUNT/,
   'The chosen checking account becomes the persistent primary focus');
  const confirmMortgage=page.locator('.routine-review-line').filter({hasText:'Home Mortgage ACH'});
  await confirmMortgage.locator('[data-confirm-routine]').click();
  assert.equal(await page.locator('.routine-review-line').filter({hasText:'Home Mortgage ACH'}).count(),0,
   'A repeated mortgage is confirmed once rather than every month');
  await page.locator('#card-autopay > summary').click();
  const cardForm=page.locator('[data-card-rule="credit-real"]');
  await cardForm.locator('[name=fromAccountId]').selectOption('checking-real');
  await cardForm.locator('[name=lastStatementClose]').fill('2026-10-18');
  await cardForm.locator('[name=lastStatementBalance]').fill('1200');
  await cardForm.locator('[name=nextPaymentDate]').fill('2026-11-11');
  await cardForm.locator('[name=nextDueDate]').fill('2026-11-12');
  await cardForm.locator('button[type=submit]').click();
  assert.match(await page.locator('[aria-label="Expected cash movements"]').innerText(),/Credit-card payment/,
   'A confirmed full-statement card payment is a dated checking withdrawal');
  for(let i=0;i<45&&!writes.some(x=>x.predictions?.paymentRules?.['credit-real']);i++)
   await new Promise(r=>setTimeout(r,80));
  assert.ok(writes.some(x=>x.predictions?.paymentRules?.['credit-real']?.fromAccountId==='checking-real'),
   'Card full-statement autopay setting persists through private adjustment API');
  assert.ok(writes.some(x=>x.predictions?.plannerRoutineDecisions?.['expense|checking-real|home mortgage ach']?.status==='confirmed'),
   'Confirmed mortgage schedule persists in private encrypted adjustments');
  await page.locator('.account-tile').filter({hasText:'Household Visa'}).click();
  assert.equal(await page.locator('.balance-main').innerText(),'$1,200.00',
   'Selecting a card switches to debt without reducing checking');
  await page.locator('.account-tile').filter({hasText:'Household Checking'}).click();
  assert.equal(await page.locator('.balance-main').innerText(),'$4,800.00',
   'Switching back preserves bank-reported checking');
  await page.locator('#refresh-bank').click();
  await page.waitForFunction(()=>document.querySelector('#source-type')?.textContent==='REAL BANK');
  assert.equal(refreshed,1,'Private Plaid refresh remains reachable');
  const storage=await page.evaluate(()=>({...localStorage}));
  assert.equal(Object.keys(storage).some(k=>JSON.stringify(storage[k]).includes('mort-4')),false,
   'Raw Real bank transactions are not written to localStorage');
  assert.deepEqual(errors,[]);
  await real.close();
  console.log('PASS compact planner in desktop Chromium and iPhone WebKit: Demo, Real no-fallback, Real Plaid-shaped balances, mortgage future cash, card debt, 30/90 horizon, refresh, privacy, mobile layout');
 }finally{
  if(chrome)await chrome.close();if(iphone)await iphone.close();
  for(const child of children)child.kill('SIGTERM');
  fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1});