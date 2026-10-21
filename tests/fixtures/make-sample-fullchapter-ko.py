"""sample-fullchapter-student-ko.pdf, sample-fullchapter-teacher-ko.pdf 생성기 (reportlab). 가상 문항뿐이며 교재·학생 정보 없음.
실제 '단원 전체' 교재 PDF 에서 재현된 실패를 가상 내용으로 본뜬 시험용:
 - 1쪽 표지·목차: 큰 'PART 04'(문항 번호 모양, 왼쪽 번호 줄과 같은 위치) → 연속 번호의 시작으로 잘못 잡히던 문제
 - 2쪽 개념 쪽: '5. …' 로 시작하는 한 덩어리 글과 번호 줄 위치의 숫자 '1','2' (개념 설명 번호·각주)
 - 3~4쪽 2단 문제 쪽: 번호 문항 001~008(앞자리 0) + 번호 없는 대표(원문자 보기 ①~⑤)
 - student : 문제만(정답표 없음) → 대표 문항이 객관식으로 판별되는지(원문자는 NFKC 정규화되면 사라짐)
 - teacher : 각 문항 바로 아래에 빨간 '정답 …/풀이' 줄이 인쇄됨(+ 마지막 쪽 정답표) → 문항 이미지·본문에 정답이 섞이지 않는지
사용: python3 make-sample-fullchapter-ko.py <출력폴더>"""
import sys, os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
pdfmetrics.registerFont(UnicodeCIDFont('HYSMyeongJo-Medium'))
W, H = A4; K = 'HYSMyeongJo-Medium'
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
def t(c, x, y, s, size=10, g=0, rgb=None):
    c.setFillColorRGB(*(rgb if rgb else (g, g, g))); c.setFont(K, size); c.drawString(x, y, s)
RED = (.85, .2, .15)
def build(name, teacher):
    c = canvas.Canvas(os.path.join(OUT, name), pagesize=A4)
    # 1쪽 표지·목차
    t(c, 52, H-110, 'PART', 12, .3); t(c, 52, H-170, '04', 54)
    t(c, 150, H-160, '가상 단원', 22)
    for i in range(4): t(c, 62, H-240-i*18, f'개념 0{i+1}  가상 개념 {i+1}', 10); t(c, 470, H-240-i*18, str(76+i), 10)
    t(c, 262, 36, '가상 교재', 9, .35); c.showPage()
    # 2쪽 개념 쪽
    t(c, 52, H-60, '개념 정리', 16)
    t(c, 52, H-110, '5. 가상 개념을 정리하면 다음과 같다', 11)
    t(c, 52, H-140, '1', 10); t(c, 70, H-140, '가상 설명 첫째', 10)
    t(c, 52, H-165, '2', 10); t(c, 70, H-165, '가상 설명 둘째', 10)
    t(c, 52, H-200, '3', 10); t(c, 70, H-200, '가상 설명 셋째', 10)
    t(c, 262, 36, '가상 교재', 9, .35); c.showPage()
    probs = ['001', '002', '003', '004', '005', '006', '007', '008']
    # 003·005·006 번 정답은 한글로 시작(실제 교사용 교재의 '최댓값 2, 최솟값 −2', '제3사분면', '제1, 2사분면' 형태를 가상 값으로 본뜸)
    ans = ['x=3', '12', '최댓값 7, 최솟값 1', '5', '제3사분면', '제1, 2사분면', '4', '8']
    for pg in range(2):
        t(c, 52, H-60, '유형별 연습문제', 16)
        c.setStrokeColorRGB(.7, .7, .7); c.line(W/2, H-100, W/2, 70)
        for col, x0 in enumerate((52, 312)):
            h = pg*2+col+1
            t(c, x0+4, H-125, f'유형 {h:02d}', 11); t(c, x0+50, H-125, '가상 유형 이름', 9)
            t(c, x0+2, H-152, '대표유형', 8, .3); t(c, x0+40, H-152, '다음 중 옳은 것은?', 10)
            for i, ch in enumerate(['① 가', '② 나', '③ 다', '④ 라', '⑤ 마']):
                t(c, x0+5+(i % 2)*110, H-176-(i//2)*20, ch, 10)
            if teacher:
                t(c, x0+2, H-236, '정답 ④', 8, rgb=RED); t(c, x0+2, H-250, '④ 라 (가상 풀이)', 8, rgb=RED)
            for j in range(2):
                k = pg*4+col*2+j; n = probs[k]; y = H-330-j*190
                t(c, x0, y, n, 11); t(c, x0+25, y, f'가상 문제 {n} 의 값을 구하시오.', 10)
                if teacher:
                    t(c, x0, y-26, f'정답 {ans[k]}', 8, rgb=RED); t(c, x0, y-40, '가상 풀이 과정', 8, rgb=RED)
        t(c, 262, 36, f'가상 · {91+pg}', 9, .35)
        c.showPage()
    if teacher:
        t(c, 52, H-60, '빠른정답', 16)
        for i in range(4):
            y = H-120-i*36
            t(c, 60, y, f'유형{i+1:02d} 대표', 8); t(c, 108, y, '④', 10)
            t(c, 224, y, f'{2*i+1:03d}', 8); t(c, 273, y, ans[2*i], 10); t(c, 389, y, f'{2*i+2:03d}', 8); t(c, 437, y, ans[2*i+1], 10)
        t(c, 262, 36, '가상 · 빠른정답', 9, .35); c.showPage()
    c.save()
build('sample-fullchapter-student-ko.pdf', False)
build('sample-fullchapter-teacher-ko.pdf', True)
