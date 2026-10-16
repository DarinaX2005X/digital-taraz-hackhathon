"""Portable SVG authoring from the shared slide scene; no browser or raster renderer."""
from html import escape
from pathlib import Path
import base64
import mimetypes


def export_svg(scene, destination: Path, asset_root: Path, width=1440, height=810):
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title">',
             f'<title id="title">{escape(scene.title)}</title>',
             f'<rect width="{width}" height="{height}" fill="#{scene.bg}"/>']
    for obj in scene.objects:
        kind = obj['kind']
        if kind in ('rect', 'circle'):
            stroke = f' stroke="#{obj["stroke"]}" stroke-width="{obj["sw"]}"' if obj.get('stroke') else ''
            if kind == 'circle':
                parts.append(f'<ellipse cx="{obj["x"]+obj["w"]/2}" cy="{obj["y"]+obj["h"]/2}" rx="{obj["w"]/2}" ry="{obj["h"]/2}" fill="#{obj["fill"]}"{stroke}/>')
            else:
                parts.append(f'<rect x="{obj["x"]}" y="{obj["y"]}" width="{obj["w"]}" height="{obj["h"]}" rx="{obj.get("radius",0)}" fill="#{obj["fill"]}"{stroke}/>')
        elif kind == 'line':
            parts.append(f'<path d="M{obj["x1"]},{obj["y1"]} L{obj["x2"]},{obj["y2"]}" stroke="#{obj["color"]}" stroke-width="{obj["width"]}" stroke-linecap="round"/>')
        elif kind == 'poly':
            points = ' '.join(f'{x},{y}' for x,y in obj['points'])
            stroke = f' stroke="#{obj["stroke"]}" stroke-width="{obj["sw"]}"' if obj.get('stroke') else ''
            parts.append(f'<polygon points="{points}" fill="#{obj["fill"]}"{stroke}/>')
        elif kind == 'image':
            file = asset_root / obj['path']
            encoded = base64.b64encode(file.read_bytes()).decode('ascii')
            mime = mimetypes.guess_type(file.name)[0] or 'image/png'
            parts.append(f'<image x="{obj["x"]}" y="{obj["y"]}" width="{obj["w"]}" height="{obj["h"]}" preserveAspectRatio="none" href="data:{mime};base64,{encoded}"/>')
        elif kind == 'text':
            anchor = {'left': 'start', 'center': 'middle', 'right': 'end'}[obj['align']]
            x = obj['x'] + ({'left':0,'center':obj['w']/2,'right':obj['w']}[obj['align']])
            if obj.get('link'):
                parts.append(f'<a href="{escape(obj["link"],quote=True)}">')
            parts.append(f'<text font-family="Noto Sans, sans-serif" font-size="{obj["size"]}" font-weight="{700 if obj["bold"] else 400}" fill="#{obj["color"]}" text-anchor="{anchor}">')
            for i, text in enumerate(obj['text'].split('\n')):
                y = obj['y'] + obj['size']*.98 + i*obj['size']*obj['leading']
                parts.append(f'<tspan x="{x}" y="{y}">{escape(text)}</tspan>')
            parts.append('</text>')
            if obj.get('link'):
                parts.append('</a>')
    parts.append('</svg>')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text('\n'.join(parts)+'\n', encoding='utf-8')
