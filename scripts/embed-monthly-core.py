#!/usr/bin/env python3
"""functions/monthlyReportCore.js 와 scripts/monthly_ui.js.part 를 index.html 의 마커 구간에 넣는다(재실행 가능)."""
import re,sys
root=sys.argv[1] if len(sys.argv)>1 else '.'
html=open(root+'/index.html',encoding='utf-8').read()
core=open(root+'/functions/monthlyReportCore.js',encoding='utf-8').read().rstrip('\n')
ui=open(root+'/scripts/monthly_ui.js.part',encoding='utf-8').read().rstrip('\n')
assert '</script' not in core and '</script' not in ui
block=("/* MONTHLY_CORE_START */\n"+core+"\n/* MONTHLY_CORE_END */\n\n/* MONTHLY_UI_START */\n"+ui+"\n/* MONTHLY_UI_END */\n\n")
if '/* MONTHLY_CORE_START */' in html:
    html=re.sub(r'/\* MONTHLY_CORE_START \*/.*?/\* MONTHLY_UI_END \*/\n\n',lambda m:block,html,flags=re.S)
else:
    marker='/* ---------------- INIT ---------------- */'
    assert html.count(marker)==1
    html=html.replace(marker,block+marker)
open(root+'/index.html','w',encoding='utf-8').write(html)
print('embedded')
