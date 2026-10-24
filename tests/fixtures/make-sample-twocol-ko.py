"""sample-twocol-ko.pdf 생성기 (reportlab). 가상 문항뿐이며 교재·학생 정보 없음.
실제 교재에서 재현된 배치 특성을 가상 내용으로 본뜬 것:
 - 2단 문제 쪽, 단 사이 세로선, 문항 번호가 앞자리 0이 붙은 3자리('001')
 - 번호 없는 '대표' 문항(원문자 ①~⑤ 보기) — 원문자는 문항 번호가 아니다
 - 쪽 가운데 꼬리말('가상 · 91')이 두 단 경계를 가로지름(오른쪽 단 마지막 문항에 섞이면 안 됨)
 - 빠른 정답표: '유형01 대표 | ④ | 001 | a ≠ 2 | 002 | 4' 처럼 한 행에 문항 번호 2개, 답이 여러 text item, 위첨자 숫자('36 cm' + 작게 올린 '2')
사용: python3 make-sample-twocol-ko.py <출력폴더>"""
import sys, os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
pdfmetrics.registerFont(UnicodeCIDFont('HYSMyeongJo-Medium'))
W, H = A4; K = 'HYSMyeongJo-Medium'
c = canvas.Canvas(os.path.join(sys.argv[1] if len(sys.argv) > 1 else '.', 'sample-twocol-ko.pdf'), pagesize=A4)
def t(x, y, s, size=10, font=K, g=0):
    c.setFillColorRGB(g, g, g); c.setFont(font, size); c.drawString(x, y, s)
PROBS = [
    ('001', '직선 y = 2x + 1 의 기울기를 구하시오.'),
    ('002', '두 수 12와 18의 최대공약수를 구하시오.'),
    ('003', '둘레의 길이가 24 cm인 정사각형의 넓이를 구하시오.'),
    ('004', '점 (1, 3)을 x축에 대하여 대칭이동한 점의 좌표를 구하시오.'),
    ('005', '3x + 2 = 11 일 때, x의 값을 구하시오.'),
    ('006', '8의 약수의 개수를 구하시오.'),
    ('007', '반지름이 3 cm인 원의 지름을 구하시오.'),
    ('008', '5의 제곱은 얼마인지 구하시오.'),
]
def problem_page(pageno, probs, base_no):
    t(52, H-60, '유형별 연습문제', 16); t(430, H-56, '가상 자료 · 교사용', 8, K, .4)
    c.setStrokeColorRGB(.7, .7, .7); c.setLineWidth(.8); c.line(W/2, H-100, W/2, 70)
    for col, x0 in enumerate((52, 312)):
        t(x0+4, H-125, f'유형 {pageno*2-1+col:02d}', 11); t(x0+50, H-125, '가상 유형 이름', 9)
        t(x0+2, H-152, '대표유형', 8, K, .3); t(x0+40, H-152, '다음 중 옳은 것은?', 10)
        for i, ch in enumerate(['① 가', '② 나', '③ 다', '④ 라', '⑤ 마']):
            t(x0+5+(i % 2)*110, H-176-(i//2)*20, ch, 10)
        t(x0, H-250, '정답 ④', 9, K, .35)
        for j in range(2):
            no, body = probs[col*2+j]
            y = H-330-j*190
            t(x0, y, no, 11); t(x0+25, y, body, 10)
            t(x0, y-24, '정답 가상 해설 한 줄', 9, K, .35)
    t(262, 36, f'가상 · {90+pageno}', 9, K, .35)   # 쪽 가운데 꼬리말(두 단 경계를 가로지름)
# 1~2쪽: 문제
problem_page(1, PROBS[0:4], 0); c.showPage()
problem_page(2, PROBS[4:8], 4); c.showPage()
# 3쪽: 빠른 정답표
t(52, H-60, '빠른정답', 16); t(430, H-56, '가상 자료 · 교사용', 8, K, .4)
ANS = [('유형01 대표', '④', '001', ['a', '≠ 2'], '002', ['4']),
       ('유형02 대표', '③', '003', ['36 cm', '^2'], '004', ['(1, −3)']),
       ('유형03 대표', '⑤', '005', ['3'], '006', ['4']),
       ('유형04 대표', '②', '007', ['6 cm'], '008', ['25'])]
for i, (nm, ch, n1, a1, n2, a2) in enumerate(ANS):
    y = H-120-i*36
    t(60, y, nm, 8); t(108, y, ch, 10)
    t(224, y, n1, 8)
    x = 273
    for part in a1:
        if part.startswith('^'):
            c.setFont('Helvetica', 7); c.setFillColorRGB(0, 0, 0); c.drawString(x, y+3, part[1:])   # 작게 올린 위첨자
        else:
            t(x, y, part, 10); x += pdfmetrics.stringWidth(part, K, 10) + (2 if part == 'a' else 0)
    t(389, y, n2, 8)
    t(437, y, ' '.join(a2), 10)
t(262, 36, '가상 · 빠른정답', 9, K, .35)
c.showPage(); c.save()
