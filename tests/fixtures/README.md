# 시험용 합성 PDF (개인정보·교재 내용 없음)
- `sample-problems.pdf` — 영문 3문항 + 정답표. reportlab 으로 생성.
- `sample-problems-ko.pdf` — 한글 3문항(객관식 1·단답 2) + "정답 및 해설" 표. `sample-problems-ko.source.html` 을 LibreOffice(`soffice --headless --convert-to pdf:writer_web_pdf_Export`)로 변환.
- `sample-problems-ko-glyph.pdf` — 위 한글 문서와 같은 내용을 **Chromium 인쇄(page.pdf)** 로 만든 것. pdf.js 가 글자 조각마다 text item 을 따로 돌려주는(예: '정','답',' ','및'…) 재현용. `sample-problems-ko-glyph.source.html` 이 원본. 정답표 제목 인식 시험에 쓴다.
- `sample-scan.pdf` — 텍스트 없는 이미지 전용 1쪽(스캔본 흉내). 위 한글 1쪽을 화면 캡처해 이미지로만 넣음 → 텍스트 탐지가 실패해 AI 페이지 분리 경로를 타는지 시험하는 용도.
실제 교재·학생 자료는 넣지 않는다. 운영 서버에 올리는 시험에는 `sample-problems.pdf` 만 안내한다.
- `sample-cid-ko.pdf` — 한글 글꼴을 PDF 에 넣지 않은 방식(CID)으로, 문제 쪽에 "정답표" 안내 문장이 있고 정답표 문항번호가 ①②③ 인 3쪽짜리. `make-sample-cid-ko.py`(reportlab)로 생성. 글자 매핑표(CMap) 지정, 정답 쪽 판정, 번호와 본문이 한 text item("1. 12와 18의 …")인 문항의 텍스트 경계 인식 시험용.
- `sample-cid-ko-noanswer.pdf` — 위 `sample-cid-ko.pdf` 의 1~2쪽만 잘라 정답표 쪽이 없는 경우를 재현(정답이 비어 검토 대상으로 남는지, 문제 문장이 정답으로 들어가지 않는지 시험).
- `sample-footer-ko.pdf`, `sample-figure-ko.pdf` — 쪽 아래 안내 상자·꼬리말 선·꼬리말·쪽 번호가 있는 문제 쪽 + `N번` 정답표(정답 `24cm²` 위첨자). 두 번째는 마지막 문항 아래에 그림이 있음. `make-sample-footer-ko.py <출력폴더>` 로 생성. 마지막 문항에 안내·꼬리말이 섞이지 않는지, 그림은 남는지, 위첨자 정답이 보존되는지 시험.
- `sample-boundary-ko.pdf` — **합성** 2쪽(문제 1쪽 + 정답 1쪽). 문항 번호가 `1.` `2.` 형태, 마지막 문항에 그림·음영 안내 상자, 그 아래 꼬리말 문장·"연습 자료"·쪽 번호 `1/2`. 정답 `x=5`, `25cm²`, `24cm`. `make-sample-boundary-ko.py <출력폴더>` 로 생성. 실제 교재 아님.
- `sample-twocol-ko.pdf` — **합성** 3쪽(2단 문제 2쪽 + 빠른 정답표 1쪽). 앞자리 0 번호(`001`), 번호 없는 대표 문항(원문자 보기), 두 단 경계를 가로지르는 쪽 가운데 꼬리말, 한 행에 번호 2개인 정답표(답이 여러 text item, 작게 올린 위첨자 숫자). 실제 교재에서 재현된 오류를 가상 내용으로 본뜬 것. `make-sample-twocol-ko.py <출력폴더>` 로 생성.
- `sample-rep-nohead-ko.pdf`, `sample-rep-mismatch-ko.pdf` — **합성** 3쪽(2단 문제 2쪽 + 빠른 정답표). 번호 없는 대표 문항의 식별자·정답 연결 시험용: nohead 는 `유형 NN` 제목이 전혀 없고 정답표에는 `유형01 대표 ④` 행이 있음, mismatch 는 제목 [01, 02, 02(중복), 없음]에 정답표가 유형01·02·09. `make-sample-rep-ko.py <출력폴더>` 로 생성.
- `sample-fullchapter-student-ko.pdf`, `sample-fullchapter-teacher-ko.pdf` — **합성** 단원 전체 교재 흉내(1쪽 표지 `PART 04`·2쪽 개념 쪽 `5. …`·3~4쪽 2단 문제 쪽). student 는 정답표 없음, teacher 는 문항 아래 빨간 `정답/풀이` 줄 + 마지막 쪽 빠른정답. 연속 번호 시작점·인라인 정답 잘라내기·정답표 없는 객관식 판별 시험용. `make-sample-fullchapter-ko.py <출력폴더>` 로 생성. 실제 교재 아님.
