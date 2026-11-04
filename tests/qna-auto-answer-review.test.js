/* 질문 게시판: 학습보관함 자동답변 확인 탭·배지·"확인했어요"·대시보드 카드 시험. Playwright + 메모리 Firestore 가짜(가짜 학생·질문). */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(ok); console.log(`QNA-AUTO ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'director' };
    db.students = [{ id: 'stu_A', name: '가짜A', code: '1', status: 'active', grade: '중1' }, { id: 'stu_B', name: '가짜B', code: '2', status: 'active', grade: '중1' }];
    const AUTO = '학습보관함에서 출처가 정확히 일치하는 풀이를 연결했어요.';
    const qs = [
      { id: 'q1', studentId: 'stu_A', date: '2026-11-03', text: '쎈 41쪽 7번', status: '답변완료', answerText: AUTO, answerPhotos: [], photos: [] },
      { id: 'q2', studentId: 'stu_B', date: '2026-11-03', text: '개념 질문', status: '대기', answerText: '', photos: [] },
      { id: 'q3', studentId: 'stu_A', date: '2026-11-02', text: '원장 직접 답변', status: '답변완료', answerText: '이렇게 푸세요', photos: [] },
      { id: 'q4', studentId: 'stu_B', date: '2026-11-01', text: '이미 확인한 자동답변', status: '답변완료', answerText: AUTO, autoAnswerSeen: true, photos: [] },
      { id: 'q5', studentId: 'stu_B', date: '2026-11-03', text: '쎈 50쪽 3번', status: '답변완료', answerText: AUTO, photos: [] },
    ];
    db.questions = qs; window.__store.questions = Object.fromEntries(qs.map((q) => [q.id, JSON.parse(JSON.stringify(q))]));
    currentSubState = {};
    window.render = () => { document.getElementById('mainArea').innerHTML = window.__page === 'dash' ? renderDashboard() : renderQnaDirector(); };
    window.__page = 'qna'; window.render();
  });
  const names = () => page.evaluate(() => [...document.querySelectorAll('#mainArea .card')].map((c) => c.querySelector('div b')?.textContent + ':' + (c.innerText.match(/쎈 \d+쪽 \d번|개념 질문|원장 직접 답변|이미 확인한 자동답변/) || [''])[0]));
  check('탭에 자동답변 확인 건수(2건) 표시', (await page.locator('[data-qna-tab="auto"]').innerText()).includes('(2)'));
  await page.locator('[data-qna-tab="auto"]').click();
  let n = await names();
  check('자동답변 탭: 확인 전 자동답변 2건만(직접 답변·대기·이미 확인한 건 제외)', n.length === 2 && n.some((x) => x.includes('쎈 41쪽')) && n.some((x) => x.includes('쎈 50쪽')), JSON.stringify(n));
  check('각 카드에 🤖 자동답변 배지와 확인했어요 버튼', (await page.locator('[data-qna-auto]').count()) === 2 && (await page.locator('[data-qna-seen]').count()) === 2);
  await page.locator('[data-qna-seen="q1"]').click(); await page.waitForTimeout(250);
  const st = await page.evaluate(() => window.__store.questions.q1);
  check('확인했어요: 표시만 저장되고 질문·답변 내용은 그대로', st.autoAnswerSeen === true && !!st.autoAnswerSeenAt && st.text === '쎈 41쪽 7번' && st.status === '답변완료' && st.answerText.startsWith('학습보관함'), JSON.stringify(st));
  n = await names();
  check('확인한 질문은 목록에서 빠지고 탭 건수 1건', n.length === 1 && n[0].includes('쎈 50쪽') && (await page.locator('[data-qna-tab="auto"]').innerText()).includes('(1)'));
  await page.evaluate(() => { currentSubState.qnaFilter = 'all'; window.render(); });
  check('전체 탭에서 확인한 자동답변은 "확인함" 회색 배지, 직접 답변엔 자동답변 배지 없음', (await page.locator('[data-qna-auto="q1"]').innerText()).includes('확인함') && (await page.locator('[data-qna-auto="q3"]').count()) === 0);
  await page.evaluate(() => { window.__page = 'dash'; try { window.render(); } catch (e) { window.__err = String(e); } });
  const hasCard = await page.locator('[data-dash-auto]').count();
  check('대시보드에 "자동답변 확인 전 1" 카드', hasCard === 1 && (await page.locator('[data-dash-auto]').innerText()).includes('1'), await page.evaluate(() => window.__err || ''));
  await page.evaluate(() => { window.__page = 'qna'; currentSubState.qnaFilter = 'auto'; window.render(); });
  await page.locator('[data-qna-allseen]').click(); await page.waitForTimeout(300);
  const all = await page.evaluate(() => Object.values(window.__store.questions).filter((q) => q.autoAnswerSeen).map((q) => q.id).sort());
  check('모두 확인했어요: 자동답변 3건(q1,q4,q5) 표시, 직접 답변·대기는 건드리지 않음', JSON.stringify(all) === JSON.stringify(['q1', 'q4', 'q5']), JSON.stringify(all));
  check('다 확인하면 탭 건수 사라지고 대시보드 카드도 사라짐', !(await page.locator('[data-qna-tab="auto"]').innerText()).includes('(') && await page.evaluate(() => { window.__page = 'dash'; window.render(); return document.querySelectorAll('[data-dash-auto]').length === 0; }));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `QNA-AUTO FAIL ${f}/${results.length}` : `QNA-AUTO OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
