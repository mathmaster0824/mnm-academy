/* 학생 숙제 제출에서 Firestore가 거부하는 undefined 필드와 재시도 보존을 확인한다.
 * 메모리 Firestore만 사용하며 운영 학생·자료에는 접속하지 않는다. */
const { chromium } = require('playwright');
const path = require('path');
const STUB = require('./helpers/firestore-stub.js');

const results = [];
const check = (name, ok, detail='') => {
  results.push(!!ok);
  console.log(`HW-SUBMIT ${ok ? '✔' : '✖'} ${name}${ok ? '' : ` ← ${detail}`}`);
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.accept());
    await page.route(/firebasejs/, r => r.fulfill({ contentType: 'application/javascript', body: STUB }));
    await page.route(/^https?:/, r => {
      if (r.request().url().includes('firebasejs')) return r.fallback();
      r.abort();
    });
    await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
    await page.waitForTimeout(500);

    const result = await page.evaluate(async () => {
      const sid='fake-homework-student', date='2026-10-28', key=`${sid}_${date}`;
      session={mode:'student',studentId:sid};
      currentSubState={_draftSubKey:key,_draftSub:null};
      db.students=[{id:sid,status:'active',classId:'fake-class'}];
      db.classes=[{id:'fake-class',studentIds:[sid],dayGroup:'mon-wed'}];
      db.submissions={};
      homeworkUploadState.active=false;
      window.render=()=>{};

      // Firestore 실제 동작을 흉내 내어 중첩 여부와 관계없이 undefined를 거부한다.
      const hasUndefined=(v)=>v===undefined || (Array.isArray(v)?v.some(hasUndefined):v&&typeof v==='object'?Object.values(v).some(hasUndefined):false);
      const baseCollection=fsdb.collection.bind(fsdb);
      fsdb.collection=(name)=>{
        const col=baseCollection(name), baseDoc=col.doc.bind(col);
        col.doc=(id)=>{
          const doc=baseDoc(id), baseSet=doc.set.bind(doc);
          doc.set=async(data,opts)=>{
            if(name==='submissions'&&hasUndefined(data)) throw Object.assign(new Error('Unsupported field value: undefined (found in field time)'),{code:'invalid-argument'});
            return baseSet(data,opts);
          };
          return doc;
        };
        return col;
      };

      currentSubState._draftSub={time:undefined,hwPhotos:[],practicePhotos:[],timerPhotos:[],memo:'새 숙제'};
      await submitHomework(sid,date);
      const first=window.__store.submissions[key];
      const firstSuccess=!!first && first.status==='제출완료' && !Object.prototype.hasOwnProperty.call(first,'time') && first.memo==='새 숙제';

      // 사진이 포함된 재제출에서도 예전 임시 time: undefined는 저장 문서로 넘어가면 안 된다.
      currentSubState._draftSubKey=key;
      currentSubState._draftSub={time:undefined,hwPhotos:[{storageKey:'fake/hw.jpg'}],practicePhotos:[],timerPhotos:[{storageKey:'fake/timer.jpg'}],memo:'사진 포함'};
      await submitHomework(sid,date);
      const second=window.__store.submissions[key];
      const resubmitSuccess=!!second && second.memo==='사진 포함' && !Object.prototype.hasOwnProperty.call(second,'time') &&
        second.hwPhotos?.[0]?.storageKey==='fake/hw.jpg' && second.timerPhotos?.[0]?.storageKey==='fake/timer.jpg';

      // 저장 실패 후 사진과 입력 초안이 유지되어야 다시 제출할 수 있다.
      let rejectNext=true;
      const oldCollection=fsdb.collection.bind(fsdb);
      fsdb.collection=(name)=>{
        const col=oldCollection(name), baseDoc=col.doc.bind(col);
        col.doc=(id)=>{const doc=baseDoc(id), baseSet=doc.set.bind(doc);doc.set=async(data,opts)=>{
          if(name==='submissions'&&rejectNext){rejectNext=false;throw Object.assign(new Error('offline'),{code:'unavailable'});}
          return baseSet(data,opts);
        };return doc;};return col;
      };
      currentSubState._draftSubKey=key;
      currentSubState._draftSub={time:undefined,hwPhotos:[{storageKey:'fake/kept.jpg'}],practicePhotos:[],timerPhotos:[],memo:'재시도'};
      saveDraftLocal(sid,date);
      await submitHomework(sid,date);
      const retainedAfterFailure=currentSubState._draftSub?.hwPhotos?.[0]?.storageKey==='fake/kept.jpg' && loadDraftLocal(sid,date)?.hwPhotos?.[0]?.storageKey==='fake/kept.jpg';
      await submitHomework(sid,date);
      const retrySuccess=window.__store.submissions[key]?.memo==='재시도' && window.__store.submissions[key]?.hwPhotos?.[0]?.storageKey==='fake/kept.jpg';
      return {firstSuccess,resubmitSuccess,retainedAfterFailure,retrySuccess,stored:window.__store.submissions[key]};
    });

    check('새 숙제 제출: time이 undefined여도 Firestore 저장 성공',result.firstSuccess,JSON.stringify(result));
    check('사진이 있는 재제출: 타이머 사진 포함, undefined time 없이 저장',result.resubmitSuccess,JSON.stringify(result));
    check('서버 저장 실패: 사진과 초안이 로컬에 보존됨',result.retainedAfterFailure,JSON.stringify(result));
    check('실패 뒤 다시 제출: 저장 성공하고 사진 유지',result.retrySuccess,JSON.stringify(result));
    check('실행 중 자바스크립트 오류 없음',errors.length===0,errors.join('; '));
    await page.close();
  } finally { await browser.close(); }
  const failed=results.filter(x=>!x).length;
  console.log(`HW-SUBMIT SUMMARY total=${results.length} pass=${results.length-failed} fail=${failed}`);
  process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
