const { chromium } = require('playwright');
(async()=>{
  const browser=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']}).catch(async()=>chromium.launch({args:['--no-sandbox']}));
  const page=await browser.newPage();
  const errs=[]; page.on('pageerror',e=>errs.push('PAGEERROR '+e.message)); page.on('console',m=>{ if(m.type()==='error') errs.push('CONSOLE '+m.text().slice(0,200)); });
  const stub=`(function(){const mk=()=>new Proxy(function(){},{get:(t,k)=>{ if(k==='then') return undefined; if(k===Symbol.toPrimitive) return ()=>''; return mk(); },apply:()=>mk()});
    window.firebase={initializeApp:()=>{},auth:()=>({onAuthStateChanged:()=>{},signInAnonymously:()=>Promise.resolve({})}),firestore:Object.assign(()=>({collection:()=>({onSnapshot:()=>()=>{},doc:()=>({get:()=>Promise.resolve({exists:false,data:()=>({})}),set:()=>Promise.resolve(),onSnapshot:()=>()=>{}}),where:function(){return this},get:()=>Promise.resolve({docs:[]}),limit:function(){return this}}),enablePersistence:()=>Promise.resolve(),settings:()=>{}}),{FieldPath:{documentId:()=>'__name__'},FieldValue:{serverTimestamp:()=>({}),delete:()=>({})}})};})();`;
  await page.route(/gstatic\.com\/firebasejs/,r=>r.fulfill({contentType:'application/javascript',body:stub}));
  await page.route(/^https?:\/\/(?!file)/,r=>{ if(/gstatic\.com\/firebasejs/.test(r.request().url())) return r.fallback(); r.abort(); });
  await page.goto('file://'+require('path').join(__dirname,'..','index.html'));
  await page.waitForTimeout(800);
  const out=await page.evaluate(()=>{
    const r={};
    try{
      db.courses=[{id:'c1',name:'중2-2',steps:[{id:'s1',name:'STEP 1 > 삼각형의 성질'}]}];
      db.students=[{id:'stu_a',name:'가',code:'1',grade:'중2',classId:'cls_x',status:'active'},{id:'stu_b',name:'나',code:'2',grade:'중2',classId:'cls_y',status:'active'}];
      db.classes=[{id:'cls_x',name:'X반',dayGroup:'월수',studentIds:['stu_a','stu_b']},{id:'cls_y',name:'Y반',dayGroup:'화목',studentIds:['stu_b']}];
      const wk=weekStartISO(todayISO());
      db.weeklyPlans={['cls_x_'+wk]:{stu_b:{mon:'X숙제',tue:'X화',wed:'X수',thu:'X목'}},['cls_y_'+wk]:{stu_b:{tue:'Y화',thu:'Y목'}}};
      db.classRecords={}; db.submissions={};
      session={mode:'student',studentId:'stu_b'};
      r.home=renderStudentHome().length;
      r.hw=renderStudentHomeworkPage().length;
      r.hwHasBoth=/X반/.test(renderStudentHomeworkPage())&&/Y반/.test(renderStudentHomeworkPage());
      currentSubState.subDate='2026-10-20'; db.weeklyPlans={['cls_x_2026-10-19']:{stu_b:{tue:'X화'}},['cls_y_2026-10-19']:{stu_b:{tue:'Y화'}}};
      let h=renderSubmissionCard('stu_b',false,false); r.cardPicker=/어느 반 숙제/.test(h); r.firstSlot=(h.match(/submitHomework\('([^']+)'/)||[])[1];
      currentSubState.subClassId='cls_x'; h=renderSubmissionCard('stu_b',false,false); r.secondSlot=(h.match(/submitHomework\('([^']+)'/)||[])[1];
      r.draftKey=currentSubState._draftSubKey;
      session={mode:'director'}; currentView='monthlyReport'; currentSubState={};
      r.monthly=renderMonthlyReports().length;
      const cls=db.classes[0], s=db.students[1], date=todayISO();
      r.row=renderClassRow(cls,s,date,{[s.id]:{stepId:'__etc__',lessonDetail:'외심<script>',homeworkCompletionLevel:''}},'hw',[],false).includes('수업 상세');
      r.rowEscaped=!renderClassRow(cls,s,date,{[s.id]:{lessonDetail:'<b>x</b>'}},'hw',[],false).includes('<b>x</b>');
      r.detail=renderStudentDetail?renderStudentDetail('stu_b').length:0;
    }catch(e){ r.err=e.message+' @ '+(e.stack||'').split('\n')[1]; }
    return r;
  });
  const sub=await page.evaluate(async()=>{
    const calls=[]; window.fsSet=async(col,id,data)=>{calls.push({col,id,data});return true;}; window.fsDelete=async()=>true;
    session={mode:'student',studentId:'stu_b'}; currentView='home'; currentSubState.subDate='2026-10-20'; currentSubState.subClassId='cls_x';
    renderSubmissionCard('stu_b',false,false);
    currentSubState._draftSub.hwPhotos=[]; currentSubState._draftSub.memo='m';
    try{ await submitHomework('stu_b_cls_x','2026-10-20'); }catch(e){ return {err:e.message}; }
    // single-class student
    currentSubState.subClassId=''; session={mode:'student',studentId:'stu_a'}; renderSubmissionCard('stu_a',false,false);
    currentSubState._draftSub.hwPhotos=[]; await submitHomework('stu_a','2026-10-20');
    return calls.map(c=>({id:c.id,studentId:c.data.studentId,classId:c.data.classId,status:c.data.status,reviewCount:c.data.reviewCount}));
  });
  const bulk=await page.evaluate(async()=>{
    window.fsSet=async()=>true;
    session={mode:'director'}; currentView='classes'; currentSubState={classId:'cls_x',classDate:'2026-10-19',classLoadError:'ERR'}; db.classRecords={};
    const html=renderClassDetail(db.classes[0]);
    document.body.insertAdjacentHTML('beforeend',html);
    document.getElementById('bulkStepType').value='유형'; document.getElementById('bulkHwComp').value='상';
    await applyBulk('cls_x','2026-10-19');
    const rec=db.classRecords['cls_x_2026-10-19'];
    return {banner:html.includes('ERR'), type:rec&&rec.stu_a&&rec.stu_a.stepType, hw:rec&&rec.stu_b.homeworkCompletionLevel};
  });
  console.log('BULK',JSON.stringify(bulk));
  console.log('SUBMIT',JSON.stringify(sub));
  console.log(JSON.stringify(out)); console.log(errs.slice(0,8).join('\n')||'no page errors');
  await browser.close();
})();
