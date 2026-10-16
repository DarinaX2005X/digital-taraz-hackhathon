"""Structural checks only: this does not render or visually review a slide."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from pypdf import PdfReader
from pptx import Presentation
import pdfplumber

ROOT = Path(__file__).resolve().parent
EXPECTED_LINKS = {'https://tirlik.vercel.app', 'https://github.com/DarinaX2005X/digital-taraz-hackhathon'}


def normalized(text):
    return re.sub(r'\s+', ' ', text).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT)
    parser.add_argument('--project-root', type=Path)
    args = parser.parse_args()
    model = json.loads((args.output / 'scene-model.json').read_text(encoding='utf-8'))
    pages = model['slides']
    pdf_path = args.output / 'tirlik-presentation.pdf'
    pptx_path = args.output / 'tirlik-presentation.pptx'
    reader = PdfReader(pdf_path, strict=True)
    prs = Presentation(pptx_path)
    assert len(reader.pages) == len(prs.slides) == len(pages) == 9
    assert not reader.is_encrypted
    actual_links = set()
    pdf_fonts = set()
    text_count = shape_count = 0
    for index, (page, slide, scene) in enumerate(zip(reader.pages, prs.slides, pages), 1):
        assert abs(float(page.mediabox.width) - 960) < .1
        assert abs(float(page.mediabox.height) - 540) < .1
        expected = [o['text'] for o in scene['objects'] if o['kind'] == 'text']
        pptx_text = [shape.text for shape in slide.shapes if shape.has_text_frame and shape.text]
        assert pptx_text == expected, f'PPTX text mismatch on slide {index}'
        extracted = normalized(page.extract_text())
        for text in expected:
            assert normalized(text) in extracted, f'PDF missing text on slide {index}: {text}'
        assert scene['notes'] in slide.notes_slide.notes_text_frame.text
        for annot in page.get('/Annots', []):
            obj = annot.get_object()
            if obj.get('/A', {}).get('/URI'):
                actual_links.add(str(obj['/A']['/URI']))
        for fontref in page['/Resources'].get('/Font', {}).values():
            font = fontref.get_object()
            name = str(font.get('/BaseFont'))
            if 'NotoSans' in name:
                assert '/FontFile2' in font['/FontDescriptor'].get_object()
                assert '/ToUnicode' in font
                pdf_fonts.add(name)
        text_count += len(expected)
        shape_count += len(slide.shapes)
    assert actual_links == EXPECTED_LINKS
    assert len(pdf_fonts) == 2
    # Native PDF text coordinates detect content outside the page without rasterizing.
    char_count = 0
    with pdfplumber.open(pdf_path) as doc:
        for index, page in enumerate(doc.pages, 1):
            for char in page.chars:
                assert char['x0'] >= -1 and char['top'] >= -1, (index, char)
                assert char['x1'] <= page.width + 1 and char['bottom'] <= page.height + 1, (index, char)
                char_count += 1
    with zipfile.ZipFile(pptx_path) as archive:
        assert archive.testzip() is None
        for name in archive.namelist():
            if name.endswith(('.xml', '.rels')):
                ET.fromstring(archive.read(name))
        pptx_links = set()
        for name in archive.namelist():
            if name.endswith('.rels'):
                for rel in ET.fromstring(archive.read(name)):
                    if rel.attrib.get('Type', '').endswith('/hyperlink'):
                        pptx_links.add(rel.attrib['Target'])
        assert pptx_links == EXPECTED_LINKS
    evidence = sorted({path for page in pages for path in page['evidence']})
    source_hashes = {}
    if args.project_root:
        for path in evidence:
            full = args.project_root / path
            assert full.exists(), f'Evidence path missing: {path}'
            if full.is_file():
                source_hashes[path] = hashlib.sha256(full.read_bytes()).hexdigest()
    report = {
        'result': 'passed', 'slides': len(pages), 'editable_text_boxes': text_count,
        'pptx_shapes': shape_count, 'pdf_text_characters_within_page': char_count,
        'pdf_embedded_unicode_fonts': sorted(pdf_fonts), 'links': sorted(actual_links),
        'pptx_zip_and_xml': 'passed', 'text_and_notes_match_scene_model': True,
        'evidence_paths_checked': len(evidence) if args.project_root else 0,
        'source_file_sha256': source_hashes,
        'preview_source': 'The actual PDF is rasterized with PDFium. Application-specific PPTX display remains unverified.',
    }
    (args.output / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k != 'source_file_sha256'}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
