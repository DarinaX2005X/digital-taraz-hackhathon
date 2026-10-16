"""Native GL film entry point. No browser automation or app runtime."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from PIL import Image

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
if str(HERE) not in sys.path:sys.path.insert(0,str(HERE))
from engine import Eng
from scenes import FPS,DURATION,SHOTS,EVENTS,frame_bytes,validate
from audio import make_audio
from evidence import verify_evidence
CACHE=ROOT/'.local-data/media/video'

def ffmpeg(name='ffmpeg'):
    value=shutil.which(name)
    if not value:
        candidate=Path(f'C:/Program Files/ffmpeg-7.1-full_build/bin/{name}.exe')
        if candidate.is_file():value=str(candidate)
    if not value:raise RuntimeError(f'{name} is required')
    return value

def image(E,frame):
    return Image.frombytes('RGB',(E.w,E.h),frame_bytes(E,frame)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)

def pixel_check():
    E=Eng(480,270)
    for frame in [30,160,250,1200,6100]:
        a=frame_bytes(E,frame);frame_bytes(E,frame+1)
        if a!=frame_bytes(E,frame):raise RuntimeError(f'Non-deterministic random access at frame {frame}')
    return {'randomAccess':'pass','renderer':E.ctx.info['GL_RENDERER'],'version':E.ctx.version_code}

def render(start,end,width,path):
    if not 0<=start<end<=DURATION:raise ValueError('Invalid range')
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    height=round(width*1080/1920)
    if width%2 or height%2:raise ValueError('Even dimensions are required')
    E=Eng(width,height)
    cmd=[ffmpeg(),'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{width}x{height}','-r',str(FPS),'-i','-',
         '-vf','vflip,scale=in_range=full:out_range=tv:out_color_matrix=bt709,format=yuv420p','-an','-c:v','libx264','-preset','fast','-crf','18' if width==1920 else '22',
         '-maxrate','2000k','-bufsize','4000k','-threads','2','-profile:v','high','-level','4.2','-g',str(FPS),'-keyint_min',str(FPS),'-sc_threshold','0',
         '-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-movflags','+faststart',str(path)]
    p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    try:
        for frame in range(round(start*FPS),round(end*FPS)):
            p.stdin.write(frame_bytes(E,frame))
            if frame%300==0:print(f'picture {frame}/{round(end*FPS)}',flush=True)
        p.stdin.close();code=p.wait()
        if code:raise RuntimeError(f'FFmpeg exited with {code}')
    except BaseException:
        p.kill();p.wait();raise
    return path

def captions(path):
    def stamp(t):
        ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}'
    text='WEBVTT\n\n'
    for shot in SHOTS:text+=f'{shot.id}\n{stamp(shot.start)} --> {stamp(shot.end)}\n{shot.caption}\n\n'
    Path(path).write_text(text,encoding='utf-8')

def verify_final(final):
    probe=subprocess.run([ffmpeg('ffprobe'),'-v','error','-show_format','-show_streams','-of','json',str(final)],capture_output=True,text=True,check=True)
    data=json.loads(probe.stdout);v=next(s for s in data['streams'] if s['codec_type']=='video');a=next(s for s in data['streams'] if s['codec_type']=='audio')
    if (v['width'],v['height'],v['avg_frame_rate'],int(v['nb_frames']),v['pix_fmt'],v['codec_name'])!=(1920,1080,f'{FPS}/1',FPS*DURATION,'yuv420p','h264'):raise RuntimeError('Final picture metadata differs from the specification')
    if a['channels']!=2 or a['sample_rate']!='48000' or a['codec_name']!='aac':raise RuntimeError('Final audio metadata differs from the specification')
    if abs(float(data['format']['duration'])-DURATION)>1/FPS:raise RuntimeError('Final duration differs from the timeline')
    if final.stat().st_size>30*1024*1024:raise RuntimeError('Final exceeds the 30 MiB static-delivery budget')
    subprocess.run([ffmpeg(),'-v','error','-i',str(final),'-f','null','-'],check=True)
    measure=subprocess.run([ffmpeg(),'-hide_banner','-i',str(final),'-vn','-af','loudnorm=I=-18:TP=-1.5:LRA=8:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
    levels=json.JSONDecoder().raw_decode(measure.stderr[measure.stderr.rfind('{'):])[0]
    if not -18.5<=float(levels['input_i'])<=-17.5 or float(levels['input_tp'])>-1:raise RuntimeError(f'Encoded audio loudness: {levels}')
    source_files=[HERE/p for p in ('film.py','scenes.py','engine.py','audio.py')]
    report={'file':os.path.relpath(final,ROOT).replace('\\','/'),'sha256':hashlib.sha256(final.read_bytes()).hexdigest(),
            'sourceHashes':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in source_files},
            'content':'Authored product animation; no browser recording or unproduced export evidence.',
            'probe':data,'decoded':'pass','finalAudioMeasurement':levels,
            'normalSpeedPlayback':'not performed','listening':'not performed','browserVerification':'user-owned; not performed'}
    (HERE/'delivery-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    return report

def deliver(directory,reuse_picture=False):
    validate();directory=Path(directory).resolve();directory.mkdir(parents=True,exist_ok=True)
    picture=CACHE/'picture-1080p.mp4';score=CACHE/'score.wav'
    if not reuse_picture:render(0,DURATION,1920,picture)
    make_audio(score,DURATION,EVENTS,SHOTS)
    final=directory/'tirlik-product-film-ru.mp4'
    subprocess.run([ffmpeg(),'-hide_banner','-loglevel','error','-y','-i',str(picture),'-i',str(score),'-map','0:v:0','-map','1:a:0',
                    '-c:v','copy','-c:a','aac','-b:a','192k','-af','loudnorm=I=-18:TP=-1.5:LRA=8','-ar','48000','-t',str(DURATION),'-movflags','+faststart',str(final)],check=True)
    image(Eng(1920,1080),round(101*FPS)).save(directory/'tirlik-product-film-poster.jpg',quality=94)
    captions(directory/'tirlik-product-film-ru.vtt');report=verify_final(final)
    print(json.dumps({'file':str(final),'bytes':final.stat().st_size,'sha256':report['sha256']},ensure_ascii=False,indent=2))

def main():
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True)
    check=sub.add_parser('check');check.add_argument('--pixels',action='store_true');sub.add_parser('evidence')
    frame=sub.add_parser('frame');frame.add_argument('--time',type=float,default=20.5);frame.add_argument('--width',type=int,default=1920);frame.add_argument('--out',required=True)
    r=sub.add_parser('render');r.add_argument('--start',type=float,default=0);r.add_argument('--end',type=float,default=DURATION);r.add_argument('--width',type=int,default=960);r.add_argument('--out',required=True)
    d=sub.add_parser('deliver');d.add_argument('--out-dir',default=str(ROOT/'public/video'));d.add_argument('--reuse-picture',action='store_true')
    args=p.parse_args();CACHE.mkdir(parents=True,exist_ok=True)
    if args.command=='check':
        result=validate()
        if args.pixels:result['pixels']=pixel_check()
        print(json.dumps(result,ensure_ascii=False,indent=2))
    elif args.command=='evidence':print(json.dumps(verify_evidence(),ensure_ascii=False,indent=2))
    elif args.command=='frame':
        Path(args.out).parent.mkdir(parents=True,exist_ok=True);image(Eng(args.width,round(args.width*1080/1920)),round(args.time*FPS)).save(args.out)
    elif args.command=='render':render(args.start,args.end,args.width,args.out)
    else:deliver(args.out_dir,args.reuse_picture)

if __name__=='__main__':main()
