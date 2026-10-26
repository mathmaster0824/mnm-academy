/* 주말학습 원장 확인 주간 조회 회귀시험.
 * 메모리 Firestore 가짜만 사용하고 운영 학생 데이터에는 접속하지 않는다.
 * 실행: node tests/weekend-study-review.test.js */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');
const results = [];
const check = (name, ok, detail) => {
  results.push(!!ok);
  console.log('WEEKEND-STUDY ' + (ok ? '✔ ' : '✖ ') + name + (ok ? '' : ' ← ' + (detail || '')));
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route(/gstatic\.com\/firebasejs/, r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\//, r => {
    if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback();
    r.abort();
  });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const dateCases = {
      monday: weekendReviewWeekStart('2026-10-26'),
      friday: weekendReviewWeekStart('2026-10-30'),
      saturday: weekendReviewWeekStart('2026-10-24'),
      sunday: weekendReviewWeekStart('2026-10-25'),
      nextSaturday: weekendReviewWeekStart('2026-10-31')
    };

    session = { mode: 'director' };
    db.students = [{ id: 'fake-student', name: '가짜 학생', grade: '중1', status: 'active' }];
    db.weekendSettings = { enabled: true };
    db.weekendClasses = [{ id: 'fake-class', name: '가짜 중1반', studentIds: ['fake-student'] }];
    const original = {
      'fake-student_2026-10-19_sat_am': {
        studentId: 'fake-student', weekStart: '2026-10-19', slot: 'sat_am',
        photos: [{ storageKey: 'fake/weekend.jpg' }], submittedAt: '2026-10-24T08:00:00.000Z'
      }
    };
    window.__store.weekendSubmissions = JSON.parse(JSON.stringify(original));
    const before = JSON.stringify(window.__store.weekendSubmissions);
    const queries = [];
    const originalCollection = fsdb.collection.bind(fsdb);
    fsdb.collection = name => {
      if (name !== 'weekendSubmissions') return originalCollection(name);
      return {
        where: (field, op, value) => ({
          onSnapshot: (onNext, onError) => {
            queries.push({ field, op, value });
            const docs = Object.keys(window.__store.weekendSubmissions)
              .filter(id => op === '==' && window.__store.weekendSubmissions[id][field] === value)
              .map(id => ({ id, data: () => JSON.parse(JSON.stringify(window.__store.weekendSubmissions[id])) }));
            onNext({ docs });
            return () => {};
          }
        })
      };
    };

    currentSubState = {};
    clearWeekendAdminWeekListener();
    const defaultWeek = weekendReviewWeekStart('2026-10-26');
    subscribeWeekendAdminWeek(defaultWeek);
    const html = renderWeekendStudyAdmin();
    const shown = html.includes('○ 인증') && html.includes('가짜 학생');
    const correctPicker = html.includes('setWeekendAdminWeek(this.value)');
    const firstQuery = queries[0] || null;

    currentSubState.weekendWeek = '2026-10-26';
    subscribeWeekendAdminWeek(currentSubState.weekendWeek);
    const selectedWeekCount = Object.keys(db.weekendSubmissions).length;
    const secondQuery = queries[1] || null;
    const unchanged = JSON.stringify(window.__store.weekendSubmissions) === before;
    clearWeekendAdminWeekListener();
    return { dateCases, defaultWeek, shown, correctPicker, firstQuery, selectedWeekCount, secondQuery, unchanged };
  });

  check('월요일에는 지난 토·일 주간을 기본 선택해 직전 주말의 제출을 확인', result.dateCases.monday === '2026-10-19' && result.defaultWeek === '2026-10-19' && result.shown, JSON.stringify(result));
  check('화~금은 직전 주말, 토·일은 현재 주말을 선택', result.dateCases.friday === '2026-10-19' && result.dateCases.saturday === '2026-10-19' && result.dateCases.sunday === '2026-10-19' && result.dateCases.nextSaturday === '2026-10-26', JSON.stringify(result.dateCases));
  check('원장 주간 기록은 weekStart 정확 일치 조회를 사용하고 날짜 선택도 다시 조회', result.firstQuery?.field === 'weekStart' && result.firstQuery?.op === '==' && result.firstQuery?.value === '2026-10-19' && result.correctPicker && result.secondQuery?.value === '2026-10-26' && result.selectedWeekCount === 0, JSON.stringify(result));
  check('조회는 읽기 전용이며 가짜 원본 기록을 수정하지 않음', result.unchanged);
  check('브라우저 오류 없음', errors.length === 0, errors.join(' | '));

  await browser.close();
  const failed = results.filter(x => !x).length;
  console.log('WEEKEND-STUDY SUMMARY total=' + results.length + ' pass=' + (results.length - failed) + ' fail=' + failed);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('WEEKEND-STUDY SCRIPT ERROR', e); process.exit(1); });
