"""Delivery guards: stale or invented file evidence must stop the final render."""
import importlib.util
from io import BytesIO
import json
from pathlib import Path
import sys
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('tirlik_film', ROOT/'delivery/video/film.py')
film = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = film
spec.loader.exec_module(film)


def archive(entries):
    buf=BytesIO()
    with zipfile.ZipFile(buf,'w') as z:
        for name,data in entries.items():z.writestr(name,data)
    return buf.getvalue()


def fixture(folder, *, manual='Срок доставки согласуем отдельно.', amount='4 500,00 ₸', formula='A1*B1', result=4500, revision=1):
    manifest={'files':[{'id':'doc','fileName':'offer.docx','format':'docx'},{'id':'sheet','fileName':'quote.xlsx','format':'xlsx'}],'revisions':[{'artifactId':'doc','revision':revision},{'artifactId':'sheet','revision':revision}]}
    doc=archive({'word/document.xml':f'<document><p>{manual}</p><p>{amount}</p></document>'})
    sheet=archive({'xl/worksheets/sheet1.xml':f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row><c r="C1"><f>{formula}</f><v>{result}</v></c></row></sheetData></worksheet>'})
    (folder/'fixture.zip').write_bytes(archive({'manifest.json':json.dumps(manifest),'files/doc/offer.docx':doc,'files/sheet/quote.xlsx':sheet}))


class FilmEvidenceTests(unittest.TestCase):
    def test_missing_real_export_stops_delivery(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(ValueError,'producer ZIP'):film.verify_evidence(Path(d))

    def test_reads_contents_and_not_filenames(self):
        with tempfile.TemporaryDirectory() as d:
            folder=Path(d);fixture(folder)
            result=film.verify_evidence(folder)
            self.assertEqual(result['result'],4500)
            self.assertEqual(result['manualPhrase'],'preserved')
            self.assertEqual(set(result['artifacts']),{'docx','xlsx'})

    def test_lost_manual_phrase_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            folder=Path(d);fixture(folder,manual='Доставка завтра.')
            with self.assertRaisesRegex(ValueError,'Manual phrase'):film.verify_evidence(folder)

    def test_stale_or_unconnected_spreadsheet_is_rejected(self):
        for overrides in ({'result':3000},{'formula':'4500'}):
            with self.subTest(overrides=overrides),tempfile.TemporaryDirectory() as d:
                folder=Path(d);fixture(folder,**overrides)
                with self.assertRaisesRegex(ValueError,'formula/result'):film.verify_evidence(folder)

    def test_stale_document_or_revision_is_rejected(self):
        for overrides,reason in (({'amount':'3 000,00 ₸'},'Updated amount'),({'revision':0},'persisted revisions')):
            with self.subTest(overrides=overrides),tempfile.TemporaryDirectory() as d:
                folder=Path(d);fixture(folder,**overrides)
                with self.assertRaisesRegex(ValueError,reason):film.verify_evidence(folder)


if __name__=='__main__':unittest.main()
