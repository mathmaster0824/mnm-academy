"""sample-boundary-ko.pdf 생성기 (reportlab). 가상 문항뿐이며 교재·학생 정보 없음.
재현하는 배치: 문항 번호('1번')와 본문이 서로 다른 text item, 마지막 문항에 그림(직사각형+치수 글자)과 음영 안내 상자,
쪽 아래 꼬리말 줄에 왼쪽 안내문(정답 및 해설 언급)과 오른쪽 끝 라벨이 같은 줄, 쪽 번호('1 / 2'), 정답표 'N번' + 'x = 6' / '24cm²'(위첨자).
사용: python3 make-sample-boundary-ko.py <출력폴더>"""
import sys, os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.colors import Color
pdfmetrics.registerFont(UnicodeCIDFont('HYSMyeongJo-Medium'))
W, H = A4; K = 'HYSMyeongJo-Medium'
c = canvas.Canvas(os.path.join(sys.argv[1] if len(sys.argv) > 1 else '.', 'sample-boundary-ko.pdf'), pagesize=A4)
def t(x, y, s, size=12, font=K, g=0):
    c.setFillColorRGB(g, g, g); c.setFont(font, size); c.drawString(x, y, s)
def footer(left, n):
    t(52, 52, left, 9, K, .35)
    t(509, 52, '연습 자료', 9, K, .35)           # 같은 줄 오른쪽 끝 라벨
    t(287, 28, f'{n} / 2', 9, K, .35)           # 쪽 번호
# 1쪽: 문제
t(52, H-58, '문제', 15); t(399, H-56, '가상 시험 자료', 9, K, .4)
t(62, H-110, '범위: 수와 식, 도형', 10, K, .3)
for i, (no, body) in enumerate([('1번', '3x - 5 = 10일 때, x의 값을 구하세요.'), ('2번', '한 변이 5cm인 정사각형의 넓이를 구하세요.'), ('3번', '아래 그림에서 직사각형의 둘레를 구하세요.')]):
    y = H-177-i*110
    t(56, y, no, 13); t(95, y, body, 13)
# 3번 그림: 직사각형 + 치수
c.setStrokeColorRGB(.2, .27, .33); c.setLineWidth(2); c.rect(240, 300, 130, 65)
t(290, 282, '8cm', 10); c.saveState(); c.translate(385, 325); c.rotate(90); t(0, 0, '4cm', 10); c.restoreState()
# 음영 안내 상자
c.setFillColor(Color(.953, .94, .915)); c.roundRect(52, 226, W-104, 34, 6, stroke=0, fill=1)
t(92, 238, '※ 풀이 과정을 식으로 쓰고, 단위도 표시하세요.', 10, K, .3)
footer('※ 정답 및 해설은 다음 쪽에서 확인하세요.', 1)
c.showPage()
# 2쪽: 정답표
t(52, H-58, '정답 및 해설', 15); t(399, H-56, '가상 시험 자료', 9, K, .4)
t(58, H-114, '앞쪽 문제의 정답입니다.', 10, K, .3)
rows = [('1번', 'x = 5', None), ('2번', '25cm²', 1), ('3번', '24cm', None)]
for i, (a, b, sq) in enumerate(rows):
    y = H-167-i*78
    t(70, y, a, 12)
    if sq: c.setFont('Helvetica', 12); c.setFillColorRGB(0, 0, 0); c.drawString(155, y, b)
    else: t(155, y, b, 12)
t(58, H-405, '해설: 정사각형의 넓이는 한 변 × 한 변이므로 5 × 5 = 25입니다.', 10, K, .3)
t(52, 52, '가상 시험 자료 · 정보 없음', 9, K, .35); t(287, 28, '2 / 2', 9, K, .35)
c.showPage(); c.save()
