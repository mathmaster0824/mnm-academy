/* 엽전: 숙제 인정 1건당 1개 + STAD 자동 적립 + 원장 수기 기록, 학생 화면. Playwright + 메모리 Firestore 가짜(가짜 학생·기록). 운영 접속 없음. */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(ok); console.log(`YEOPJEON ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; const dialogs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'director' }; window.todayISO = () => '2026-11-09'; window.academicTodayISO = () => '2026-11-09';
    db.students = [{ id: 'stu_M', name: '가짜복수', code: '1', classId: 'cls_x', status: 'active', grade: '중1' }, { id: 'stu_S', name: '가짜단일', code: '2', classId: 'cls_x', status: 'active', grade: '중1' }];
    db.classes = [{ id: 'cls_x', name: '월수반', dayGroup: 'mon-wed', studentIds: ['stu_M', 'stu_S'] }, { id: 'cls_y', name: '화목반', dayGroup: 'tue-thu', studentIds: ['stu_M'] }];
    const S = (id, cls, date, status) => ({ studentId: id, classId: cls, date, status });
    const subs = {
      // 같은 날(11/5) 두 반 숙제 모두 인정 → 2개, 11/6 월수반만 인정 → 1개, 11/7 미인증 → 0, 11/3(시작 전) 인정 → 0, 11/8 검토대기 → 0
      'stu_M_2026-11-05': S('stu_M', 'cls_x', '2026-11-05', '확인'), 'stu_M_cls_y_2026-11-05': S('stu_M', 'cls_y', '2026-11-05', '확인'),
      'stu_M_2026-11-06': S('stu_M', 'cls_x', '2026-11-06', '확인'), 'stu_M_2026-11-07': S('stu_M', 'cls_x', '2026-11-07', '미인증'),
      'stu_M_2026-11-03': S('stu_M', 'cls_x', '2026-11-03', '확인'), 'stu_M_2026-11-08': S('stu_M', 'cls_x', '2026-11-08', '대기'),
      'stu_S_2026-11-05': S('stu_S', 'cls_x', '2026-11-05', '확인'),
    };
    const stad = { 'stu_M_2026-11-05': { studentId: 'stu_M', date: '2026-11-05', attended: true, settlementSubmittedAt: 'x' }, 'stu_M_2026-11-06': { studentId: 'stu_M', date: '2026-11-06', attended: true }, 'stu_M_2026-11-02': { studentId: 'stu_M', date: '2026-11-02', attended: true } };
    window.__store.submissions = JSON.parse(JSON.stringify(subs)); window.__store.stadDaily = JSON.parse(JSON.stringify(stad));
    window.__store.students = Object.fromEntries(db.students.map((s) => [s.id, JSON.parse(JSON.stringify(s))]));
    db.submissions = {}; db.stadDaily = {};     // 원장 화면은 최근 기록만 구독 → 나머지는 서버에서 따로 읽는다
    window.render = () => { document.getElementById('mainArea').innerHTML = window.__page === 'my' ? renderMyYeopjeon('stu_M') : window.__page === 'row' ? renderClassRow(db.classes[0], db.students[0], '2026-11-09', {}, '', '', false) : renderYeopjeonAdmin(); };
    window.__page = 'admin'; window.render();
  });
  await page.waitForFunction(() => yjPool.state === 'ready'); await page.waitForTimeout(100);
  const cell = (id, i) => page.locator(`tr[data-yj-row="${id}"] td`).nth(i).innerText();
  check('복수 반 학생: 같은 날 두 반 숙제 인정은 2개(반마다 1개) + 11/6 1개 = 숙제 3개', (await cell('stu_M', 1)).trim() === '3', await cell('stu_M', 1));
  check('미인증·검토대기·시작일(11/4) 이전 인정은 세지 않음', (await cell('stu_M', 1)).trim() === '3');
  check('STAD: 아침 2(11/5·11/6) + 저녁 1(11/5) = 3, 시작 전(11/2)은 제외', (await cell('stu_M', 2)).trim() === '3', await cell('stu_M', 2));
  check('합계 = 숙제 3 + STAD 3 = 6 (영상 숙제는 포함 안 함), 단일 반 학생은 1', (await page.locator('[data-yj-total="stu_M"]').innerText()) === '6' && (await page.locator('[data-yj-total="stu_S"]').innerText()) === '1');
  // 수기 기록
  await page.locator('#yjN_stu_M').fill('2'); await page.locator('#yjR_stu_M').fill('실물 보너스');
  await page.locator('[data-yj-add="stu_M"]').click(); await page.waitForTimeout(300);
  let st = await page.evaluate(() => window.__store.students.stu_M);
  check('＋ 지급 2개: students 문서에 수기 기록만 추가 저장(다른 필드 그대로)', (st.yeopjeonLog || []).length === 1 && st.yeopjeonLog[0].delta === 2 && st.yeopjeonLog[0].reason === '실물 보너스' && st.name === '가짜복수');
  check('합계가 8로 바뀌고 수기 +2 표시, 내역 목록에 나타남', (await page.locator('[data-yj-total="stu_M"]').innerText()) === '8' && (await page.locator('[data-yj-log]').count()) === 1);
  await page.locator('#yjN_stu_M').fill('3'); await page.locator('[data-yj-sub="stu_M"]').click(); await page.waitForTimeout(300);
  check('－ 사용 3개: 합계 5', (await page.locator('[data-yj-total="stu_M"]').innerText()) === '5');
  await page.locator('#yjN_stu_M').fill('0'); await page.locator('[data-yj-add="stu_M"]').click(); await page.waitForTimeout(150);
  check('0개 입력은 저장하지 않음', ((await page.evaluate(() => window.__store.students.stu_M.yeopjeonLog)) || []).length === 2);
  await page.locator('[data-yj-log]').first().locator('button').click(); await page.waitForTimeout(300);
  check('수기 기록 삭제(확인 후): 1건 남고 합계 되돌아감', ((await page.evaluate(() => window.__store.students.stu_M.yeopjeonLog)) || []).length === 1);
  // 인정 취소 → 엽전 감소 (원장이 미인증으로 바꾸면)
  await page.evaluate(() => { yjPool.subs['stu_M_2026-11-06'].status = '미인증'; window.render(); });
  check('숙제 인정이 취소(미인증)되면 그 엽전도 빠짐', (await cell('stu_M', 1)).trim() === '2');
  // 반 카드 배지
  await page.evaluate(() => { window.__page = 'row'; window.render(); });
  check('반 출석부 학생 카드에 🪙 합계 배지', (await page.locator('[data-yj="stu_M"]').count()) === 1 && (await page.locator('[data-yj="stu_M"]').innerText()).includes('🪙'));
  // 학생 화면(본인 데이터만)
  await page.evaluate(() => {
    session = { mode: 'student', studentId: 'stu_M' }; yjPool.subs = {}; yjPool.stad = {}; yjPool.state = 'idle';
    db.submissions = JSON.parse(JSON.stringify(window.__store.submissions)); db.submissions['stu_M_2026-11-06'].status = '확인';
    db.stadDaily = JSON.parse(JSON.stringify(window.__store.stadDaily)); db.students = [window.__store.students.stu_M];
    window.__page = 'my'; window.render();
  });
  const mine = await page.locator('[data-my-yj]').innerText();
  check('학생 화면 "내 엽전": 합계(숙제 3 + STAD 3 + 선생님 기록 +2 = 8)와 구성이 보임', (await page.locator('[data-my-yj-total]').innerText()) === '8개' && mine.includes('숙제 인정 3개') && mine.includes('STAD 3개') && mine.includes('+2'), mine);
  // ---- 교환 안내 / 경고삭제권 월 1회 ----
  check('학생 카드에 교환 안내 5종(가격 포함)과 경고삭제권 월 1회 문구, 진행 상태', (await page.locator('[data-yj-reward]').count()) === 5 && mine !== undefined && (await page.locator('[data-my-yj]').innerText()).includes('한 달에 1번만') && (await page.locator('[data-my-yj]').innerText()).includes('30개') && (await page.locator('[data-my-yj]').innerText()).includes('150개'));
  const st8 = await page.locator('[data-yj-reward="cvs5"]').innerText();
  check('합계 8개: 편의점 5,000원(30)까지 "22개 더 필요"', st8.includes('22개 더 필요'), st8);
  await page.evaluate(() => { session = { mode: 'director' }; db.students = [JSON.parse(JSON.stringify(window.__store.students.stu_M)), JSON.parse(JSON.stringify(window.__store.students.stu_S))]; db.students.forEach((x) => { x.status = 'active'; }); yjPool.state = 'ready'; yjPool.subs = JSON.parse(JSON.stringify(window.__store.submissions)); yjPool.stad = JSON.parse(JSON.stringify(window.__store.stadDaily)); db.submissions = {}; db.stadDaily = {}; window.__page = 'admin'; window.render(); });
  check('원장 화면에 교환 안내 카드(5종)와 학생별 상품 선택', (await page.locator('[data-yj-guide] [data-yj-reward]').count()) === 5 && (await page.locator('#yjItem_stu_M option').count()) === 6);
  const total0 = Number(await page.locator('[data-yj-total="stu_M"]').innerText());
  await page.locator('#yjItem_stu_M').selectOption('cvs5'); await page.locator('[data-yj-sub="stu_M"]').click(); await page.waitForTimeout(300);
  let stM = await page.evaluate(() => window.__store.students.stu_M);
  const last = stM.yeopjeonLog[stM.yeopjeonLog.length - 1];
  check('상품 선택 후 －: 편의점 5,000원 30개 차감 기록(개수·사유 자동, 부족분 확인창 통과)', last.delta === -30 && last.item === 'cvs5' && last.reason.includes('편의점') && Number(await page.locator('[data-yj-total="stu_M"]').innerText()) === total0 - 30, JSON.stringify(last));
  await page.locator('#yjItem_stu_M').selectOption('warnDel'); await page.locator('[data-yj-sub="stu_M"]').click(); await page.waitForTimeout(300);
  stM = await page.evaluate(() => window.__store.students.stu_M);
  check('경고삭제권 첫 구입은 기록됨(50개)', stM.yeopjeonLog.filter((x) => x.item === 'warnDel').length === 1 && stM.yeopjeonLog.find((x) => x.item === 'warnDel').delta === -50);
  dialogs.length = 0;
  await page.locator('#yjItem_stu_M').selectOption('warnDel'); await page.locator('[data-yj-sub="stu_M"]').click(); await page.waitForTimeout(300);
  stM = await page.evaluate(() => window.__store.students.stu_M);
  check('같은 달 두 번째 경고삭제권은 거절(알림) + 기록 안 늘어남', stM.yeopjeonLog.filter((x) => x.item === 'warnDel').length === 1 && dialogs.some((d) => d.includes('한 달에 1번만')), JSON.stringify(dialogs));
  check('다른 학생(단일 반)은 같은 달에도 경고삭제권 구입 가능', await page.evaluate(async () => { document.getElementById('yjItem_stu_S').value = 'warnDel'; const o = window.confirm; window.confirm = () => true; await addYeopjeonLog('stu_S', -1); window.confirm = o; return (window.__store.students.stu_S.yeopjeonLog || []).some((x) => x.item === 'warnDel'); }));
  check('엽전이 모자라도 확인창에서 허용하면 기록, 거절하면 기록 안 함', await page.evaluate(async () => { const before = (window.__store.students.stu_S.yeopjeonLog || []).length; document.getElementById('yjItem_stu_S').value = 'pizza'; const o = window.confirm; window.confirm = () => false; await addYeopjeonLog('stu_S', -1); window.confirm = o; return (window.__store.students.stu_S.yeopjeonLog || []).length === before; }));
  // 달이 바뀌면 다시 구입 가능
  check('다음 달이 되면 경고삭제권을 다시 구입 가능', await page.evaluate(() => { window.todayISO = () => '2026-12-02'; return yjRewardBoughtThisMonth('stu_M', 'warnDel') === 0; }));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `YEOPJEON FAIL ${f}/${results.length}` : `YEOPJEON OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
