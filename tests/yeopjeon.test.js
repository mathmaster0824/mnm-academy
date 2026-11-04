/* 엽전: 수업 숙제 엽전(반 페이지 버튼) + STAD 자동 적립 + 원장 수기 기록/교환, 학생 화면. Playwright + 메모리 Firestore 가짜(가짜 학생·기록). 운영 접속 없음. */
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
    // 숙제가 인정돼 있어도 엽전은 자동으로 쌓이지 않는다(원장님이 반 페이지에서 직접 누른다)
    const S = (id, cls, date, status) => ({ studentId: id, classId: cls, date, status });
    const subs = { 'stu_M_2026-11-05': S('stu_M', 'cls_x', '2026-11-05', '확인'), 'stu_M_2026-11-06': S('stu_M', 'cls_x', '2026-11-06', '확인'), 'stu_S_2026-11-05': S('stu_S', 'cls_x', '2026-11-05', '확인') };
    const stad = { 'stu_M_2026-11-05': { studentId: 'stu_M', date: '2026-11-05', attended: true, settlementSubmittedAt: 'x' }, 'stu_M_2026-11-06': { studentId: 'stu_M', date: '2026-11-06', attended: true }, 'stu_M_2026-11-02': { studentId: 'stu_M', date: '2026-11-02', attended: true } };
    window.__store.submissions = JSON.parse(JSON.stringify(subs)); window.__store.stadDaily = JSON.parse(JSON.stringify(stad));
    window.__store.students = Object.fromEntries(db.students.map((s) => [s.id, JSON.parse(JSON.stringify(s))]));
    db.submissions = JSON.parse(JSON.stringify(subs)); db.stadDaily = {};
    window.render = () => { document.getElementById('mainArea').innerHTML = window.__page === 'my' ? renderMyYeopjeon('stu_M') : window.__page === 'row' ? renderClassRow(db.classes[0], db.students[0], '2026-11-09', {}, '', '', false) : renderYeopjeonAdmin(); };
    window.__page = 'admin'; window.render();
  });
  await page.waitForFunction(() => yjPool.state === 'ready'); await page.waitForTimeout(100);
  const cell = (id, i) => page.locator(`tr[data-yj-row="${id}"] td`).nth(i).innerText();
  const cellN = async (sel) => Number(await page.locator(sel).innerText());
  const stuM = () => page.evaluate(() => window.__store.students.stu_M);
  const logs = async () => ((await stuM()).yeopjeonLog || []);
  // ---- 자동 적립은 STAD만 ----
  check('숙제가 인정돼 있어도 엽전 자동 적립 없음, STAD도 정산 전에는 0(대기 3: 아침 2 + 저녁 1, 시작 전 11/2 제외)', (await cell('stu_M', 1)).trim() === '0' && (await page.locator('[data-yj-stad-pending="stu_M"]').innerText()).includes('정산 대기 3') && (await cellN('[data-yj-total="stu_M"]')) === 0 && (await cellN('[data-yj-total="stu_S"]')) === 0);
  // ---- 반 페이지 "엽전 +1" 버튼 ----
  await page.evaluate(() => { window.__page = 'row'; window.render(); });
  const btn = page.locator('[data-yj-class="stu_M"]');
  check('반 페이지: 숙제 현황 아래에 "🪙 엽전 +1" 버튼(아직 안 줌)', (await btn.count()) === 1 && (await btn.innerText()).includes('엽전 +1') && (await btn.getAttribute('data-given')) === '0');
  await btn.click(); await page.waitForTimeout(300);
  let lg = await logs();
  check('누르면 그 반·그 수업일로 1개 기록(kind:class), 버튼이 "지급됨"으로, 배지 합계 4', lg.length === 1 && lg[0].kind === 'class' && lg[0].clsId === 'cls_x' && lg[0].date === '2026-11-09' && lg[0].delta === 1 && (await btn.innerText()).includes('지급됨') && (await page.locator('[data-yj="stu_M"]').innerText()).includes('1'));
  await btn.click(); await page.waitForTimeout(300);
  check('지급됨 버튼을 다시 누르면(확인 후) 취소 — 같은 수업에 두 번 쌓이지 않음', (await logs()).length === 0 && (await btn.innerText()).includes('엽전 +1') && dialogs.some((d) => d.includes('취소할까요')));
  await btn.click(); await page.waitForTimeout(300);
  await page.evaluate(async () => { await toggleClassYeopjeon('cls_y', 'stu_M', '2026-11-09'); });
  check('다른 반(화목반) 수업은 따로 1개 더 — 반마다 1개', (await logs()).filter((x) => x.kind === 'class').length === 2);
  await page.evaluate(() => { session = { mode: 'student', studentId: 'stu_M' }; window.render(); });
  check('원장 전용: 학생 화면에는 버튼이 없음', (await page.locator('[data-yj-class]').count()) === 0);
  await page.evaluate(() => { session = { mode: 'director' }; window.__page = 'admin'; window.render(); });
  check('엽전 탭: 수업 숙제 2, STAD는 아직 대기라 합계 2', (await cell('stu_M', 1)).trim() === '2' && (await cellN('[data-yj-total="stu_M"]')) === 2);
  // ---- STAD 정산하기 (달 선택 → 확인 → 정산하기) ----
  check('정산 카드: 달 선택(2026-11), 학생별 횟수 확인 목록, 버튼 "2026-11 정산하기 (3개)"', (await page.locator('#yjStadMonth').inputValue()) === '2026-11' && (await page.locator('[data-yj-stad-list]').innerText()).includes('가짜복수 출석 2 · 정산 1 → +3') && (await page.locator('[data-yj-stad-all]').innerText()).includes('2026-11 정산하기 (3개)'));
  dialogs.length = 0;
  await page.locator('[data-yj-stad-all]').click(); await page.waitForTimeout(400);
  let sl = (await logs()).filter((x) => x.kind === 'stad');
  check('정산하기: 확인창 후 그 달 몫 3개가 한 번에(학생 1건) 기록, 합계 5, 대기 표시 사라짐, 다른 학생 기록 없음', dialogs.some((d) => d.includes('2026-11') && d.includes('3개')) && sl.length === 1 && sl[0].month === '2026-11' && sl[0].delta === 3 && (await cellN('[data-yj-total="stu_M"]')) === 5 && (await page.locator('[data-yj-stad-pending]').count()) === 0 && ((await page.evaluate(() => window.__store.students.stu_S.yeopjeonLog)) || []).length === 0);
  check('정산 후 버튼은 비활성, 다시 정산해도 중복 지급 없음', (await page.locator('[data-yj-stad-all]').isDisabled()) && (await page.evaluate(async () => { await settleStadYeopjeon('2026-11'); return window.__store.students.stu_M.yeopjeonLog.filter((x) => x.kind === 'stad').length; })) === 1);
  // ---- 수기 기록 ----
  await page.locator('#yjN_stu_M').fill('2'); await page.locator('#yjR_stu_M').fill('보너스');
  await page.locator('[data-yj-add="stu_M"]').click(); await page.waitForTimeout(300);
  let st = await stuM();
  check('＋ 지급 2개: students 문서에 수기 기록만 추가(다른 필드 그대로), 합계 7, 수기 +2', st.yeopjeonLog.length === 4 && st.yeopjeonLog[3].delta === 2 && st.yeopjeonLog[3].reason === '보너스' && st.name === '가짜복수' && (await cellN('[data-yj-total="stu_M"]')) === 7 && (await cell('stu_M', 3)).trim() === '+2');
  await page.locator('#yjN_stu_M').fill('3'); await page.locator('[data-yj-sub="stu_M"]').click(); await page.waitForTimeout(300);
  check('－ 차감 3개: 합계 4', (await cellN('[data-yj-total="stu_M"]')) === 4);
  await page.locator('#yjN_stu_M').fill('0'); await page.locator('[data-yj-add="stu_M"]').click(); await page.waitForTimeout(150);
  check('0개 입력은 저장하지 않음', (await logs()).length === 5);
  await page.locator('[data-yj-log]').first().locator('button').click(); await page.waitForTimeout(300);
  check('내역 삭제(확인 후): 4건 남고 합계 7로 되돌아감', (await logs()).length === 4 && (await cellN('[data-yj-total="stu_M"]')) === 7);
  // ---- 학생 화면 ----
  await page.evaluate(() => {
    session = { mode: 'student', studentId: 'stu_M' }; yjPool.stad = {};
    db.students = [window.__store.students.stu_M]; db.stadDaily = JSON.parse(JSON.stringify(window.__store.stadDaily)); window.__page = 'my'; window.render();
  });
  const mine = await page.locator('[data-my-yj]').innerText();
  check('학생 화면: 합계 7개(수업 숙제 2 + STAD 3 + 선생님 기록 +2)', (await page.locator('[data-my-yj-total]').innerText()) === '7개' && mine.includes('수업 숙제 2개') && mine.includes('STAD 3개') && mine.includes('+2'), mine);
  check('교환 안내 5종(가격)과 경고삭제권 월 1회 문구', (await page.locator('[data-yj-reward]').count()) === 5 && mine.includes('한 달에 1번만') && mine.includes('30개') && mine.includes('150개'));
  check('편의점 5,000원(30)은 "온라인 23개 부족 (실물과 합쳐서 가능)"', (await page.locator('[data-yj-reward="cvs5"]').innerText()).includes('온라인 23개 부족') && mine.includes('수업 때 숙제를 다 해 오면'), mine);
  await page.evaluate(() => { session = { mode: 'director' }; db.students = [JSON.parse(JSON.stringify(window.__store.students.stu_M)), JSON.parse(JSON.stringify(window.__store.students.stu_S))]; db.students.forEach((x) => { x.status = 'active'; }); yjPool.state = 'ready'; yjPool.stad = JSON.parse(JSON.stringify(window.__store.stadDaily)); db.stadDaily = {}; window.__page = 'admin'; window.render(); });
  check('원장 화면에 교환 안내(5종)와 학생별 선물 선택', (await page.locator('[data-yj-guide] [data-yj-reward]').count()) === 5 && (await page.locator('#yjItem_stu_M option').count()) === 6);
  // ---- 교환(학생이 낸 실물 + 온라인) : 기록 초기화 → 온라인 3(STAD) ----
  await page.evaluate(() => { window.__store.students.stu_M.yeopjeonLog = [{ id: 'base', date: '2026-11-09', at: '2026-11-09T00:00:00Z', delta: 3, reason: '시작' }]; db.students.find((x) => x.id === 'stu_M').yeopjeonLog = JSON.parse(JSON.stringify(window.__store.students.stu_M.yeopjeonLog)); window.render(); });
  check('초기화 후 온라인 3, 실물 칸/🪙 실물 지급 버튼 없음', (await cellN('[data-yj-total="stu_M"]')) === 3 && (await page.locator('[data-yj-offline],[data-yj-offadd]').count()) === 0);
  dialogs.length = 0;
  await page.locator('#yjItem_stu_M').selectOption('cvs5'); await page.locator('#yjOff_stu_M').fill('30'); await page.locator('[data-yj-exchange="stu_M"]').click(); await page.waitForTimeout(300);
  let last = (await logs()).slice(-1)[0];
  check('교환(실물 30 + 온라인 0): 온라인 그대로, offlineUsed 30, 실물 보유 확인창 없음', last.item === 'cvs5' && last.offlineUsed === 30 && Math.abs(last.delta) === 0 && last.reason.includes('온라인 0 + 실물 30') && (await cellN('[data-yj-total="stu_M"]')) === 3 && !dialogs.some((d) => d.includes('실물')));
  await page.locator('#yjItem_stu_M').selectOption('cvs10'); await page.locator('#yjOff_stu_M').fill('10');
  const nBefore = (await logs()).length;
  await page.evaluate(() => { window.__conf = window.confirm; window.confirm = () => false; });
  await page.locator('[data-yj-exchange="stu_M"]').click(); await page.waitForTimeout(250);
  check('온라인이 모자라면 확인창이 뜨고 거절하면 기록 안 함', (await logs()).length === nBefore);
  await page.evaluate(() => { window.confirm = window.__conf; });
  await page.locator('#yjN_stu_M').fill('1'); await page.locator('[data-yj-tooff="stu_M"]').click(); await page.waitForTimeout(300);
  check('↔ 실물로 바꿔줌 1: 온라인 3→2', (await cellN('[data-yj-total="stu_M"]')) === 2);
  await page.locator('#yjItem_stu_M').selectOption('cvs5'); await page.locator('#yjOff_stu_M').fill('28'); await page.locator('[data-yj-exchange="stu_M"]').click(); await page.waitForTimeout(300);
  last = (await logs()).slice(-1)[0];
  check('실물 28 + 온라인 2: delta -2, 온라인 2→0', last.delta === -2 && last.offlineUsed === 28 && (await cellN('[data-yj-total="stu_M"]')) === 0);
  dialogs.length = 0;
  await page.locator('#yjItem_stu_M').selectOption(''); await page.locator('[data-yj-exchange="stu_M"]').click(); await page.waitForTimeout(150);
  await page.locator('#yjItem_stu_M').selectOption('cvs5'); await page.locator('#yjOff_stu_M').fill('99'); await page.locator('[data-yj-exchange="stu_M"]').click(); await page.waitForTimeout(150);
  check('선물 미선택/실물이 가격보다 많으면 안내 후 기록 안 함', dialogs.some((d) => d.includes('먼저 골라')) && dialogs.some((d) => d.includes('보다 많이 낼 수 없어요')));
  await page.locator('#yjItem_stu_M').selectOption('warnDel'); await page.locator('#yjOff_stu_M').fill('15'); await page.locator('[data-yj-exchange="stu_M"]').click(); await page.waitForTimeout(300);
  check('경고삭제권 교환(부족 확인창 수락): 실물 15 + 온라인 35', (await logs()).filter((x) => x.item === 'warnDel').length === 1 && (await logs()).find((x) => x.item === 'warnDel').offlineUsed === 15 && (await logs()).find((x) => x.item === 'warnDel').delta === -35);
  dialogs.length = 0;
  await page.locator('#yjItem_stu_M').selectOption('warnDel'); await page.locator('#yjOff_stu_M').fill('0'); await page.locator('[data-yj-exchange="stu_M"]').click(); await page.waitForTimeout(300);
  check('같은 달 두 번째 경고삭제권은 거절(알림) + 기록 안 늘어남', (await logs()).filter((x) => x.item === 'warnDel').length === 1 && dialogs.some((d) => d.includes('한 달에 1번만')));
  check('다른 학생은 같은 달에도 경고삭제권 교환 가능', await page.evaluate(async () => { document.getElementById('yjItem_stu_S').value = 'warnDel'; await addYeopjeonLog('stu_S', 'exchange'); return (window.__store.students.stu_S.yeopjeonLog || []).some((x) => x.item === 'warnDel'); }));
  check('다음 달이 되면 경고삭제권을 다시 구입 가능', await page.evaluate(() => { window.todayISO = () => '2026-12-02'; return yjRewardBoughtThisMonth('stu_M', 'warnDel') === 0; }));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `YEOPJEON FAIL ${f}/${results.length}` : `YEOPJEON OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
