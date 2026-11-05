/* 앱 시작 때 기기 캐시(IndexedDB) 열기가 멈춰도 로딩 화면에 갇히지 않고 다음 접속에서 캐시 없이 열리는지. Playwright + 메모리 Firestore 가짜. 운영 접속 없음. */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(ok); console.log(`BOOT-HANG ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const ctx = await browser.newContext(); const page = await ctx.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
  let mode = 'ok';
  const body = () => STUB.replace('enablePersistence:()=>Promise.resolve()', mode === 'hang' ? 'enablePersistence:()=>{window.__persistCalls=(window.__persistCalls||0)+1;return new Promise(()=>{});}' : 'enablePersistence:()=>{window.__persistCalls=(window.__persistCalls||0)+1;return Promise.resolve();}');
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: body() }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.addInitScript(() => { window.__idbDeleted = []; const o = indexedDB.deleteDatabase.bind(indexedDB); indexedDB.deleteDatabase = (n) => { window.__idbDeleted.push(n); return o(n); }; });
  const url = 'file://' + path.join(__dirname, '..', 'index.html');
  const calls = () => page.evaluate(() => window.__persistCalls || 0);
  // 1) 정상: 캐시를 열면 표시가 지워지고 캐시 사용
  await page.goto(url); await page.waitForTimeout(800);
  check('정상 접속: 캐시 사용(enablePersistence 호출) + 표시(mnm_fs_boot) 지워짐', (await calls()) === 1 && (await page.evaluate(() => localStorage.getItem('mnm_fs_boot'))) === null);
  // 2) 지난번에 열다 멈춤(표시가 20초 전) → 이번엔 캐시 없이 열고 꼬인 캐시 삭제 시도
  await page.evaluate(() => localStorage.setItem('mnm_fs_boot', String(Date.now() - 20000)));
  await page.reload(); await page.waitForTimeout(800);
  check('멈춘 흔적이 있으면 이번 접속은 캐시 없이 열림(enablePersistence 호출 없음) + 꼬인 캐시 삭제 시도 + 표시 정리', (await calls()) === 0 && (await page.evaluate(() => window.__idbDeleted.includes('firestore/[DEFAULT]/math-master-6a888/main'))) && (await page.evaluate(() => localStorage.getItem('mnm_fs_boot'))) === null);
  check('캐시 없이 열어도 시작 절차가 이어짐(캐시 준비 완료 처리, 오류 안내 없음)', await page.evaluate(async () => (await firestorePersistenceReady) === false && bootPersistDone === true && !document.getElementById('loadingScreen').innerText.includes('시간이 오래')));
  // 3) 방금 전(다른 탭이 여는 중) 표시는 무시하고 캐시 사용
  await page.evaluate(() => localStorage.setItem('mnm_fs_boot', String(Date.now() - 1000)));
  await page.reload(); await page.waitForTimeout(800);
  check('2초 안의 표시(다른 탭이 열던 중)는 멈춘 걸로 보지 않고 캐시 사용', (await calls()) === 1);
  // 4) 캐시 열기가 실제로 멈춤: 10초 뒤 안내 + 버튼, 버튼 누르면 다음 접속은 캐시 없이 열림
  mode = 'hang'; await page.evaluate(() => localStorage.removeItem('mnm_fs_boot'));
  await page.reload(); await page.waitForTimeout(1500);
  check('캐시 열기가 멈추면 처음엔 "불러오는 중" 화면', (await page.locator('#loadingScreen').innerText()).includes('불러오는 중'));
  await page.waitForTimeout(9500);
  const t = await page.locator('#loadingScreen').innerText();
  check('10초 뒤 로딩 화면에 안내문과 "다시 시도" 버튼(영원히 안 갇힘)', t.includes('시간이 오래 걸리고') && t.includes('다시 시도'), t);
  mode = 'ok';
  await page.locator('#loadingScreen button').click(); await page.waitForTimeout(1500);
  check('"다시 시도"로 새로고침하면 이번엔 캐시 없이 열려 시작 절차가 이어짐(오류 안내 사라짐)', (await calls()) === 0 && (await page.evaluate(() => bootPersistDone === true && !document.getElementById('loadingScreen').innerText.includes('시간이 오래'))));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `BOOT-HANG FAIL ${f}/${results.length}` : `BOOT-HANG OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
