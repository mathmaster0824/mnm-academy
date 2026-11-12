/* PDF upload preparation stays in the browser. After the server accepts the job,
 * scheduled processing and R2 checkpoints are independent of this page. */
const pdfBackgroundState={jobs:[],loading:false,uploading:false,importing:new Set(),message:'',schedulerReady:null,error:'',cursor:null};
function pdfBackgroundMessage(message){pdfBackgroundState.message=message;const el=document.getElementById('problemPdfAutoStatus');if(el)el.textContent=message;}
async function pdfBackgroundApi(path='',options={}){
  const token=await photoApiToken();
  const res=await fetch(PHOTO_API_BASE.replace(/\/$/,'')+'/pdf-imports'+path,{...options,headers:{Authorization:'Bearer '+token,'X-MNM-Role':session?.mode||'user',...options.headers}});
  if(options.binary){if(!res.ok)throw new Error('보관된 PDF 원본을 불러오지 못했습니다.');return res.blob();}
  const result=await readMnmJsonResponse(res);if(!res.ok||!result.ok)throw new Error(result.error||'서버 작업 요청 실패');return result;
}
const pdfBackgroundPost=(path,body)=>pdfBackgroundApi(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
function renderPdfBackgroundJobs(){
  const labels={uploading:'업로드 미완료',queued:'업로드 완료 · 서버 대기',processing:'서버에서 처리 중',ready:'분할 완료 · 초안 반영 중',imported:'공작소 초안에 반영 완료',error:'일부 페이지 확인 필요'};
  const rows=pdfBackgroundState.jobs.map(j=>`<div style="padding:10px 0;border-top:1px solid #e4dfd3"><b>${escapeHtml(j.fileName)}</b><div>${labels[j.status]||escapeHtml(j.status)} · 업로드 ${j.uploadedPages.length}/${j.pageCount}쪽 · 처리 ${j.donePages.length}/${j.pageCount}쪽${j.status==='processing'&&j.currentPage?` (${j.currentPage}쪽 작업 중)`:''} · ${j.problemCount}문항${j.failedPages.length?` · 실패 ${j.failedPages.map(Number).join(', ')}쪽`:''}</div>${j.error?`<div style="color:#b5473d">${escapeHtml(j.error)}</div>`:''}${j.status==='uploading'?`<button class="btn outline" onclick="resumePdfBackgroundUpload('${j.id}')" ${!j.sourceUploaded||pdfBackgroundState.uploading?'disabled':''}>업로드 이어하기</button><small> 원본 전송이 중단됐다면 같은 PDF를 다시 선택하세요. 이미 보낸 부분은 이어 올립니다.</small>`:''}${j.status==='error'?`<button class="btn outline" onclick="retryPdfBackgroundJob('${j.id}')">실패한 페이지만 재시도</button>`:''}${j.status==='ready'?`<button class="btn outline" onclick="importPdfBackgroundResult('${j.id}').catch(pdfBackgroundShowError)">완료 결과 다시 반영</button>`:''}</div>`).join('');
  return `<div style="padding:12px;border:1px solid #e4dfd3;border-radius:10px;margin-top:12px;font-size:12px;line-height:1.8"><b>PDF 서버 작업</b> <button class="btn outline" onclick="refreshPdfBackgroundJobs(true)">진행 확인</button><div>‘업로드 완료’ 이후에는 화면을 닫아도 분할 작업이 계속됩니다. 다시 접속하면 완료 결과가 공작소 초안으로 반영됩니다.</div>${pdfBackgroundState.schedulerReady===false?'<div style="color:#b5473d">서버 예약 실행이 준비되지 않았습니다. 작업은 보관되며 서버 설정 확인이 필요합니다.</div>':''}${pdfBackgroundState.error?`<div style="color:#b5473d">${escapeHtml(pdfBackgroundState.error)}</div>`:''}${rows||'<div>등록된 서버 작업이 없습니다. 진행 확인을 눌러주세요.</div>'}${pdfBackgroundState.cursor?'<button class="btn outline" onclick="refreshPdfBackgroundJobs(true,true)">이전 작업 더 보기</button>':''}</div>`;
}
function paintPdfBackgroundJobs(){const el=document.getElementById('pdfBackgroundJobs');if(el)el.innerHTML=renderPdfBackgroundJobs();}
function pdfBackgroundShowError(e){pdfBackgroundState.error=e?.message||String(e);pdfBackgroundMessage('확인 필요 · '+pdfBackgroundState.error);paintPdfBackgroundJobs();}
async function refreshPdfBackgroundJobs(manual=false,more=false){
  if(pdfBackgroundState.loading||session?.mode!=='director')return;
  pdfBackgroundState.loading=true;
  try{
    const data=await pdfBackgroundApi(more&&pdfBackgroundState.cursor?'?cursor='+encodeURIComponent(pdfBackgroundState.cursor):'');
    const jobs=more?[...pdfBackgroundState.jobs,...data.jobs]:data.jobs;
    pdfBackgroundState.jobs=[...new Map(jobs.map(j=>[j.id,j])).values()];pdfBackgroundState.cursor=data.cursor;pdfBackgroundState.schedulerReady=data.schedulerReady;pdfBackgroundState.error='';paintPdfBackgroundJobs();
    for(const job of pdfBackgroundState.jobs)if(job.status==='ready')await importPdfBackgroundResult(job.id);
  }catch(e){if(manual||pdfBackgroundState.jobs.length)pdfBackgroundShowError(e);}
  finally{pdfBackgroundState.loading=false;}
}
async function pdfBackgroundPagePng(page){
  const base=page.getViewport({scale:1}),scale=Math.min(2,1800/Math.max(base.width,base.height)),vp=page.getViewport({scale});
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(vp.width);canvas.height=Math.ceil(vp.height);
  const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
  await page.render({canvasContext:ctx,viewport:vp}).promise;
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('페이지 변환 실패')),'image/png'));
  const result={blob,width:canvas.width,height:canvas.height};canvas.width=canvas.height=0;return result;
}
const PDF_BROWSER_MAX_BYTES=512*1024*1024;
const PDF_BROWSER_PART_BYTES=8*1024*1024;
async function pdfSourceFingerprint(file){
  if(file.size<=PDF_BROWSER_PART_BYTES)return sha256BlobHex(file);
  const hashes=[];
  for(let off=0;off<file.size;off+=PDF_BROWSER_PART_BYTES){
    pdfBackgroundMessage(`큰 PDF 확인 중 · ${Math.min(off+PDF_BROWSER_PART_BYTES,file.size)/1024/1024|0}/${Math.ceil(file.size/1024/1024)}MB`);
    hashes.push(await sha256BlobHex(file.slice(off,off+PDF_BROWSER_PART_BYTES)));
  }
  return sha256BlobHex(new Blob([`mnm-pdf-parts-v1:${file.size}:`,hashes.join(':')]));
}
async function uploadPdfOriginalParts(file,id){
  let {job}=await pdfBackgroundPost('/'+id+'/source-init',{size:file.size});
  if(job.sourceUploaded)return;
  const uploaded=new Set(job.sourceParts||[]),count=Math.ceil(file.size/PDF_BROWSER_PART_BYTES);
  for(let n=1;n<=count;n++){
    if(uploaded.has(n))continue;
    const off=(n-1)*PDF_BROWSER_PART_BYTES,blob=file.slice(off,Math.min(off+PDF_BROWSER_PART_BYTES,file.size));
    pdfBackgroundMessage(`PDF 원본 전송 ${n}/${count} · ${Math.floor(off/1024/1024)}/${Math.ceil(file.size/1024/1024)}MB · 업로드 완료 전에는 화면을 유지해주세요.`);
    for(let attempt=0;attempt<2;attempt++){
      try{await pdfBackgroundApi('/'+id+'/source-part/'+n,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:blob});break;}
      catch(e){if(attempt)throw e;const resumed=await pdfBackgroundPost('/'+id+'/source-init',{size:file.size});if(resumed.job.sourceUploaded)return;if(resumed.job.sourceParts.includes(n))break;}
    }
  }
  await pdfBackgroundPost('/'+id+'/source-complete');
}
async function backgroundIngestProblemPdfFiles(input,options={}){
  const files=Array.from(input?.files||[]);if(!files.length)return;input.value='';
  if(files.length>1&&files.some(f=>problemPdfPairedRole(f.name))){
    const pair=problemPdfFindStudentTeacherPair(files);
    if(!pair)throw new Error('학생용·교사용 PDF 이름을 한 쌍으로 확인할 수 없습니다. 같은 교재·단원 이름 뒤에 학생용/교사용을 붙여주세요.');
    pdfBackgroundMessage('업로드 준비 · 교사용 정답표 확인 중…');
    const answerMap=await problemPdfExtractAnswerMapFromFile(pair.teacher);
    if(!answerMap.size)throw new Error('교사용 PDF에서 연결 가능한 정답표를 찾지 못했습니다. 파일을 확인해주세요.');
    await backgroundIngestProblemPdf(pair.student,{...options,answerMap,answerSourceFile:pair.teacher.name});return;
  }
  for(const file of files)await backgroundIngestProblemPdf(file,options);
}
async function backgroundIngestProblemPdf(file,options={}){
  if(pdfBackgroundState.uploading){pdfBackgroundMessage('다른 PDF 업로드가 진행 중입니다.');return;}
  pdfBackgroundState.uploading=true;pdfBackgroundState.error='';let pdf;
  try{
    if(file.size>PDF_BROWSER_MAX_BYTES)throw new Error('현재 PDF 한 파일당 지원 용량은 512MB입니다. 파일을 처리하지 않았습니다.');
    const health=await fetch(PHOTO_API_BASE.replace(/\/$/,'')+'/health',{cache:'no-store'}).then(r=>r.json());
    if(!health.pdfBackgroundSupported)throw new Error('서버의 백그라운드 처리 수정 배포가 필요합니다. PDF를 처리하지 않았습니다.');
    if(!health.pdfMultipartSupported)throw new Error('대용량 PDF 전송용 서버 업데이트가 필요합니다. 파일을 직접 나누실 필요는 없습니다.');
    pdfBackgroundMessage('업로드 준비 중 · 이 단계가 끝날 때까지 화면을 유지해주세요.');
    const fileHash=await pdfSourceFingerprint(file),pdfjs=await loadMnmPdfJs(),bytes=new Uint8Array(await file.arrayBuffer());
    pdf=await pdfjs.getDocument({data:bytes,cMapUrl:PROBLEM_PDF_CMAP_URL,cMapPacked:true}).promise;
    const sourceMeta={...problemPdfSourceMeta(file.name),...options.sourceMeta};
    const answerMap=options.answerMap instanceof Map?options.answerMap:await problemPdfExtractAnswerCandidates(pdf);
    let {job}=await pdfBackgroundPost('',{fileHash,fileName:file.name,pageCount:pdf.numPages,sourceMeta,answerMap:[...answerMap]});
    if(job.status!=='uploading'){
      pdfBackgroundMessage('이미 등록된 PDF입니다. 기존 서버 작업과 결과를 사용합니다.');await refreshPdfBackgroundJobs(true);return;
    }
    if(!job.sourceUploaded)await uploadPdfOriginalParts(file,job.id);
    const plans=[],pages=[];
    for(let n=1;n<=pdf.numPages;n++){pdfBackgroundMessage(`업로드 준비 ${n}/${pdf.numPages}쪽 · 아직 화면을 닫지 마세요.`);pages[n]=await pdf.getPage(n);plans.push(await problemPdfPagePlan(pages[n],n));}
    const built=problemPdfBuildRegions(plans),useText=built.regions.length>0&&Number(built.meta.quality||0)>=.65;
    let regions=useText?problemPdfCutInlineAnswers(plans,built.regions):[];
    if(useText)regions=await problemPdfTrimTrailingRegions(pages,plans,regions);
    const uploaded=new Set(job.uploadedPages);
    for(let n=1;n<=pdf.numPages;n++){
      if(uploaded.has(n))continue;
      pdfBackgroundMessage(`업로드 중 ${uploaded.size}/${pdf.numPages}쪽 · ${n}쪽 전송 · 완료 전에는 화면을 유지해주세요.`);
      const plan=plans[n-1],image=await pdfBackgroundPagePng(pages[n]);
      const pageRegions=useText?regions.filter(r=>r.page===n).map(r=>({problemNo:r.problemNo,printedProblemNo:r.printedProblemNo||'',left:r.x0/plan.width,top:r.y0/plan.height,right:r.x1/plan.width,bottom:r.y1/plan.height,rawText:problemPdfRegionText(plan.items,r,plan.height),representative:!!r.representative,idSource:r.idSource||'printed-number',typeNo:r.typeNo||'',reviewReason:r.reviewReason||''})):null;
      const form=new FormData();form.append('file',image.blob,`page-${n}.png`);form.append('meta',JSON.stringify({width:image.width,height:image.height,answerPage:plan.isAnswerPage,regions:pageRegions}));
      await pdfBackgroundApi('/'+job.id+'/pages/'+n,{method:'POST',body:form});uploaded.add(n);
    }
    await pdfBackgroundPost('/'+job.id+'/start');
    pdfBackgroundMessage('업로드 완료 · 서버에서 처리합니다. 이제 화면을 닫아도 됩니다. 다시 접속하면 결과를 확인할 수 있습니다.');
    await refreshPdfBackgroundJobs(true);
  }catch(e){pdfBackgroundShowError(e);await refreshPdfBackgroundJobs();throw e;}
  finally{pdfBackgroundState.uploading=false;if(pdf)await pdf.destroy().catch(()=>{});paintPdfBackgroundJobs();}
}
async function resumePdfBackgroundUpload(id){
  try{
    const info=await pdfBackgroundApi('/'+id+'/resume');
    const blob=await pdfBackgroundApi('/'+id+'/source',{binary:true});
    await backgroundIngestProblemPdf(new File([blob],info.fileName,{type:'application/pdf'}),{sourceMeta:info.sourceMeta,answerMap:new Map(info.answerMap)});
  }catch(e){pdfBackgroundShowError(e);}
}
async function retryPdfBackgroundJob(id){try{await pdfBackgroundPost('/'+id+'/retry');await refreshPdfBackgroundJobs(true);}catch(e){pdfBackgroundShowError(e);}}
async function importPdfBackgroundResult(id){
  if(pdfBackgroundState.importing.has(id))return;pdfBackgroundState.importing.add(id);
  try{
    let data=await pdfBackgroundApi('/'+id+'/result');const sourceId='pdfjob_'+id,srcRef=fsdb.collection('problemSources').doc(sourceId),now=new Date().toISOString(),answers=new Map(data.answerMap||[]),meta=data.sourceMeta||{};
    const source={title:data.job.fileName.replace(/\.pdf$/i,''),fileName:data.job.fileName,sourceType:'pdf',pageCount:data.job.pageCount,problemCount:data.job.problemCount,...meta,ingestMethod:'server-background-v1',backgroundJobId:id,backgroundImportState:'writing',createdAt:now};
    await fsdb.runTransaction(async tx=>{const snap=await tx.get(srcRef);if(!snap.exists)tx.set(srcRef,source);});
    // Deterministic IDs and read-before-create preserve existing review edits on refresh/crash.
    while(true){
    for(let offset=0;offset<data.problems.length;offset+=40){
      const rows=data.problems.slice(offset,offset+40);
      await fsdb.runTransaction(async tx=>{
        const refs=rows.map(p=>fsdb.collection('problemDrafts').doc(`${sourceId}_${p.page}_${p.ordinal}`));
        const snapshots=await Promise.all(refs.map(ref=>tx.get(ref)));
        for(let i=0;i<rows.length;i++){
          if(snapshots[i].exists)continue;const p=rows[i];
          const basis=p.representative?(p.idSource==='printed-type-number'?p.problemNo:''):p.printedProblemNo;
          const answer=basis?answers.get(basis):null;
          let draft={...p,...meta,sourceId,sourceName:source.title,backgroundJobId:id,rawTextDecoded:true,type:problemPdfInferType(p.rawText,answer),status:'review',createdAt:now,workshopClassificationRequired:true,pastExam:meta.materialKind==='exam',isPastExam:meta.materialKind==='exam',answer:answer?.answer||'',answerConfidence:answer?.confidence||0,answerMethod:answer?.method||'needs-review',answerSourcePage:answer?.answerPage||null,answerLinkBasis:answer?.basis||'',answerSourceFile:answer?.sourceFile||data.job.fileName,reviewReason:p.reviewReason||(p.representative&&!basis?'type-number-missing':'')};
          draft=mergeProblemRuleAnalysis(draft);draft.confidence=problemDraftConfidence(draft);draft.status=problemDraftStatus(draft);tx.set(refs[i],draft);
        }
      });
    }
    if(!data.nextPage)break;data=await pdfBackgroundApi('/'+id+'/result?from='+data.nextPage);
    }
    await srcRef.set({backgroundImportState:'complete',backgroundImportedAt:now},{merge:true});
    await pdfBackgroundPost('/'+id+'/imported');
    const job=pdfBackgroundState.jobs.find(j=>j.id===id);if(job)job.status='imported';
    pdfBackgroundMessage(`${data.job.fileName} · ${data.job.problemCount}문항을 공작소 검토 초안에 반영했습니다.`);paintPdfBackgroundJobs();
    problemStore.ingest.loaded=false;await loadProblemIngestQueue();
  }finally{pdfBackgroundState.importing.delete(id);}
}
window.addEventListener('beforeunload',e=>{if(pdfBackgroundState.uploading){e.preventDefault();e.returnValue='';}});
setInterval(()=>{if(document.visibilityState==='visible'&&document.getElementById('pdfBackgroundJobs'))refreshPdfBackgroundJobs();},10000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&document.getElementById('pdfBackgroundJobs'))refreshPdfBackgroundJobs();});
