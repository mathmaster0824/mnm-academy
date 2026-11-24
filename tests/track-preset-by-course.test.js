/* 교재 묶음(회독)은 선택한 학년학기 과정의 학교급을 따른다. 실행: node tests/track-preset-by-course.test.js */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(!!ok); console.log(`TRACK-LV ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route(/gstatic\.com\/firebasejs/, r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, r => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const o = {};
    db.courses = [{ id: 'cH', name: '[고등] 공수 1', steps: [] }, { id: 'cM', name: '[중등] 중2-2학기', steps: [] }];
    db.students = [{ id: 'sM', name: '중3선행', grade: '중3', status: 'active' }, { id: 'sH', name: '고1', grade: '고1', status: 'active' }];
    currentSubState = { _newTrackDraft: {}, _addingTrack: {} };
    const html = (stu, course, cat) => { currentSubState._newTrackDraft = { [stu]: { courseId: course, category: cat } }; return renderAddTrackForm(stu); };
    // 중3 학생 + [고등] 공수1 → 고등 묶음(라쎈 2회독 + 마플시너지), 중등 묶음(익힘책) 없음
    let h = html('sM', 'cH', '2회독'); o.hi = /라쎈 2회독 \+ 마플시너지/.test(h) && !/익힘책/.test(h);
    // 고등 과정 선택 시 분류 버튼도 고등용(CODI/방학특강…)
    o.cats = /방학특강/.test(h) && !/심화회독/.test(h);
    // 과정 아직 안 고르면 학생 학년 기준(중3 → 중등)
    h = html('sM', '', ''); o.fallback = /익힘책/.test(h) || /1회독/.test(h);
    // 중3 학생 + [중등] 과정 → 중등 묶음
    h = html('sM', 'cM', '2회독'); o.mid = /익힘책 2회독 \+ 최상위라이트/.test(h) && /익힘책 2회독 \+ 일품/.test(h);
    // 이전에 중등 분류(심화회독)를 골라 둔 뒤 고등 과정으로 바꾸면 고등 첫 분류로 보정
    h = html('sM', 'cH', '심화회독'); o.fix = currentSubState._newTrackDraft.sM.category === 'CODI' || /CODI/.test(h);
    // 실제 등록: 고등 과정 + 2회독 → 라쎈 2회독, 마플시너지 두 권
    let saved = null; fsSet = async (c, id, d) => { saved = { c, id, d }; return true; }; window.render = () => {};
    currentSubState._newTrackDraft = { sM: { courseId: 'cH', category: '2회독' } }; db.practiceProgress = {};
    await confirmAddPresetBundle('sM', 0);
    o.saved = saved && saved.d.tracks.map(t => t.book).join('+');
    // 고1 학생은 그대로
    h = html('sH', 'cH', '2회독'); o.hs = /라쎈 2회독 \+ 마플시너지/.test(h);
    return o;
  });
  check('중3 학생이 [고등] 공수1을 고르면 고등 묶음(라쎈 2회독 + 마플시너지)만 나옴', r.hi);
  check('분류 버튼도 고등용(방학특강…)으로 바뀜', r.cats);
  check('과정을 아직 안 고르면 학생 학년 기준', r.fallback);
  check('[중등] 과정이면 중등 묶음(익힘책 2회독 + 최상위라이트/일품)', r.mid);
  check('중등 분류를 골라 둔 상태에서 고등 과정으로 바꿔도 분류 보정', r.fix);
  check('실제 등록되는 책이 라쎈 2회독 + 마플시너지', r.saved === '라쎈 2회독+마플시너지', r.saved);
  check('고1 학생 동작은 그대로', r.hs);
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter(x => !x).length;
  console.log(f ? `TRACK-LV FAIL ${f}/${results.length}` : `TRACK-LV OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
