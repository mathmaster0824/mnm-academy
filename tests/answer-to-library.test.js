/* 질문 답변 → 학습보관함 저장: 교재 출처가 완성된 질문의 답변 사진을 보관함에도 저장, 같은 문제를 또 물으면 자동 답변. Playwright + 메모리 Firestore 가짜. 운영 접속 없음. */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(ok); console.log(`ANS-LIB ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; const dialogs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  await page.evaluate(() => {
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'director' };
    db.students = [{ id: 'stu_A', name: '가짜A', code: '1', status: 'active', grade: '중1' }, { id: 'stu_B', name: '가짜B', code: '2', status: 'active', grade: '중1' }];
    db.solutionPhotos = [];
    const src = (page, no) => { const o = { sourceType: 'TEXTBOOK', sourceCourseId: 'course1', sourceBook: '쎈', sourcePage: page, sourceProblemNo: no }; o.sourceBookKey = sourceBookKey(o.sourceCourseId, o.sourceBook); o.sourcePageKey = sourcePageNorm(page); o.sourceProblemNoKey = sourceProblemNorm(no); o.sourceKey = textbookSourceKey(o.sourceCourseId, o.sourceBook, page, no); return o; };
    const P = (k) => ({ storageKey: k, url: 'https://x/' + k, contentType: 'image/jpeg' });
    const qs = [
      { id: 'q1', studentId: 'stu_A', date: '2026-11-05', text: '쎈 41쪽 7번', status: '대기', answerText: '', photos: [], answerPhotos: [P('ans1'), P('ans2')], ...src('41', '7') },
      { id: 'q2', studentId: 'stu_A', date: '2026-11-05', text: '쎈 42쪽 3번', status: '대기', answerText: '', photos: [], answerPhotos: [P('ans3')], ...src('42', '3') },
      { id: 'q3', studentId: 'stu_A', date: '2026-11-05', text: '쎈 43쪽 1번(텍스트만)', status: '대기', answerText: '', photos: [], answerPhotos: [], ...src('43', '1') },
      { id: 'q4', studentId: 'stu_A', date: '2026-11-05', text: '출처 없는 질문', status: '대기', answerText: '', photos: [], answerPhotos: [P('ans4')], sourceType: 'OTHER' },
      { id: 'q5', studentId: 'stu_B', date: '2026-11-05', text: '쎈 44쪽 5번(이미 보관함에 있음)', status: '대기', answerText: '', photos: [], answerPhotos: [P('lib1'), P('new5')], ...src('44', '5') },
    ];
    window.__store.questions = Object.fromEntries(qs.map((q) => [q.id, JSON.parse(JSON.stringify(q))])); db.questions = qs;
    // 보관함에 44쪽 5번 풀이 lib1 이 이미 있음
    const s5 = src('44', '5'); const lib = { id: 'sol_pre', photo: P('lib1'), courseId: 'course1', book: '쎈', page: '44', problemNo: '5', sourceKey: s5.sourceKey };
    db.solutionPhotos = [lib]; window.__store.solutionPhotos = { sol_pre: { ...lib } };
    currentSubState = {}; window.render = () => { document.getElementById('mainArea').innerHTML = renderQnaDirector(); }; window.render();
  });
  check('교재 출처가 완성된 질문 카드에만 "학습보관함에도 저장" 체크박스(기본 체크), 출처 없는 질문엔 없음', (await page.locator('[data-qna-savelib]').count()) === 4 && (await page.locator('#ansSaveLib_q1').isChecked()) && (await page.locator('#ansSaveLib_q4').count()) === 0);
  await page.evaluate(() => answerQuestion('q1')); await page.waitForTimeout(400);
  let lib = await page.evaluate(() => Object.values(window.__store.solutionPhotos));
  const q1 = await page.evaluate(() => db.solutionPhotos.filter((p) => p.fromQuestionId === 'q1'));
  check('답변 등록 시 답변 사진 2장이 학습보관함(solutionPhotos)에 저장(출처 4항목 + 원 질문 표시)', lib.filter((x) => x.fromQuestionId === 'q1').length === 2 && lib.every((x) => !x.fromQuestionId || (x.sourceKey && x.courseId === 'course1' && x.book === '쎈' && x.page === '41' && x.problemNo === '7' && x.photo)) && q1.length === 2, JSON.stringify(lib));
  check('저장 알림: 사진 2장 저장 + 같은 문제를 또 물으면 자동 답변', dialogs.some((d) => d.includes('2장') && d.includes('자동으로 답변')), dialogs.join('|'));
  // 같은 문제를 다른 학생이 물으면 자동 답변
  const auto = await page.evaluate(async () => { const s = readNewQuestionSource ? null : null; const key = textbookSourceKey('course1', '쎈', '41', '7'); const r = await findExactSolutionPhotosForQuestion({ sourceType: 'TEXTBOOK', sourceKey: key }); return r.photos.length; });
  check('같은 문제(쎈 41쪽 7번)를 다른 학생이 질문하면 보관함에서 2장이 자동 연결', auto === 2, auto + '');
  // 체크 해제
  dialogs.length = 0;
  await page.evaluate(() => { document.getElementById('ansSaveLib_q2').checked = false; return answerQuestion('q2'); }); await page.waitForTimeout(300);
  check('체크를 풀고 답변하면 보관함에 저장 안 함(질문 답변은 정상 등록)', (await page.evaluate(() => Object.values(window.__store.solutionPhotos).filter((x) => x.fromQuestionId === 'q2').length)) === 0 && (await page.evaluate(() => window.__store.questions.q2.status)) === '답변완료' && dialogs.length === 0);
  // 사진 없이 글만
  await page.evaluate(() => { document.getElementById('ans_q3').value = '글로만 설명'; return answerQuestion('q3'); }); await page.waitForTimeout(300);
  check('사진 없이 글만 답변하면 보관함 저장 없음(알림도 없음)', (await page.evaluate(() => Object.values(window.__store.solutionPhotos).filter((x) => x.fromQuestionId === 'q3').length)) === 0 && dialogs.length === 0);
  // 이미 보관함에 있는 사진은 중복 저장 안 함
  await page.evaluate(() => answerQuestion('q5')); await page.waitForTimeout(400);
  const q5 = await page.evaluate(() => Object.values(window.__store.solutionPhotos).filter((x) => x.sourceKey === textbookSourceKey('course1', '쎈', '44', '5')));
  check('이미 보관함에 있는 사진(lib1)은 건너뛰고 새 사진(new5)만 추가 → 총 2장', q5.length === 2 && q5.filter((x) => x.fromQuestionId === 'q5').length === 1 && dialogs.some((d) => d.includes('1장')), JSON.stringify(q5.map((x) => x.photo && x.photo.storageKey)));
  // 같은 답변을 다시 등록해도 중복 없음
  await page.evaluate(() => answerQuestion('q5')); await page.waitForTimeout(300);
  check('같은 답변을 다시 등록해도 보관함에 중복 저장되지 않음', (await page.evaluate(() => Object.values(window.__store.solutionPhotos).filter((x) => x.sourceKey === textbookSourceKey('course1', '쎈', '44', '5')).length)) === 2);
  // 출처 없는 질문(q4): 답변은 되지만 보관함 저장 없음
  await page.evaluate(() => answerQuestion('q4')); await page.waitForTimeout(300);
  check('출처 없는 질문은 보관함에 저장하지 않음', (await page.evaluate(() => Object.values(window.__store.solutionPhotos).filter((x) => x.fromQuestionId === 'q4').length)) === 0 && (await page.evaluate(() => window.__store.questions.q4.status)) === '답변완료');
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter((x) => !x).length;
  console.log(f ? `ANS-LIB FAIL ${f}/${results.length}` : `ANS-LIB OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
