"""Original Tirlik score and event synthesis. No reference soundtrack is copied."""
import math
import wave
import numpy as np

def make_audio(path, duration, events, shots):
    DURATION = duration
    EVENTS = events
    SHOTS = shots
    SEED = 2601017
    """Original deterministic score + event SFX, no copied reference soundtrack."""
    sr=48000;n=round(DURATION*sr);mix=np.zeros((n,2),np.float32)
    rng=np.random.default_rng(SEED)
    def place(at,signal,pan=0,gain=1):
        start=round(at*sr)
        if start>=n:return
        signal=signal[:n-start].astype(np.float32)*gain
        mix[start:start+len(signal),0]+=signal*math.sqrt((1-pan)/2)
        mix[start:start+len(signal),1]+=signal*math.sqrt((1+pan)/2)
    def tone(freq,dur,amp=.1,attack=.03,release=.2):
        x=np.arange(round(sr*dur))/sr
        e=np.minimum(1,x/attack)*np.minimum(1,(dur-x)/release)
        return amp*e*(np.sin(2*np.pi*freq*x)+.18*np.sin(2*np.pi*freq*2*x))
    bpm=104;beat=60/bpm
    chords=[(130.81,164.81,196.00,246.94),(110,130.81,164.81,196),(87.31,110,130.81,164.81),(98,123.47,146.83,196)]
    for bar in range(math.ceil(DURATION/(beat*4))):
        at=bar*beat*4;chord=chords[bar%4]
        # Arrangement follows the story: restrained input, open mechanisms,
        # a small lift at accepted changes, and a quieter final brand hold.
        energy=.65 if at<7 else (1.05 if 16<=at<34 or 51<=at<72 else (.45 if at>=103 else .82))
        for i,f in enumerate(chord):place(at,tone(f,beat*4+.25,.028,.18,.6),(-.6+i*.4),gain=.85+energy*.15)
        for step in range(8):
            if at>=103 and step%2:continue
            f=chord[(step+bar)%4]*4;place(at+step*beat/2,tone(f,beat*.65,.043,.009,.26),math.sin(step*1.5)*.55,gain=energy)
        for step in range(4):
            bt=at+step*beat;x=np.arange(round(sr*.2))/sr
            if step%2==0:
                kick=.11*np.sin(2*np.pi*(48*x+5*(1-np.exp(-x*40))))*np.exp(-x*25);place(bt,kick,gain=energy)
            else:
                noise=rng.normal(0,1,len(x));clap=.026*noise*np.exp(-x*45);place(bt,clap,.1,gain=energy)
            xx=np.arange(round(sr*.06))/sr;noise=rng.normal(0,1,len(xx));hat=np.diff(noise,prepend=0)*.008*np.exp(-xx*70);place(bt+beat/2,hat,-.25)
    for i,(name,at) in enumerate(EVENTS.items()):
        if name in {'capacity_stop','unknown_terms'}:
            place(at,tone(220,.23,.09,.005,.18));place(at+.12,tone(164.81,.3,.07,.006,.25))
        elif name in {'accept_changes','export_package','brand_land'}:
            for j,f in enumerate([523.25,659.25,783.99]):place(at+j*.09,tone(f,.55,.075,.004,.4),-.25+j*.25)
        else:
            x=np.arange(round(sr*.11))/sr;place(at,.065*np.sin(2*np.pi*980*x)*np.exp(-x*55),-.2 if i%2 else .2)
    for shot in SHOTS[1:]:
        x=np.arange(round(sr*.48))/sr;noise=rng.normal(0,1,len(x));smoothed=np.convolve(noise,np.ones(18)/18,mode='same')
        env=np.sin(np.pi*x/.48)**2;place(shot.start-.18,smoothed*env*.055,-.2)
    time=np.arange(n)/sr;fade=np.minimum(1,time/1.4)*np.minimum(1,(DURATION-time)/2)
    mix*=fade[:,None];mix=np.tanh(mix*1.3)*.72
    peak=float(np.max(np.abs(mix)));mix*=min(1,.88/max(peak,.0001))
    with wave.open(str(path),'wb') as w:
        w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes((mix*32767).astype('<i2').tobytes())
    return path
