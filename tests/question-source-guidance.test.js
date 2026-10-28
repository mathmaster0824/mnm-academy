/* 학생 질문의 미등록 교재 직접 입력과 보관함 확인 대기 안내 회귀 시험.
 * 메모리 Firestore 가짜만 사용하며 운영 데이터에 접속하지 않는다.
 * 실행: node tests/question-source-guidance.test.js */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.route(/firebasejs/, r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
    await page.route(/^https?:/, r => {
      if (r.request().url().includes('firebasejs')) return r.fallback();
      r.abort();
    });
    await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
    await page.waitForTimeout(500);

    const result = await page.evaluate(() => {
      const old = { session, state: currentSubState, courses: db.courses, progress: db.practiceProgress, questions: db.questions };
      const sid = 'question-guidance-student';
      session = { mode: 'student', studentId: sid };
      currentSubState = {};
      db.courses = [{ id: 'course-5-1', name: '초등 5-1학기', steps: [] }];
      db.practiceProgress = { [sid]: { tracks: [{ courseId: 'course-5-1', book: '쎈', done: false }] } };
      db.questions = [{ id: 'pending-q', studentId: sid, date: '2026-10-28', sourceType: 'TEXTBOOK', sourceCourseId: 'course-5-1', sourceBook: '수학 익힘책', sourcePage: '12', sourceProblemNo: '3', status: '대기', solutionLibraryLookupFailed: false, text: '질문' }];

      let html = renderQnaStudentSection(sid, false);
      const showsUnlistedOption = html.includes('목록에 없는 교재 (직접 입력)');
      const showsClearInstructions = html.includes('교재 목록에 없는 책은') && html.includes('선생님 확인 대기로 전달됩니다.');
      const showsPendingStatus = html.includes('선생님 확인 대기 중이에요.');

      setNewQSourceField(sid, 'sourceCourseId', 'course-5-1', false, 0);
      setNewQSourceField(sid, 'sourceBookNotListed', 'true', false, 0);
      setNewQSourceField(sid, 'sourceBook', '우리 교재', false, 0);
      setNewQSourceField(sid, 'sourcePage', '12', false, 0);
      setNewQSourceField(sid, 'sourceProblemNo', '3', false, 0);
      const submittedSource = readNewQuestionSource(sid, 0);
      const customBookSaved = submittedSource.sourceBook === '우리 교재' && submittedSource.sourceBookNotListed && submittedSource.sourceKey.includes('우리교재');

      session = old.session; currentSubState = old.state; db.courses = old.courses; db.practiceProgress = old.progress; db.questions = old.questions;
      return { showsUnlistedOption, showsClearInstructions, showsPendingStatus, customBookSaved };
    });

    Object.entries(result).forEach(([name, ok]) => console.log(`Q-SOURCE ${ok ? '✔' : '✖'} ${name}`));
    if (pageErrors.length) console.error('PAGE ERRORS:', pageErrors);
    if (Object.values(result).some(x => !x) || pageErrors.length) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exit(1); });
