"""Rebuild attributed, unmodified page images from ECEE's permitted educational use.
Requires pymupdf and Pillow. No user data is read or sent.
"""
import hashlib
import json
import re
import urllib.request
from pathlib import Path
import pymupdf as fitz
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / 'test-results' / 'official-sources'
CACHE.mkdir(parents=True, exist_ok=True)
PAPERS = [('20240526', '令和6年度上期'), ('20241027', '令和6年度下期'),
          ('20250525', '令和7年度上期'), ('20251026', '令和7年度下期'), ('20260524', '令和8年度上期')]
# Rows transcribed from the official answer tables; columns are n,n+10,...,n+40.
ANSWER_ROWS = {
 '20240526': 'ロハイイロ ハロロロハ ニニイニイ イロニイイ ロイニハニ イロイハニ イロロロニ ロイイイロ ハロハイイ イニニロニ',
 '20241027': 'ロロロロニ イハロハハ ハイロハイ ハロハハニ ニハハニハ ニハイニハ ニニハロロ ハイイロイ ハハロイイ ロイロイロ',
 '20250525': 'ロハハロロ ハロロニロ イハイロニ ハロハニハ ロハハイイ ハイロロロ ロハイロハ ロイハロロ ロニロイロ ニニイハハ',
 '20251026': 'ロイイハハ イロイロロ ハニイニハ イイイイイ ハニハロロ ニロイハイ ハロニロニ ハニニニイ ロハイイロ ハロハニハ',
 '20260524': 'イイイニニ ロロニハハ ハニロニロ ニハハイイ ロイロロロ ロニイハニ ニイニニハ ロイロロロ イイハイイ ハイイニニ',
}
catalog = []
for date, title in PAPERS:
    docs = {}
    urls = {}
    hashes = {}
    for kind in ['q', 'a']:
        url = f'https://www.shiken.or.jp/construction/upload/{date}_co_second_{kind}01.pdf'
        target = CACHE / f'{date}-{kind}.pdf'
        if not target.exists():
            urllib.request.urlretrieve(url, target)
        docs[kind] = fitz.open(target)
        urls[kind] = url
        hashes[kind] = hashlib.sha256(target.read_bytes()).hexdigest()
    answer_text = '\n'.join(p.get_text() for p in docs['a'])
    rows = ANSWER_ROWS[date].split()
    answers = {col * 10 + row + 1: rows[row][col] for col in range(5) for row in range(10)}
    assert sorted(answers) == list(range(1, 51)), (date, answer_text)
    extracted = {int(n):a for n,a in re.findall(r'(\d+)\s*([イロハニ])', answer_text)}
    assert all(extracted.get(n) == a for n,a in answers.items()), (date, 'answer transcription mismatch')
    out = ROOT / 'public' / 'exams' / date
    out.mkdir(parents=True, exist_ok=True)
    page_text = []
    question_pages = {}
    reflow = []
    for i, page in enumerate(docs['q']):
        page_text.append(f'\n=== PAGE {i + 1} ===\n{page.get_text(sort=True)}')
        if i < 4 or i == 15:
            continue
        if 4 <= i <= 12:
            numbered = sorted([(int(w[4]), w[1]) for w in page.get_text('words')
                               if w[4].isdigit() and 1 <= int(w[4]) <= 50 and 60 <= w[0] < 85], key=lambda w:w[1])
            for pos, (number, top) in enumerate(numbered):
                bottom = numbered[pos + 1][1] - 8 if pos + 1 < len(numbered) else page.rect.height - 48
                rules = [d['rect'].y0 for d in page.get_drawings() if d['rect'].width > 190 and d['rect'].height < 3 and 50 < d['rect'].x0 < 100]
                row_top = max([y for y in rules if y < top] or [top-8])
                next_number_top = numbered[pos+1][1] if pos+1 < len(numbered) else page.rect.height
                row_bottom = max([y for y in rules if top < y < next_number_top] or [bottom]) if pos+1 == len(numbered) else max([y for y in rules if top < y < next_number_top] or [bottom])
                bottom = min(row_bottom, page.rect.height-48)
                cell_top = row_top + 2
                bottom -= 1
                clip = fitz.Rect(60, cell_top, page.rect.width - 52, bottom)
                cp = page.get_pixmap(matrix=fitz.Matrix(2, 2), clip=clip, alpha=False)
                Image.frombytes('RGB', [cp.width, cp.height], cp.samples).save(out / f'q-{number}.webp', quality=90)
                question_pages[number] = i + 1
                # Reflow original raster cells, without retyping math or redrawing symbols.
                labels = [w for w in page.get_text('words') if re.match(r'^[イロハニ][．.]', w[4]) and cell_top <= w[1] < bottom and w[0] > 190]
                if len(labels) != 4 or set(w[4][0] for w in labels) != set('イロハニ'):
                    print(date, number, 'kept as complete original row; missing text labels')
                    continue
                left = min(w[0] for w in labels)
                # The question's table cell begins after its number column.
                parts = {'stem': fitz.Rect(94 if i < 10 else 86, cell_top, left-7, bottom)}
                xs = sorted(set(round(w[0], 0) for w in labels))
                ys = []
                for w in sorted(labels,key=lambda w:w[1]):
                    if not ys or w[1]-ys[-1] > 8: ys.append(w[1])
                for w in labels:
                    x0 = w[0]-3
                    x1 = min([x-3 for x in xs if x > w[0]+8] + [page.rect.width-66])
                    y1 = min([y-4 for y in ys if y > w[1]+8] + [bottom])
                    y0 = cell_top if abs(w[1]-ys[0])<8 else w[1]-4
                    parts[str('イロハニ'.index(w[4][0]))] = fitz.Rect(x0,y0,x1,y1)
                for part, region in parts.items():
                    px=page.get_pixmap(matrix=fitz.Matrix(2,2),clip=region,alpha=False)
                    im=Image.frombytes('RGB',[px.width,px.height],px.samples)
                    mask=ImageChops.difference(im,Image.new('RGB',im.size,'white')).convert('L').point(lambda p:255 if p>50 else 0)
                    bbox=mask.getbbox()
                    if bbox: im=im.crop((max(0,bbox[0]-4),max(0,bbox[1]-4),min(im.width,bbox[2]+4),min(im.height,bbox[3]+4)))
                    im.save(out / f'q-{number}-{part}.webp', quality=90)
                reflow.append(number)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        Image.frombytes('RGB', [pix.width, pix.height], pix.samples).save(out / f'page-{i+1}.webp', quality=88)
    (CACHE / f'{date}.txt').write_text(''.join(page_text), encoding='utf-8')
    assert sorted(question_pages) == list(range(1, 51)), (date, question_pages)
    catalog.append(dict(id=date, title=title + ' 第二種電気工事士 学科試験',
                        questionUrl=urls['q'], answerUrl=urls['a'], sourceSha256=hashes,
                        answers=[answers[n] for n in range(1, 51)],
                        reflow=reflow, questionPages=[question_pages[n] for n in range(1, 51)], pages=list(range(5, 16)), diagramPage=15, verifiedOn='2026-09-06'))
    print(date, len(answers), 'answers;', len(docs['q']), 'pages')
(ROOT / 'src' / 'data' / 'official-exams.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
