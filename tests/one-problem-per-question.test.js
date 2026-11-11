/* 질문 1개 = 문제 1개 안내·차단 (가짜 Firestore). 실행: node tests/one-problem-per-question.test.js */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(!!ok); console.log(`ONE-Q ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = [], dialogs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => { dialogs.push(d.message()); d.accept(); });
  await page.route(/gstatic\.com\/firebasejs/, r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, r => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const o = {};
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    const bad = ['2,3', '2，3번', '2~5번', '2 ~ 5', '2 및 3', '2&3', '2/3', '2번 3번', '2번과 3번', '2와 3', '2;3'];
    const ok = ['7', '7번', '3-1', '필수 3', '041', '', '12', '대표 1', 'A-3'];
    o.bad = bad.filter(x => !hasMultipleProblemNumbers(x)); o.ok = ok.filter(x => hasMultipleProblemNumbers(x));
    const c = (db.courses || [])[0] || { id: 'course1' };
    db.students = [{ id: 's1', name: '학생', status: 'active', grade: '중2' }];
    session = { mode: 'student', studentId: 's1', student: db.students[0] }; currentSubState = {}; db.questions = [];
    questionDraftItems('s1');
    const d = questionDraftItems('s1');
    d[0].source = { sourceType: 'TEXTBOOK', sourceCourseId: c.id, sourceBook: '쎈', sourcePage: '104', sourceProblemNo: '2,3' }; d[0].text = '질문';
    document.getElementById('mainArea').innerHTML = renderQnaStudentSection('s1', false);
    const h = document.getElementById('mainArea').innerHTML;
    o.banner = /data-one-problem-notice/.test(h) && /질문 1개 = 문제 1개/.test(h) && /＋ 질문 추가/.test(h) && !/한 문제에 사진을 여러 장 첨부할 수 있어요/.test(h);
    o.photoHint = /사진은 이 문제 하나만/.test(h);
    const warn = document.querySelector('[data-multi-warn="0"]'); o.warnShown = warn && warn.style.display === 'block';
    // 실시간 경고: 입력 바꾸면 표시/숨김
    const inp = document.getElementById('newQProblemNo_0'); inp.value = '7'; checkMultiProblemNo(inp); o.warnHidden = warn.style.display === 'none';
    inp.value = '2~3'; checkMultiProblemNo(inp); o.warnAgain = warn.style.display === 'block';
    // 제출 차단
    let saved = 0; const origAdd = fsAdd; fsAdd = async () => { saved++; return 'x'; }; fsSet = async () => { saved++; return true; };
    readNewQuestionSource = () => ({ sourceType: 'TEXTBOOK', sourceCourseId: c.id, sourceBook: '쎈', sourcePage: '104', sourceProblemNo: '2,3', sourceKey: 'k' });
    let msg = ''; window.alert = m => { msg = m; };
    await submitQuestion('s1'); o.blocked = saved === 0 && /여러 문제/.test(msg) && /질문 추가/.test(msg);
    // 원장 화면 배지
    db.questions = [{ id: 'q1', studentId: 's1', date: '2026-11-11', text: 'x', status: '대기', photos: [], sourceType: 'TEXTBOOK', sourceCourseId: c.id, sourceBook: '일품', sourcePage: '104', sourceProblemNo: '2,3' },
      { id: 'q2', studentId: 's1', date: '2026-11-11', text: 'y', status: '대기', photos: [], sourceType: 'TEXTBOOK', sourceCourseId: c.id, sourceBook: '일품', sourcePage: '104', sourceProblemNo: '3' }];
    session = { mode: 'director' }; currentSubState = {};
    const dh = renderQnaDirector(); o.badgeCount = (dh.match(/data-multi-badge/g) || []).length;
    // 같은 페이지 다른 문제 추가
    session = { mode: 'student', studentId: 's1', student: db.students[0] }; currentSubState = {}; db.questions = [];
    const dd = questionDraftItems('s1');
    dd[0].source = { sourceType: 'TEXTBOOK', sourceCourseId: c.id, sourceBook: '쎈', sourcePage: '104', sourceProblemNo: '2', showAllCourses: true }; dd[0].text = '첫 질문';
    document.getElementById('mainArea').innerHTML = renderQnaStudentSection('s1', false);
    o.sameBtn = !!document.querySelector('[data-same-page-add="0"]');
    window.render = () => { document.getElementById('mainArea').innerHTML = renderQnaStudentSection('s1', false); };
    addSameSourceQuestionDraft('s1', 0);
    const d2 = questionDraftItems('s1');
    o.same = d2.length === 2 && d2[1].source.sourcePage === '104' && d2[1].source.sourceBook === '쎈' && d2[1].source.sourceCourseId === c.id && d2[1].source.sourceProblemNo === '' && d2[1].text === '' && d2[0].source.sourceProblemNo === '2' && d2[0].text === '첫 질문';
    o.sameRendered = document.getElementById('newQPage_1')?.value === '104' && document.getElementById('newQProblemNo_1')?.value === '';
    return o;
  });
  check('여러 문제 표기(쉼표·물결·및·& 등)는 모두 감지', r.bad.length === 0, r.bad.join(' | '));
  check('정상 번호(7, 7번, 3-1, 필수 3, 041 등)는 막지 않음', r.ok.length === 0, r.ok.join(' | '));
  check('학생 화면에 강한 안내문(질문 1개 = 문제 1개) 표시, 예전 "사진 여러 장" 문구 제거', r.banner);
  check('사진 안내 문구 표시', r.photoHint);
  check('문제번호에 여러 개 적으면 빨간 경고 표시', r.warnShown);
  check('번호를 고치면 경고가 사라지고 다시 쓰면 나타남(실시간)', r.warnHidden && r.warnAgain);
  check('여러 문제 번호로는 질문 등록이 차단되고 저장되지 않음', r.blocked);
  check('원장 화면: 묶음 질문에만 ⚠️ 배지(1건)', r.badgeCount === 1, r.badgeCount);
  check('각 질문 카드에 "같은 페이지 다른 문제 추가" 버튼', r.sameBtn);
  check('누르면 교재·페이지가 복사되고 문제번호만 빈 새 카드(기존 카드는 그대로)', r.same && r.sameRendered, JSON.stringify([r.same, r.sameRendered]));
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter(x => !x).length;
  console.log(f ? `ONE-Q FAIL ${f}/${results.length}` : `ONE-Q OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
