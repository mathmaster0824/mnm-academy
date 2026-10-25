"""sample-rep-nohead-ko.pdf, sample-rep-mismatch-ko.pdf 생성기 (reportlab). 가상 문항뿐이며 교재·학생 정보 없음.
번호 없는 대표 문항(대표유형)의 식별자·정답 연결 시험용:
 - nohead   : 문제 쪽에 '유형 NN' 제목이 전혀 없고(대표 4개), 정답표에는 '유형01 대표 ④' 행이 있음 → 앱 생성 번호(대표01~04), 정답 연결 안 함
 - mismatch : 제목이 [01, 02, 02(중복), 없음], 정답표는 유형01·유형02·유형09 → 01 만 연결, 나머지는 추측하지 않고 검토, 정답표 쪽 미매칭 기록
사용: python3 make-sample-rep-ko.py <출력폴더>"""
import sys, os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
pdfmetrics.registerFont(UnicodeCIDFont('HYSMyeongJo-Medium'))
W, H = A4; K = 'HYSMyeongJo-Medium'
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
def t(c, x, y, s, size=10, font=K, g=0):
    c.setFillColorRGB(g, g, g); c.setFont(font, size); c.drawString(x, y, s)
def build(name, heads, answers):
    c = canvas.Canvas(os.path.join(OUT, name), pagesize=A4)
    probs = ['001', '002', '003', '004', '005', '006', '007', '008']
    for pg in range(2):
        t(c, 52, H-60, '유형별 연습문제', 16)
        c.setStrokeColorRGB(.7, .7, .7); c.line(W/2, H-100, W/2, 70)
        for col, x0 in enumerate((52, 312)):
            h = heads[pg*2+col]
            if h: t(c, x0+4, H-125, f'유형 {h:02d}', 11); t(c, x0+50, H-125, '가상 유형 이름', 9)
            t(c, x0+2, H-152, '대표유형', 8, K, .3); t(c, x0+40, H-152, '다음 중 옳은 것은?', 10)
            for i, ch in enumerate(['① 가', '② 나', '③ 다', '④ 라', '⑤ 마']):
                t(c, x0+5+(i % 2)*110, H-176-(i//2)*20, ch, 10)
            for j in range(2):
                n = probs[pg*4+col*2+j]; y = H-330-j*190
                t(c, x0, y, n, 11); t(c, x0+25, y, f'가상 문제 {n} 의 값을 구하시오.', 10)
        t(c, 262, 36, f'가상 · {91+pg}', 9, K, .35)
        c.showPage()
    t(c, 52, H-60, '빠른정답', 16)
    for i, (typ, ch, n1, a1, n2, a2) in enumerate(answers):
        y = H-120-i*36
        t(c, 60, y, f'유형{typ:02d} 대표', 8); t(c, 108, y, ch, 10)
        t(c, 224, y, n1, 8); t(c, 273, y, a1, 10); t(c, 389, y, n2, 8); t(c, 437, y, a2, 10)
    t(c, 262, 36, '가상 · 빠른정답', 9, K, .35)
    c.showPage(); c.save()
rows = lambda typs, chs: [(typs[i], chs[i], f'{2*i+1:03d}', str(2*i+1), f'{2*i+2:03d}', str(2*i+2)) for i in range(len(typs))]
build('sample-rep-nohead-ko.pdf', [None]*4, rows([1, 2, 3, 4], ['④', '③', '⑤', '②']))
build('sample-rep-mismatch-ko.pdf', [1, 2, 2, None], rows([1, 2, 9], ['④', '③', '①']))
