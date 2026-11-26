/* 해설 보관함: 사진 클릭 확대·같은 문제 여러 장 넘겨보기·여러 장 동시 등록 (가짜 Firestore). 실행: node tests/solution-lightbox-multi.test.js */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(!!ok); console.log(`SOL-LB ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] }); const page = await browser.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route(/gstatic\.com\/firebasejs/, r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, r => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html')); await page.waitForTimeout(800);
  const r = await page.evaluate(async () => {
    const o = {};
    document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
    session = { mode: 'director' };
    db.courses = [{ id: 'cH', name: '[고등] 공수 1', steps: [{ name: 'Unit 1. 다항식' }] }];
    const mk = (id, no, at, photo) => ({ id, photo, courseId: 'cH', book: '마플시너지', bookKey: sourceBookKey('cH', '마플시너지'), unit: 'Unit 1. 다항식', page: '22', pageKey: sourcePageNorm('22'), problemNo: no, problemNoKey: sourceProblemNorm(no), sourceKey: textbookSourceKey('cH', '마플시너지', '22', no), uploadedAt: at });
    db.solutionPhotos = [mk('s2', '75', '2026-11-25T01:00:00Z', 'data:image/jpeg;base64,BBBB'), mk('s1', '75', '2026-11-25T00:00:00Z', 'data:image/jpeg;base64,AAAA'), mk('s3', '80', '2026-11-25T02:00:00Z', 'data:image/jpeg;base64,CCCC')];
    currentSubState = {}; window.syncSolutionPhotoToProblemRepo = async () => {};
    window.render = () => { document.getElementById('mainArea').innerHTML = renderSolutionLib(); }; render();
    // 1) 사진을 누르면 확대창이 뜬다
    const imgs = [...document.querySelectorAll('#solutionLibResults img')];
    o.imgCount = imgs.length;
    const first = imgs.find(i => /onclick/.test(i.outerHTML) && i.getAttribute('onclick').includes("'s2'"));
    first.click();
    o.lbOpen = document.getElementById('lightbox').style.display === 'flex';
    // 2) 같은 문제 2장이 등록 순서(s1→s2)로 묶여 있고, 누른 사진(s2)부터 시작
    o.counter = document.getElementById('lbCounter').textContent;
    o.order = lbArray.length === 2 && lbArray[0].endsWith('AAAA') && lbArray[1].endsWith('BBBB') && lbIndex === 1;
    // 3) 다른 문제(80번) 사진은 섞이지 않는다
    document.getElementById('lightbox').style.display = 'none';
    imgs.find(i => i.getAttribute('onclick').includes("'s3'")).click();
    o.single = lbArray.length === 1 && document.getElementById('lbCounter').textContent === '';
    // 4) 등록 칸이 여러 장 선택을 받는다 + 2장 동시 등록
    o.multiple = document.getElementById('spPhoto').multiple === true;
    window.storePhotoFile = async () => 'data:image/jpeg;base64,ZZ'; let saved = 0; window.fsSet = async () => { saved++; return true; };
    const dt = new DataTransfer(); for (const n of ['a.jpg', 'b.jpg']) dt.items.add(new File([new Uint8Array([1, 2, 3])], n, { type: 'image/jpeg' }));
    document.getElementById('spPhoto').files = dt.files; document.getElementById('spCourse').value = 'cH';
    const b = document.getElementById('spBook'); b.insertAdjacentHTML('beforeend', '<option value="마플시너지">마플시너지</option>'); b.value = '마플시너지';
    document.getElementById('spPage').value = '23'; document.getElementById('spProblem').value = '5';
    await addSolutionPhoto(); o.saved2 = saved === 2 && db.solutionPhotos.filter(x => x.problemNo === '5').length === 2;
    return o;
  });
  check('해설 사진을 누르면 확대창이 열림', r.lbOpen, JSON.stringify(r));
  check('같은 문제 2장이 등록순으로 묶이고 누른 사진부터 시작', r.order && r.counter === '2 / 2', JSON.stringify(r));
  check('다른 문제 사진은 섞이지 않음', r.single, JSON.stringify(r));
  check('등록 칸이 여러 장 선택 가능', r.multiple, '');
  check('2장을 한 번에 등록하면 둘 다 저장', r.saved2, JSON.stringify(r));
  check('브라우저 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter(x => !x).length; console.log(`SOL-LB SUMMARY total=${results.length} pass=${results.length - f} fail=${f}`); process.exit(f ? 1 : 0);
})();
