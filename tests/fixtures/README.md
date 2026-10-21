# 시험용 합성 PDF (개인정보·교재 내용 없음)
- `sample-problems.pdf` — 영문 3문항 + 정답표. reportlab 으로 생성.
- `sample-problems-ko.pdf` — 한글 3문항(객관식 1·단답 2) + "정답 및 해설" 표. `sample-problems-ko.source.html` 을 LibreOffice(`soffice --headless --convert-to pdf:writer_web_pdf_Export`)로 변환.
- `sample-problems-ko-glyph.pdf` — 위 한글 문서와 같은 내용을 **Chromium 인쇄(page.pdf)** 로 만든 것. pdf.js 가 글자 조각마다 text item 을 따로 돌려주는(예: '정','답',' ','및'…) 재현용. `sample-problems-ko-glyph.source.html` 이 원본. 정답표 제목 인식 시험에 쓴다.
- `sample-scan.pdf` — 텍스트 없는 이미지 전용 1쪽(스캔본 흉내). 위 한글 1쪽을 화면 캡처해 이미지로만 넣음 → 텍스트 탐지가 실패해 AI 페이지 분리 경로를 타는지 시험하는 용도.
실제 교재·학생 자료는 넣지 않는다. 운영 서버에 올리는 시험에는 `sample-problems.pdf` 만 안내한다.
- `sample-cid-ko.pdf` — 한글 글꼴을 PDF 에 넣지 않은 방식(CID)으로, 문제 쪽에 "정답표" 안내 문장이 있고 정답표 문항번호가 ①②③ 인 3쪽짜리. `make-sample-cid-ko.py`(reportlab)로 생성. 글자 매핑표(CMap) 지정, 정답 쪽 판정, 번호와 본문이 한 text item("1. 12와 18의 …")인 문항의 텍스트 경계 인식 시험용.
- `sample-cid-ko-noanswer.pdf` — 위 `sample-cid-ko.pdf` 의 1~2쪽만 잘라 정답표 쪽이 없는 경우를 재현(정답이 비어 검토 대상으로 남는지, 문제 문장이 정답으로 들어가지 않는지 시험).
