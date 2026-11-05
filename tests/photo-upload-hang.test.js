/* 사진 업로드가 중간에 멈추지 않는지 확인 (가짜 Firestore/가짜 업로드). 실행: node tests/photo-upload-hang.test.js */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');
const results = [];
const check = (n, ok, d) => { results.push(!!ok); console.log(`PHOTO-HANG ${ok ? '✔' : '✖'} ${n}${ok ? '' : ' ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.route(/firebasejs/, r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
    await page.route(/^https?:/, r => { if (r.request().url().includes('firebasejs')) return r.fallback(); r.abort(); });
    await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
    await page.waitForTimeout(600);
    const r = await page.evaluate(async () => {
      const out = {};
      // withTimeout
      out.wtHang = await withTimeout(new Promise(() => {}), 50, 'x').then(() => 'ok', e => e.message);
      out.wtOk = await withTimeout(Promise.resolve(7), 50, 'x');
      // 업로드: 3번째 사진은 영영 안 끝나는 척
      UPLOAD_PHOTO_TIMEOUT_MS = 300;
      const origStore = storePhotoFile;
      storePhotoFile = (f) => f.name === 'hang.jpg' ? new Promise(() => {}) : f.name === 'bad.jpg' ? Promise.reject(new Error('x')) : Promise.resolve({ key: 'k-' + f.name, url: 'u-' + f.name });
      let alertMsg = '';
      window.alert = m => { alertMsg = m; };
      render = () => {};
      currentSubState = { subDate: '2026-11-06', _draftSub: { hwPhotos: [], practicePhotos: [], timerPhotos: [] }, _draftSubKey: null, subClassId: '' };
      homeworkUploadState.active = false;
      const mk = (n, i) => new File([new Uint8Array([i, i + 1, 9])], n, { type: 'image/jpeg', lastModified: 1000 + i });
      const input = { files: [mk('a.jpg', 1), mk('hang.jpg', 2), mk('bad.jpg', 3), mk('c.jpg', 4)], value: 'x' };
      const t0 = Date.now();
      await uploadSubPhoto(input, 'hwPhotos');
      out.ms = Date.now() - t0;
      out.active = homeworkUploadState.active;
      out.failed = homeworkUploadState.failed;
      out.done = homeworkUploadState.done;
      out.kept = currentSubState._draftSub.hwPhotos.length;
      out.alertMsg = alertMsg;
      storePhotoFile = origStore;
      return out;
    });
    check('시간 제한 함수가 멈춘 작업을 끊음', /timeout/.test(r.wtHang), r.wtHang);
    check('정상 작업은 그대로 통과', r.wtOk === 7);
    check('멈춘 사진이 있어도 업로드 전체가 끝남', r.ms < 3000 && r.active === false, JSON.stringify(r));
    check('진행 4/4, 실패 2장', r.done === 4 && r.failed === 2, JSON.stringify(r));
    check('성공한 2장은 보존', r.kept === 2, r.kept);
    check('실패 안내에 사진 번호·사유 표시', /2번째\(hang\.jpg\): 시간이/.test(r.alertMsg) && /3번째\(bad\.jpg\)/.test(r.alertMsg), r.alertMsg);
    check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  } finally { await browser.close(); }
  process.exit(results.every(Boolean) ? 0 : 1);
})();
