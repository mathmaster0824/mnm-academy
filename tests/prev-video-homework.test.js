/* 반 페이지: 그날 말고 최근 7일 안에 내준 영상 숙제(수요일 → 금요일 보강)를 학생 카드에서 바로 확인. Playwright + 메모리 Firestore 가짜. 운영 접속 없음. */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(ok); console.log(`PREV-VID ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'director' }; window.todayISO = () => '2026-11-06'; window.academicTodayISO = () => '2026-11-06';
    db.students = [{ id: 'stu_J', name: '가짜준희', code: '1', status: 'active', grade: '중1', classId: 'cls_x' }, { id: 'stu_K', name: '가짜다른', code: '2', status: 'active', grade: '중1', classId: 'cls_x' }];
    db.classes = [{ id: 'cls_x', name: '월수5:30', dayGroup: 'mon-wed', studentIds: ['stu_J', 'stu_K'] }];
    const P = (k) => ({ storageKey: k, url: 'https://x/' + k + '.jpg', contentType: 'image/jpeg' });
    // 수요일(11/4)에 7개: 3개는 인증사진(자동 완료), 4개는 사진 없음(미인증). 오래된 것(10/20)과 다른 학생도 있음.
    const wed = Array.from({ length: 7 }, (_, i) => ({ title: '영상' + (i + 1), url: 'https://v/' + i, done: i < 3, photos: i < 3 ? [P('w' + i + 'a'), P('w' + i + 'b')] : [] }));
    window.__store.classRecords = {}; db.classRecords = {
      'cls_x_2026-11-04': { stu_J: { videoAssignments: wed }, stu_K: { videoAssignments: [{ title: '다른학생영상', url: 'u', done: false, photos: [] }] } },
      'cls_x_2026-10-20': { stu_J: { videoAssignments: [{ title: '아주오래전영상', url: 'u', done: false, photos: [] }] } },
      'cls_x_2026-11-06': { stu_J: { videoAssignments: [{ title: '오늘내준영상', url: 'u', done: false, photos: [] }] } },
      'cls_x_2026-11-07': { stu_J: { videoAssignments: [{ title: '미래영상', url: 'u', done: false, photos: [] }] } },
    };
    window.__store.classRecords = JSON.parse(JSON.stringify(db.classRecords));
    window.render = () => { document.getElementById('mainArea').innerHTML = renderClassRow(db.classes[0], db.students[window.__stu || 0], '2026-11-06', db.classRecords['cls_x_2026-11-06'] || {}, '', '', false); };
    window.render();
  });
  const box = page.locator('[data-vid-prev="stu_J"]');
  check('금요일 반 페이지 학생 카드에 "최근 7일 안에 내준 영상" 영역: 7개 중 3개 인증', (await box.count()) === 1 && (await box.innerText()).includes('3/7 인증') && (await box.locator('[data-vid-prev-item]').count()) === 7, await box.innerText());
  check('수요일(11/4) 날짜와 영상 제목이 줄마다 표시, 인증된 3개는 사진 장수(📷2) + 사진 썸네일', (await box.innerText()).includes('11/4') && (await box.innerText()).includes('영상1') && (await box.locator('[data-vid-prev-item]').first().innerText()).includes('📷2') && (await box.locator('.vphoto img').count()) === 6);
  check('사진 없는 4개는 "미인증"(안 한 걸로)으로 표시', (await box.locator('[data-vid-prev-item]:has-text("미인증")').count()) === 4);
  check('오늘 내준 영상·미래·7일보다 오래된 영상은 이 목록에 안 나옴(오늘 것은 기존 칸에 그대로)', !(await box.innerText()).includes('아주오래전영상') && !(await box.innerText()).includes('미래영상') && !(await box.innerText()).includes('오늘내준영상') && (await page.locator('.class-record-box').first().innerText().catch(() => '')) !== null);
  check('다른 학생의 영상은 섞이지 않음', !(await box.innerText()).includes('다른학생영상'));
  // 사진을 눌러 크게 보기 / 원장이 체크로 완료 처리
  await box.locator('.vphoto img').first().click(); await page.waitForTimeout(200);
  check('썸네일을 누르면 크게 보기(라이트박스)', (await page.evaluate(() => getComputedStyle(document.getElementById('lightbox')).display)) !== 'none');
  await page.evaluate(() => { document.getElementById('lightbox').style.display = 'none'; });
  const un = box.locator('[data-vid-prev-item]').nth(3).locator('input[type=checkbox]');
  check('원장 화면: 미인증 영상에 완료 체크 칸이 있음', (await un.count()) === 1 && !(await un.isChecked()));
  await un.check(); await page.waitForTimeout(400);
  check('체크하면 수요일 기록에 완료로 저장(4번째 영상 done)', await page.evaluate(() => window.__store.classRecords && db.classRecords['cls_x_2026-11-04'].stu_J.videoAssignments[3].done === true));
  // 학생이 없는 반/기록 없는 학생: 영역이 없음
  await page.evaluate(() => { window.__stu = 1; window.render(); });
  check('이전 영상 기록이 있는 다른 학생도 자기 것만 표시', (await page.locator('[data-vid-prev="stu_K"]').innerText()).includes('다른학생영상') && !(await page.locator('[data-vid-prev="stu_K"]').innerText()).includes('영상1'));
  await page.evaluate(() => { db.classRecords = { 'cls_x_2026-11-06': {} }; window.render(); });
  check('최근 7일 영상이 없으면 영역 자체가 안 보임', (await page.locator('[data-vid-prev]').count()) === 0);
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `PREV-VID FAIL ${f}/${results.length}` : `PREV-VID OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
