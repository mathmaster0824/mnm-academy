"""sample-cid-ko.pdf 생성기 (reportlab). 한글 글꼴을 PDF 에 넣지 않는 방식(HYSMyeongJo-Medium CID, 글꼴 매핑표 UniKS-UCS2-H)과
문제 쪽의 '정답표' 언급 문장, 동그라미 문항번호(①②③) 정답표를 재현한다. 가상 문항뿐이며 교재·학생 정보 없음."""
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
import sys
pdfmetrics.registerFont(UnicodeCIDFont('HYSMyeongJo-Medium'))
W, H = A4
c = canvas.Canvas(sys.argv[1] if len(sys.argv) > 1 else 'sample-cid-ko.pdf', pagesize=A4)
def line(y, text, size=12, x=50): c.setFont('HYSMyeongJo-Medium', size); c.drawString(x, y, text)
# 1쪽: 문제 1~2 + 정답표 언급(안내 문장)
line(H-50, '합성 연습지 · 가상 문항 1 / 3', 10)
line(H-100, '문제', 14)
line(H-140, '1. 12와 18의 최대공약수를 구하시오.')
line(H-300, '2. 5의 제곱에 4를 곱한 값을 구하시오.')
line(H-700, '※ 이 자료는 정답표 연결을 확인하기 위해 만든 합성 자료입니다.', 10)
c.showPage()
# 2쪽: 문제 3 + 안내 문장
line(H-50, '합성 연습지 · 가상 문항 2 / 3', 10)
line(H-100, '문제 (계속)', 14)
line(H-140, '3. 방정식 x + 3 = 7 을 만족하는 x의 값을 구하시오.')
line(H-600, '정답은 마지막 쪽의 정답표에서 확인하세요.', 10)
c.showPage()
# 3쪽: 정답표 (문항 번호가 ①②③)
line(H-50, '합성 연습지 · 가상 문항 3 / 3', 10)
line(H-100, '정답 및 해설', 14)
line(H-140, '문항', 12, 50); line(H-140, '정답', 12, 130); line(H-140, '간단한 확인', 12, 210)
for i, (lab, ans, memo) in enumerate([('①', '6', '12와 18의 최대공약수는 6'), ('②', '100', '5의 제곱 × 4 = 25 × 4 = 100'), ('③', '4', 'x + 3 = 7 이므로 x = 4')]):
    y = H-170-i*24
    line(y, lab, 12, 50); line(y, ans, 12, 130); line(y, memo, 12, 210)
c.showPage(); c.save()
