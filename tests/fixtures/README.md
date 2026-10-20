# 시험용 합성 PDF (개인정보·교재 내용 없음)
- `sample-problems.pdf` — 영문 3문항 + 정답표. reportlab 으로 생성.
- `sample-problems-ko.pdf` — 한글 3문항(객관식 1·단답 2) + "정답 및 해설" 표. `sample-problems-ko.source.html` 을 LibreOffice(`soffice --headless --convert-to pdf:writer_web_pdf_Export`)로 변환.
- `sample-scan.pdf` — 텍스트 없는 이미지 전용 1쪽(스캔본 흉내). 위 한글 1쪽을 화면 캡처해 이미지로만 넣음 → 텍스트 탐지가 실패해 AI 페이지 분리 경로를 타는지 시험하는 용도.
실제 교재·학생 자료는 넣지 않는다. 운영 서버에 올리는 시험에는 `sample-problems.pdf` 만 안내한다.
