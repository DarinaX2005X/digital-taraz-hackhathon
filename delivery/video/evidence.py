"""Verify real exported synthetic material bytes before delivery."""
import hashlib
import json
from pathlib import Path
import zipfile
import xml.etree.ElementTree as ET
from io import BytesIO
HERE = Path(__file__).resolve().parent

def verify_evidence(directory=None):
    """Open the producer's actual synthetic package; do not trust file labels."""
    directory=Path(directory or HERE/'evidence')
    candidates=list(directory.glob('*.zip'))
    if len(candidates)!=1:raise ValueError('Exactly one producer ZIP is required in delivery/video/evidence before final delivery')
    package=candidates[0]
    with zipfile.ZipFile(package) as z:
        manifest=json.loads(z.read('manifest.json'))
        files=manifest['files'];formats={f['format'] for f in files}
        if formats!={'docx','xlsx'} or len(files)!=2:raise ValueError('Film package must contain one DOCX and one XLSX')
        if len(manifest['revisions'])!=2 or any(r['revision']!=1 for r in manifest['revisions']):raise ValueError('Expected the two accepted persisted revisions')
        artifacts={}
        for item in files:
            data=z.read(f"files/{item['id']}/{item['fileName']}")
            artifacts[item['format']]={'name':item['fileName'],'sha256':hashlib.sha256(data).hexdigest()}
            with zipfile.ZipFile(BytesIO(data)) as f:
                if item['format']=='docx':
                    xml=f.read('word/document.xml');tree=ET.fromstring(xml)
                    text=''.join(tree.itertext())
                    if 'Срок доставки согласуем отдельно.' not in text:raise ValueError('Manual phrase did not survive export')
                    if '4 500,00' not in text and '4\u00a0500,00' not in text and '4\u202f500,00' not in text:raise ValueError('Updated amount is absent from DOCX')
                else:
                    ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
                    tree=ET.fromstring(f.read('xl/worksheets/sheet1.xml'))
                    cell=tree.find('.//s:c[@r="C1"]',ns)
                    if cell is None:raise ValueError('C1 missing')
                    formula=cell.find('s:f',ns);value=cell.find('s:v',ns)
                    if formula is None or formula.text!='A1*B1' or value is None or float(value.text)!=4500:raise ValueError('XLSX formula/result does not match the accepted connected example')
    return {'package':package.name,'sha256':hashlib.sha256(package.read_bytes()).hexdigest(),'artifacts':artifacts,'manualPhrase':'preserved','formula':'A1*B1','result':4500,'revisions':[1,1]}
