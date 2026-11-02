/* 영상 숙제 필기/인증 사진(여러 장) 시험. 브라우저(Playwright) + 메모리 Firestore 가짜. 운영 Firebase/Worker 접속 없음, 가짜 학생·가짜 사진만.
 * 실행: node tests/video-homework-photos.test.js   종료 코드 0 = 통과. 운영 동작은 이 시험으로 확인되지 않는다. */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');
const results = [];
const check = (name, ok, detail) => { results.push(ok); console.log(`VIDPHOTO ${ok ? '✔' : '✖'} ${name}${ok ? '' : '  ← ' + (detail || '')}`); };
const KEY = 'cls_x_2026-10-26', SID = 'stu_A';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const dialogs = []; page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.fulfill({ contentType: 'application/javascript', body: STUB }));
  await page.route(/^https?:\/\/(?!file)/, (r) => { if (/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.waitForTimeout(800);

  const setup = async (mode) => {
    await page.evaluate(({ KEY, SID, mode }) => {
      document.getElementById('loginScreen').style.display = 'none'; document.getElementById('appShell').style.display = 'block';
      session = mode === 'student' ? { mode: 'student', studentId: SID } : { mode: 'director' };
      db.students = [{ id: SID, name: '가짜A', code: '1', classId: 'cls_x', status: 'active', grade: '중1' }];
      db.classes = [{ id: 'cls_x', name: 'X반', dayGroup: 'mon-wed', studentIds: [SID] }];
      const base = [{ title: '영상1', url: 'https://v/1', done: false }, { title: '영상2', url: 'https://v/2', done: true }];
      db.classRecords = { [KEY]: { [SID]: { videoAssignments: JSON.parse(JSON.stringify(base)) } } };
      window.__store.classRecords = { [KEY]: { [SID]: { videoAssignments: JSON.parse(JSON.stringify(base)) } } };
      window.__store.studentRecords = {};
      let n = 0;
      window.storePhotoFile = async () => ({ storageKey: 'k' + (++n), url: 'data:image/png;base64,iVBORw0KGgo=', contentType: 'image/png', size: 10 });
      window.deleteStoredPhoto = async (p) => { (window.__deleted = window.__deleted || []).push(p.storageKey); };
      window.render = () => { document.getElementById('mainArea').innerHTML = mode === 'student' ? renderStudentHomeworkPage() : renderStudentDetail(SID, true); };
      window.render();
    }, { KEY, SID, mode });
  };
  const vids = () => page.evaluate(([K, S]) => JSON.parse(JSON.stringify(window.__store.classRecords[K][S].videoAssignments)), [KEY, SID]);
  const copy = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__store.studentRecords)));
  const upload = async (idx, n) => {
    const files = Array.from({ length: n }, (_, i) => ({ name: `n${i}.png`, mimeType: 'image/png', buffer: PNG }));
    await page.locator(`input[type=file][onchange*="uploadVideoPhotos"][onchange*=",${idx})"]`).setInputFiles(files);
    await page.waitForTimeout(200);
  };

  // 1) 기존 기록(photos 없음)도 문제없이 보이고, 올리기 버튼이 있다
  await setup('student');
  check('기존 영상 과제(사진 필드 없음)도 화면에 나오고 올리기 버튼이 영상마다 있다', (await page.locator('label.vphoto-add').count()) === 2 && (await page.locator('#mainArea').innerText()).includes('영상1'));

  // 2) 여러 장 올리기 → 저장
  await upload(0, 3);
  let v = await vids();
  check('영상1에 3장 저장, 영상2는 그대로', (v[0].photos || []).length === 3 && !v[1].photos && v[0].done === true && v[1].done === true, JSON.stringify(v).slice(0, 200));
  check('학생이면 학생 사본(studentRecords)에도 사진이 저장됨', ((await copy())[`${KEY}_${SID}`]?.rec?.videoAssignments?.[0]?.photos || []).length === 3);
  check('썸네일 3개 표시', (await page.locator('.vphoto img').count()) === 3);

  // 3) 한 번 더 올리면 이어서 붙는다(덮어쓰기 아님)
  await upload(0, 2);
  v = await vids();
  check('추가로 2장 올리면 총 5장(덮어쓰지 않음)', v[0].photos.length === 5 && v[0].photos.map((p) => p.storageKey).join() === 'k1,k2,k3,k4,k5');

  // 4) 사진 올리면 자동 완료 / 사진 없으면 학생은 완료 불가
  check('3장 올린 영상1은 자동 완료', v[0].done === true);
  await setup('student');
  check('사진 없는 영상1은 미완료, 학생 체크박스는 잠김', (await vids())[0].done === false && (await page.locator('#mainArea input[type=checkbox][disabled]').count()) === 2);
  await page.evaluate(([K, S]) => toggleVideoDoneByKey(K, S, 0), [KEY, SID]);
  check('학생이 직접 체크 시도하면 거절(저장 안 됨)', (await vids())[0].done === false && dialogs.some((d) => d.includes('자동으로 완료')));
  await upload(0, 1);
  check('사진 1장 올리면 자동 완료 + 사본에도 done=true', (await vids())[0].done === true && (await copy())[`${KEY}_${SID}`].rec.videoAssignments[0].done === true);
  await page.locator('.vphoto-x').first().click(); await page.waitForTimeout(200);
  check('마지막 사진을 지우면 다시 미완료', (await vids())[0].done === false && ((await vids())[0].photos || []).length === 0);
  await setup('director');
  await page.evaluate(([K, S]) => toggleVideoDoneByKey(K, S, 0), [KEY, SID]);
  check('원장은 사진 없이도 직접 완료 처리 가능(예외 처리용)', (await vids())[0].done === true);

  // 5) 최대 10장 제한
  await setup('student');
  await upload(0, 6); await upload(0, 5);
  v = await vids();
  check('10장을 넘기면 거절하고 기존 6장 유지', v[0].photos.length === 6 && dialogs.some((d) => d.includes('최대 10장')), JSON.stringify(dialogs));

  // 6) 사진 지우기
  await page.evaluate(() => { window.__deleted = []; });
  await page.locator('.vphoto-x').first().click(); await page.waitForTimeout(200);
  v = await vids();
  check('× 로 한 장 지우면 5장, 저장소 삭제도 호출', v[0].photos.length === 5 && (await page.evaluate(() => window.__deleted)).length === 1);

  // 7) 업로드 중 목록이 바뀐 경우(순서가 바뀜) → 같은 영상(제목·주소)에 붙는다
  await setup('student');
  await page.evaluate(([K, S]) => {
    const o = window.storePhotoFile;
    window.storePhotoFile = async (...a) => { const r = await o(...a); const arr = db.classRecords[K][S].videoAssignments; db.classRecords[K][S].videoAssignments = [{ title: '새영상', url: 'https://v/n', done: false }, ...arr]; return r; };
  }, [KEY, SID]);
  await upload(0, 1);
  const fresh = await vids();
  check('업로드 중 목록 앞에 새 영상이 끼어도 사진은 원래 영상1에 붙는다', (fresh.find((x) => x.title === '영상1').photos || []).length === 1 && !(fresh.find((x) => x.title === '새영상') || {}).photos, JSON.stringify(fresh).slice(0, 300));

  // 8) 선생님/원장 화면: 보기만(올리기·지우기 없음), 사진 수와 라이트박스
  await setup('director');
  await page.evaluate(([K, S]) => { db.classRecords[K][S].videoAssignments[0].photos = [{ url: 'data:image/png;base64,iVBORw0KGgo=' }, { url: 'data:image/png;base64,iVBORw0KGgo=' }]; window.render(); }, [KEY, SID]);
  check('원장 화면: 썸네일 2개 보이고 올리기·지우기 버튼은 없음', (await page.locator('.vphoto img').count()) === 2 && (await page.locator('label.vphoto-add').count()) === 0 && (await page.locator('.vphoto-x').count()) === 0);
  await page.locator('.vphoto img').first().click();
  check('썸네일을 누르면 확대 보기(2장 중 1번째)', (await page.locator('#lbCounter').innerText()) === '1 / 2' && (await page.locator('#lightbox').evaluate((e) => getComputedStyle(e).display)) !== 'none');
  check('2장 이상이면 "모두 받기" 버튼 표시', (await page.locator('.vphoto-act button', { hasText: '모두 받기' }).count()) === 1);

  // 9) 선생님 출석부 행(renderClassRow): 사진 개수 표시 + 썸네일, 올리기 버튼 없음
  const rowHtml = await page.evaluate(([K, S]) => { const cls = db.classes[0], st = db.students[0]; const rec = db.classRecords[K]; return renderClassRow(cls, st, K.slice(-10), rec, '', '', false); }, [KEY, SID]);
  check('출석부 행: 📷2 표시, 썸네일 2개, 올리기 버튼 없음', rowHtml.includes('📷2') && (rowHtml.match(/class="vphoto"/g) || []).length === 2 && !rowHtml.includes('vphoto-add'));
  check('화면 오류(pageerror) 없음', errs.length === 0, errs.join(' | '));

  await browser.close();
  const fail = results.filter((x) => !x).length;
  console.log(fail ? `VIDPHOTO FAIL ${fail}/${results.length}` : `VIDPHOTO OK ${results.length}/${results.length}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
