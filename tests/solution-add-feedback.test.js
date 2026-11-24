/* 해설 보관함 등록: 성공/실패 안내·중복 클릭 방지 (가짜 Firestore). 실행: node tests/solution-add-feedback.test.js */
const { chromium } = require('playwright'); const path = require('path'); const STUB = require('./helpers/firestore-stub.js');
const results = []; const check = (n, ok, d) => { results.push(!!ok); console.log(`SOL-ADD ${ok ? '✔' : '✖'} ${n}${ok ? '' : '  ← ' + (d || '')}`); };
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
    db.courses = [{ id: 'cH', name: '[고등] 공수 1', steps: [{ name: 'Unit 1. 다항식' }] }]; db.solutionPhotos = [];
    currentSubState = {}; window.syncSolutionPhotoToProblemRepo = async () => {};
    const draw = () => { document.getElementById('mainArea').innerHTML = renderSolutionLib(); };
    window.render = draw; draw();
    let seq = 100; const fill = (pg = '22', no = String(seq++)) => {
      const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' })); document.getElementById('spPhoto').files = dt.files;
      document.getElementById('spCourse').value = 'cH';
      const b = document.getElementById('spBook'); if (![...b.options].some(x => x.value === '마플시너지')) b.insertAdjacentHTML('beforeend', '<option value="마플시너지">마플시너지</option>'); b.value = '마플시너지';
      document.getElementById('spPage').value = pg; document.getElementById('spProblem').value = no; window.__lastNo = no;
    };
    window.storePhotoFile = async () => 'data:image/jpeg;base64,AAAA';
    const toast = () => document.getElementById('spToast')?.textContent || '';
    // 1) 성공
    let saved = 0; window.fsSet = async () => { saved++; return true; };
    fill(); await addSolutionPhoto();
    o.okSaved = saved === 1 && db.solutionPhotos.length === 1; o.okToast = /✅.*마플시너지 22쪽 100번/.test(toast()); o.okCleared = document.getElementById('spPage').value === '';
    o.btnBack = document.querySelector('[data-sp-add]').disabled === false && /등록/.test(document.querySelector('[data-sp-add]').textContent);
    // 2) 저장 실패(false) → 실패 안내 + 입력값 유지
    window.fsSet = async () => false; document.getElementById('spToast')?.remove();
    fill(); await addSolutionPhoto();
    o.failToast = /저장하지 못했어요/.test(toast()); o.failKeep = document.getElementById('spPage').value === '22' && document.getElementById('spProblem').value === window.__lastNo && db.solutionPhotos.length === 1;
    // 3) 예외 → 안내
    window.fsSet = async () => { throw new Error('boom'); }; document.getElementById('spToast')?.remove(); window.alert = () => {};
    fill(); await addSolutionPhoto(); o.errToast = /등록하지 못했어요|저장하지 못했어요/.test(toast());
    o.btnAfterErr = document.querySelector('[data-sp-add]').disabled === false;
    // 4) 중복 클릭: 저장이 느리면 두 번째 클릭은 무시
    let n = 0; window.fsSet = async () => { n++; await new Promise(r => setTimeout(r, 200)); return true; };
    fill(); const p1 = addSolutionPhoto(); const p2 = addSolutionPhoto(); await Promise.all([p1, p2]);
    o.once = n === 1;
    // 5) 이미 같은 문제 해설이 있으면 선택창이 화면에 보이고, '그대로 두기'를 누르면 아무것도 저장 안 하고 끝남
    window.fsSet = async () => true; const before = db.solutionPhotos.length;
    fill('22', '100'); const pDup = addSolutionPhoto(); await new Promise(r => setTimeout(r, 150));
    const m = document.getElementById('solDupModal'); const rect = m && m.getBoundingClientRect();
    o.dupVisible = !!m && rect.width > 200 && rect.height > 200 && getComputedStyle(m).display === 'flex';
    o.dupBusy = document.querySelector('[data-sp-add]').disabled === true;
    m.querySelector('[data-sol-dup="keep"]').click(); await pDup;
    o.dupKeep = db.solutionPhotos.length === before && document.querySelector('[data-sp-add]').disabled === false;
    return o;
  });
  check('등록 성공: 저장되고 ✅ 안내가 뜨고 입력칸이 비워짐', r.okSaved && r.okToast && r.okCleared, JSON.stringify(r));
  check('등록 중 버튼이 다시 "+ 등록"으로 돌아옴', r.btnBack);
  check('저장 실패(false): 실패 안내가 뜨고 교재·페이지·번호 입력값 유지', r.failToast && r.failKeep, JSON.stringify([r.failToast, r.failKeep]));
  check('예외가 나도 안내가 뜨고 버튼이 다시 눌림', r.errToast && r.btnAfterErr);
  check('중복 클릭은 한 번만 저장', r.once);
  check('같은 문제 해설이 이미 있으면 선택창이 화면에 보임(등록 중 표시)', r.dupVisible && r.dupBusy, JSON.stringify([r.dupVisible, r.dupBusy]));
  check('선택창에서 "그대로 두기"를 누르면 저장 없이 끝나고 버튼이 다시 눌림', r.dupKeep);
  check('페이지 오류 없음', errs.length === 0, errs.join('|'));
  await browser.close(); const f = results.filter(x => !x).length;
  console.log(f ? `SOL-ADD FAIL ${f}/${results.length}` : `SOL-ADD OK ${results.length}/${results.length}`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
