// index.html 안의 월말 리포트 코어가 functions/monthlyReportCore.js 와 동일한지 확인한다.
const fs=require('fs'), path=require('path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const core=fs.readFileSync(path.join(root,'functions/monthlyReportCore.js'),'utf8').replace(/\n+$/,'');
const m=html.match(/\/\* MONTHLY_CORE_START \*\/\n([\s\S]*?)\n\/\* MONTHLY_CORE_END \*\//);
if(!m){ console.error('index.html에 MONTHLY_CORE 구간이 없습니다.'); process.exit(1); }
if(m[1]!==core){ console.error('동기화 필요: python3 scripts/embed-monthly-core.py .'); process.exit(1); }
console.log('월말 리포트 코어 동기화 OK');
