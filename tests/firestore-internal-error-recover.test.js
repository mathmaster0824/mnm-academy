/* Firestore 내부 오류(INTERNAL ASSERTION FAILED) 복구: 영어 오류 대신 안내 + 임시 사진 보존 + 새로고침. Playwright + 메모리 Firestore 가짜. 운영 접속 없음. */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(ok); console.log(`FS-RECOVER ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; const dialogs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'student', studentId: 'stu_A' };
    window.__reloads = 0; window.hardReload = () => { window.__reloads++; };
    // 임시 숙제 사진 17장(저장소 키만 있는 사진)을 작성 중인 상태
    const photos = Array.from({ length: 17 }, (_, i) => ({ key: 'photos/stu_A/' + i + '.jpg', clientFingerprint: 'f' + i }));
    currentSubState._draftSub = { hwPhotos: photos, practicePhotos: [], timerPhotos: [], memo: '' }; draftActiveStuId = 'stu_A'; draftActiveDate = '2026-11-04';
    // 서버 저장이 Firestore 내부 오류로 실패
    window.__origCol = fsdb.collection.bind(fsdb);
    fsdb.collection = (c) => ({ doc: () => ({ set: () => Promise.reject(new Error('FIRESTORE (10.13.2) INTERNAL ASSERTION FAILED: Unexpected state')), update: () => Promise.reject(new Error('Unexpected state')), delete: () => Promise.reject(new Error('INTERNAL ASSERTION FAILED')) }), add: () => Promise.reject(new Error('INTERNAL ASSERTION FAILED: Unexpected state')) });
  });
  const ok = await page.evaluate(() => fsSet('submissions', 'stu_A_2026-11-04', { studentId: 'stu_A' }));
  check('제출 저장 실패 시 false, 영어 오류 대신 한국어 복구 안내(사진 그대로·새로고침)', ok === false && dialogs.length === 1 && dialogs[0].includes('사진은 지워지지 않고') && dialogs[0].includes('새로고침') && !dialogs[0].includes('INTERNAL ASSERTION') && !dialogs[0].includes('오류 코드'), dialogs.join('|'));
  check('앱 새로고침이 실행됨', (await page.evaluate(() => window.__reloads)) === 1);
  check('임시 사진 17장이 기기에 저장돼 새로고침 뒤에도 남음', await page.evaluate(() => { const d = loadDraftLocal('stu_A', '2026-11-04'); return !!d && d.hwPhotos.length === 17; }));
  await page.evaluate(async () => { await fsAdd('x', {}); await fsDelete('x', 'y'); await fsUpdate('x', 'y', {}); });
  check('다른 저장(추가·삭제·수정)에서 같은 오류가 나도 같은 복구 안내(총 4번)와 새로고침', dialogs.length === 4 && (await page.evaluate(() => window.__reloads)) === 4, dialogs.length + '');
  dialogs.length = 0;
  await page.evaluate(() => { fsdb.collection = () => ({ doc: () => ({ set: () => Promise.reject(Object.assign(new Error('network'), { code: 'unavailable' })) }) }); });
  const ok2 = await page.evaluate(() => fsSet('submissions', 'stu_A_2026-11-04', { studentId: 'stu_A' }));
  check('다른 종류 오류(네트워크)는 기존 안내 그대로, 새로고침 안 함', ok2 === false && dialogs.length === 1 && dialogs[0].includes('서버 연결이 원활하지') && (await page.evaluate(() => window.__reloads)) === 4, dialogs.join('|'));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `FS-RECOVER FAIL ${f}/${results.length}` : `FS-RECOVER OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
