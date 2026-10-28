/* 숙제 타이머 제거 및 타이머 사진 첨부 회귀 시험.
 * 메모리 Firestore 가짜만 사용하고 운영 데이터에는 접속하지 않는다.
 * 실행: node tests/homework-timer-photo.test.js */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');

const results = [];
const check = (name, ok, detail) => {
  results.push(!!ok);
  console.log(`HW-TIMER-PHOTO ${ok ? '✔' : '✖'} ${name}${ok ? '' : ' ← ' + (detail || '')}`);
};

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
    await page.waitForTimeout(600);

    const result = await page.evaluate(async () => {
      const date = '2026-10-26';
      const sid = 'timer-photo-student';
      currentSubState = { subDate: date, _draftSub: null, _draftSubKey: null, subClassId: '' };
      db.submissions = {};
      homeworkUploadState.active = false;

      const html = renderSubmissionForm(sid, date, null);
      const newDraftHasNoTime = !Object.prototype.hasOwnProperty.call(currentSubState._draftSub, 'time');
      const draftHasTimerPhotos = Array.isArray(currentSubState._draftSub.timerPhotos);
      const hasCameraInput = html.includes("uploadSubPhoto(this,'timerPhotos')") && html.includes('capture="environment"');
      const hasGalleryInput = html.includes("uploadSubPhoto(this,'timerPhotos')") && html.includes('multiple');
      const timerMarkup = html.includes('타이머 사진');
      const timerControlsGone = !/swStart|swStop|swReset|stopwatch|swDisplay/.test(html) &&
        typeof window.swStart === 'undefined' && typeof window.swStop === 'undefined';

      const teacherHtml = renderSubmissionReadonly({
        time: '03:21',
        status: '제출완료',
        timerPhotos: [{ url: 'https://example.invalid/timer.jpg' }],
        hwPhotos: [],
        practicePhotos: [],
        reviewCount: 0
      }, sid, date);
      const teacherSeesTimerPhoto = teacherHtml.includes('타이머 사진') && teacherHtml.includes('timerPhotos');
      const legacyTimeHidden = !teacherHtml.includes('실측 시간') && !teacherHtml.includes('03:21');

      const saved = [];
      window.fsSet = async (collection, key, payload) => {
        saved.push({ collection, key, payload });
        return !Object.values(payload).some(value => value === undefined);
      };
      window.render = () => {};
      window.photoRefForFirestore = p => p;
      window.embeddedPhotoLimitExceeded = () => false;
      window.firestorePayloadSizeKB = () => 1;
      // 새 입력 화면에서 바로 제출하는 경우: 타이머 시간을 만들지 않아도 저장되어야 한다.
      currentSubState._draftSubKey = sid + '_' + date;
      await submitHomework(sid, date);
      const undefinedTimeSaved = saved[0]?.collection === 'submissions' &&
        !Object.prototype.hasOwnProperty.call(saved[0]?.payload || {}, 'time') &&
        !Object.values(saved[0]?.payload || {}).some(value => value === undefined);

      currentSubState._draftSubKey = sid + '_' + date;
      currentSubState._draftSub = {
        time: '03:21', // 기존 임시 기록의 값은 지우지 않고 저장만 유지
        hwPhotos: [],
        practicePhotos: [],
        timerPhotos: [{ storageKey: 'private/timer-photo.jpg', clientFingerprint: 'local-fp' }],
        memo: ''
      };
      await submitHomework(sid, date);

      // 멈춘 사진 API 요청은 제한시간 후 압축 사진 대체 경로로 복구되어야 한다.
      const originalFetch = window.fetch;
      const originalSetTimeout = window.setTimeout;
      const originalPhotoApiToken = photoApiToken;
      const originalCompressor = fileToCompressedDataURL;
      const fallbackPhoto = 'data:image/jpeg;base64,dGVzdA==';
      let timeoutSignalObserved = false;
      let timeoutUploadRecovered = false;
      try {
        photoApiToken = async () => 'fake-token';
        fileToCompressedDataURL = async () => fallbackPhoto;
        window.fetch = (_url, options) => new Promise((_resolve, reject) => {
          timeoutSignalObserved = options.signal instanceof AbortSignal;
          options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
        });
        // 테스트 시간을 줄이되 실제 업로드 코드가 설정한 20초 타이머만 즉시 울리게 한다.
        window.setTimeout = (callback, delay, ...args) =>
          originalSetTimeout(callback, delay === 20000 ? 0 : delay, ...args);
        currentSubState._draftSub = { hwPhotos: [], practicePhotos: [], timerPhotos: [], memo: '' };
        currentSubState._draftSubKey = sid + '_' + date;
        await uploadSubPhoto({
          files: [new File(['fake-image'], 'timeout-test.jpg', { type: 'image/jpeg', lastModified: 1 })],
          value: ''
        }, 'hwPhotos');
        timeoutUploadRecovered = !homeworkUploadState.active &&
          homeworkUploadState.done === 1 &&
          homeworkUploadState.failed === 0 &&
          currentSubState._draftSub.hwPhotos[0] === fallbackPhoto;
      } finally {
        window.fetch = originalFetch;
        window.setTimeout = originalSetTimeout;
        photoApiToken = originalPhotoApiToken;
        fileToCompressedDataURL = originalCompressor;
        homeworkUploadState.active = false;
      }

      return {
        newDraftHasNoTime, draftHasTimerPhotos, hasCameraInput, hasGalleryInput,
        timeoutSignalObserved, timeoutUploadRecovered,
        timerMarkup, timerControlsGone, teacherSeesTimerPhoto, legacyTimeHidden,
        undefinedTimeSaved,
        savedTimerPhoto: saved[1]?.payload?.timerPhotos?.[0]?.storageKey === 'private/timer-photo.jpg',
        legacyTimePreserved: saved[1]?.payload?.time === '03:21',
        saveCount: saved.length
      };
    });

    check('업로드 요청 시간 초과 시 사진 업로드 상태가 해제되고 압축 대체 저장으로 복구', result.timeoutSignalObserved && result.timeoutUploadRecovered, JSON.stringify(result));
    check('새 숙제 입력에는 분 단위 타이머 상태가 생기지 않음', result.newDraftHasNoTime && result.timerControlsGone, JSON.stringify(result));
    check('타이머 사진은 카메라와 갤러리에서 추가할 수 있음', result.timerMarkup && result.hasCameraInput && result.hasGalleryInput && result.draftHasTimerPhotos, JSON.stringify(result));
    check('시간 필드가 없는 새 숙제도 undefined 없이 저장됨', result.undefinedTimeSaved, JSON.stringify(result));
    check('제출 자료에 비공개 사진 참조가 저장됨', result.savedTimerPhoto && result.saveCount === 2, JSON.stringify(result));
    check('선생님 숙제 화면에서 타이머 사진을 볼 수 있고 구형 시간 수치는 숨김', result.teacherSeesTimerPhoto && result.legacyTimeHidden, JSON.stringify(result));
    check('기존 제출의 시간 필드는 재제출 때 덮어쓰거나 지우지 않음', result.legacyTimePreserved, JSON.stringify(result));
    check('브라우저 실행 중 자바스크립트 오류 없음', pageErrors.length === 0, pageErrors.join('; '));

    await page.close();
  } finally {
    await browser.close();
  }
  const failed = results.filter(x => !x).length;
  console.log(`HW-TIMER-PHOTO SUMMARY total=${results.length} pass=${results.length-failed} fail=${failed}`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
