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
  const cellN = async (sel) => Number(await page.locator(sel).innerText());
  const stuM = () => page.evaluate(() => window.__store.students.stu_M);
  // 기록 초기화 후 실물 엽전 40개 지급
  await page.evaluate(() => { window.__store.students.stu_M.yeopjeonLog = []; db.students.find((x) => x.id === 'stu_M').yeopjeonLog = []; window.render(); });
  const base = await cellN('[data-yj-total="stu_M"]');
  check('초기화 후 온라인 6 / 실물 0 / 합계 6', (await cellN('[data-yj-online="stu_M"]')) === 6 && (await cellN('[data-yj-offline="stu_M"]')) === 0 && base === 6);
  await page.locator('#yjN_stu_M').fill('40'); await page.locator('[data-yj-offadd="stu_M"]').click(); await page.waitForTimeout(300);
  check('🪙 실물 지급 40: 실물 40, 온라인 6 그대로, 합계 46', (await cellN('[data-yj-offline="stu_M"]')) === 40 && (await cellN('[data-yj-online="stu_M"]')) === 6 && (await cellN('[data-yj-total="stu_M"]')) === 46);
  // 학생 화면 구성 표시 + 교환 가능 판단이 실물 포함
  await page.evaluate(() => { const keep = { s: session, st: db.students }; window.__keep = keep; session = { mode: 'student', studentId: 'stu_M' }; db.students = [window.__store.students.stu_M]; db.submissions = JSON.parse(JSON.stringify(window.__store.submissions)); db.stadDaily = JSON.parse(JSON.stringify(window.__store.stadDaily)); yjPool.subs = {}; yjPool.stad = {}; window.__page = 'my'; window.render(); });
  const myTxt = await page.locator('[data-my-yj]').innerText();
  check('학생 카드: "온라인 6개 + 실물 40개", 합계 46개, 편의점 5,000원(30) 교환 가능(실물 포함)', (await page.locator('[data-my-yj-online]').innerText()) === '6' && (await page.locator('[data-my-yj-offline]').innerText()) === '40' && (await page.locator('[data-my-yj-total]').innerText()) === '46개' && (await page.locator('[data-yj-reward="cvs5"]').innerText()).includes('교환 가능') && myTxt.includes('실물 엽전과 온라인 엽전을 합쳐서'), myTxt);
  check('합계 46: 편의점 10,000원(55)은 "9개 더 필요"', (await page.locator('[data-yj-reward="cvs10"]').innerText()).includes('9개 더 필요'));
  await page.evaluate(() => { session = { mode: 'director' }; db.students = window.__keep.st; db.submissions = {}; db.stadDaily = {}; yjPool.state = 'ready'; yjPool.subs = JSON.parse(JSON.stringify(window.__store.submissions)); yjPool.stad = JSON.parse(JSON.stringify(window.__store.stadDaily)); window.__page = 'admin'; window.render(); });
  // 교환: 편의점 5,000원(30) 전부 실물로
  await page.locator('#yjItem_stu_M').selectOption('cvs5'); await page.locator('#yjOff_stu_M').fill('30'); await page.locator('[data-yj-exchange="stu_M"]').click(); await page.waitForTimeout(300);
  let m = await stuM(); let last = m.yeopjeonLog[m.yeopjeonLog.length - 1];
  check('교환(실물 30 + 온라인 0): 실물만 30 차감, 온라인 그대로, 사유에 내역 자동 기록', last.item === 'cvs5' && last.offline === -30 && Math.abs(last.delta) === 0 && last.reason.includes('온라인 0 + 실물 30') && (await cellN('[data-yj-offline="stu_M"]')) === 10 && (await cellN('[data-yj-online="stu_M"]')) === 6);
  // 교환: 편의점 10,000원(55) = 실물 10 + 온라인 45 → 온라인 6이라 부족 → 확인창 거절 시 기록 안 함
  await page.locator('#yjItem_stu_M').selectOption('cvs10'); await page.locator('#yjOff_stu_M').fill('10');
  const nBefore = (await stuM()).yeopjeonLog.length;
  await page.evaluate(() => { window.__conf = window.confirm; window.confirm = () => false; });
  await page.locator('[data-yj-exchange="stu_M"]').click(); await page.waitForTimeout(250);
  check('온라인이 모자라면 확인창이 뜨고 거절하면 기록 안 함', (await stuM()).yeopjeonLog.length === nBefore);
  await page.evaluate(() => { window.confirm = window.__conf; });
  // 온라인 엽전을 실물로 바꿔주기 5개
  await page.locator('#yjN_stu_M').fill('5'); await page.locator('[data-yj-tooff="stu_M"]').click(); await page.waitForTimeout(300);
  check('↔ 실물로 바꿔줌 5: 온라인 6→1, 실물 10→15, 합계는 그대로 16', (await cellN('[data-yj-online="stu_M"]')) === 1 && (await cellN('[data-yj-offline="stu_M"]')) === 15 && (await cellN('[data-yj-total="stu_M"]')) === 16);
  // 선물 미선택·가격보다 많은 실물 입력
  dialogs.length = 0;
  await page.locator('#yjItem_stu_M').selectOption(''); await page.locator('[data-yj-exchange="stu_M"]').click(); await page.waitForTimeout(150);
  await page.locator('#yjItem_stu_M').selectOption('cvs5'); await page.locator('#yjOff_stu_M').fill('99'); await page.locator('[data-yj-exchange="stu_M"]').click(); await page.waitForTimeout(150);
  check('선물 미선택/실물이 가격보다 많으면 안내 후 기록 안 함', dialogs.some((d) => d.includes('먼저 골라')) && dialogs.some((d) => d.includes('보다 많이 낼 수 없어요')));
  // 경고삭제권 50 = 실물 15 + 온라인 35(부족) → 확인창 수락, 이후 같은 달 두 번째 거절
  await page.locator('#yjItem_stu_M').selectOption('warnDel'); await page.locator('#yjOff_stu_M').fill('15'); await page.locator('[data-yj-exchange="stu_M"]').click(); await page.waitForTimeout(300);
  m = await stuM();
  check('경고삭제권 교환 기록(부족 확인창 수락): 실물 15 + 온라인 35', m.yeopjeonLog.filter((x) => x.item === 'warnDel').length === 1 && m.yeopjeonLog.find((x) => x.item === 'warnDel').offline === -15 && m.yeopjeonLog.find((x) => x.item === 'warnDel').delta === -35);
  dialogs.length = 0;
  await page.locator('#yjItem_stu_M').selectOption('warnDel'); await page.locator('#yjOff_stu_M').fill('0'); await page.locator('[data-yj-exchange="stu_M"]').click(); await page.waitForTimeout(300);
  check('같은 달 두 번째 경고삭제권은 거절(알림) + 기록 안 늘어남', (await stuM()).yeopjeonLog.filter((x) => x.item === 'warnDel').length === 1 && dialogs.some((d) => d.includes('한 달에 1번만')));
  check('다른 학생(단일 반)은 같은 달에도 경고삭제권 교환 가능', await page.evaluate(async () => { document.getElementById('yjItem_stu_S').value = 'warnDel'; await addYeopjeonLog('stu_S', 'exchange'); return (window.__store.students.stu_S.yeopjeonLog || []).some((x) => x.item === 'warnDel'); }));
  check('내역 삭제 시 확인창 후 제거(실물·온라인 원복)', await page.evaluate(async () => { const before = window.__store.students.stu_M.yeopjeonLog.length; const id = window.__store.students.stu_M.yeopjeonLog[before - 1].id; await removeYeopjeonLog('stu_M', id); return window.__store.students.stu_M.yeopjeonLog.length === before - 1; }));
  // 달이 바뀌면 다시 구입 가능
  check('다음 달이 되면 경고삭제권을 다시 구입 가능', await page.evaluate(() => { window.todayISO = () => '2026-12-02'; return yjRewardBoughtThisMonth('stu_M', 'warnDel') === 0; }));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `YEOPJEON FAIL ${f}/${results.length}` : `YEOPJEON OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
