"""sample-footer-ko.pdf / sample-figure-ko.pdf 생성기 (reportlab). 가상 문항뿐이며 교재·학생 정보 없음.
- sample-footer-ko.pdf : '1. 본문' 형태 문항 3개 + 쪽 아래 안내 상자·꼬리말 선·꼬리말·쪽 번호 + 'N번' 정답표(정답 24cm² 위첨자 포함).
- sample-figure-ko.pdf : 마지막 문항 아래에 그림(채운 도형)이 있고 그 아래 안내 상자·꼬리말이 있는 쪽 + 정답표.
사용: python3 make-sample-footer-ko.py <출력폴더>"""
import sys, os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.colors import Color
pdfmetrics.registerFont(UnicodeCIDFont('HYSMyeongJo-Medium'))
W, H = A4
out = sys.argv[1] if len(sys.argv) > 1 else '.'
K = 'HYSMyeongJo-Medium'

def line(c, y, text, size=12, x=66, font=K, color=0):
    c.setFillColorRGB(color, color, color); c.setFont(font, size); c.drawString(x, y, text)

def footer(c, n):
    c.setStrokeColorRGB(.8, .8, .8); c.setLineWidth(.8); c.line(54, 46, W-54, 46)
    line(c, 32, '가상 시험 자료 · 실제 학생·교재 정보 없음', 9, 54, K, .35)
    line(c, 32, f'{n}쪽', 9, 528, K, .35)

def note_box(c):
    c.setFillColor(Color(.969, .953, .925)); c.roundRect(54, 96, W-108, 60, 8, stroke=0, fill=1)
    line(c, 132, '풀이 안내: 각 문항의 답을 구한 뒤 다음 쪽의 정답표에서 확인하세요.', 10, 68, K, .3)
    line(c, 113, '이 안내 문장은 문항이 아니며, 문항 번호에도 포함되지 않습니다.', 10, 68, K, .3)

def answers_page(c, n):
    line(c, H-48, '가상 시험 자료', 10, 54); line(c, H-82, '정답 및 해설', 16, 54)
    line(c, H-120, '문항 번호', 11, 64); line(c, H-120, '정답', 11, 136); line(c, H-120, '간단한 해설', 11, 228)
    rows = [('1번', '6', '2x + 3 = 15 이므로 x = 6'), ('2번', '24cm²', '6 × 4 = 24'), ('3번', '5', '25 × 0.2 = 5')]
    for i, (a, b, d) in enumerate(rows):
        y = H-170-i*47
        line(c, y, a, 12, 64)
        if '²' in b:
            c.setFont('Helvetica', 12); c.setFillColorRGB(0, 0, 0); c.drawString(136, y, b)
        else:
            line(c, y, b, 12, 136)
        line(c, y, d, 11, 228)
    footer(c, n)

def problems_page(c, figure):
    line(c, H-48, '가상 시험 자료', 10, 54); line(c, H-82, '문항 인식 시험', 16, 54)
    line(c, H-120, '1. 2x + 3 = 15일 때, x의 값을 구하세요.', 13)
    line(c, H-198, '2. 가로가 6cm, 세로가 4cm인 직사각형의 넓이를 구하세요.', 13)
    line(c, H-276, '3. 25의 20%는 얼마인지 구하세요.', 13)
    if figure:
        c.setFillColorRGB(.35, .35, .35); p = c.beginPath(); p.moveTo(120, 430); p.lineTo(300, 430); p.lineTo(210, 520); p.close(); c.drawPath(p, stroke=0, fill=1)
    note_box(c); footer(c, 1)

for name, figure in (('sample-footer-ko.pdf', False), ('sample-figure-ko.pdf', True)):
    c = canvas.Canvas(os.path.join(out, name), pagesize=A4)
    problems_page(c, figure); c.showPage(); answers_page(c, 2); c.showPage(); c.save()
