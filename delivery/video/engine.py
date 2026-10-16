"""Tirlik motion engine adapted from the user-provided local video reference.
SDF materials, gradient type, perspective planes, independent A/B joins, bloom.
World units = pixels on the z=0 plane. x right, y up, z toward camera."""
from __future__ import annotations
import math, numpy as np, moderngl
from collections import OrderedDict
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[1]
FONTS = PROJECT / 'public/fonts/noto-sans'

# ---------- math -------------------------------------------------------------
def clamp(x, a=0., b=1.): return max(a, min(b, x))
def lerp(a, b, u): return a + (b - a) * u
def mixv(a, b, u): return tuple(lerp(x, y, u) for x, y in zip(a, b))
def sstep(a, b, x):
    u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u)
def e_io(x):   # smootherstep
    x = clamp(x); return x*x*x*(x*(x*6-15)+10)
def e_out(x):  # expo out
    x = clamp(x); return 1. if x >= 1 else 1 - 2 ** (-10 * x)
def e_in(x):
    x = clamp(x); return 0. if x <= 0 else 2 ** (10 * x - 10)
def e_cubic_out(x): x = clamp(x); return 1 - (1 - x) ** 3
def e_cubic_io(x):
    x = clamp(x); return 4*x*x*x if x < .5 else 1 - (-2*x+2)**3/2
def e_back(x, s=1.9):
    x = clamp(x); return 1 + (s+1)*(x-1)**3 + s*(x-1)**2
def spring(t, f=3.2, d=7.):
    """damped overshoot 0->1"""
    if t <= 0: return 0.
    return 1 - math.exp(-d*t) * math.cos(f*math.tau*t)
def seg(t, a, b): return clamp((t - a) / (b - a))
def hexc(c, a=1.):
    c = c.lstrip('#'); return (int(c[0:2],16)/255, int(c[2:4],16)/255, int(c[4:6],16)/255, a)
def rgba(c, a=None):
    if isinstance(c, str): c = hexc(c)
    c = tuple(c)
    if len(c) == 3: c = c + (1.,)
    return c if a is None else (c[0], c[1], c[2], a)

def mat(x=0, y=0, z=0, sx=1, sy=1, sz=1, rx=0, ry=0, rz=0):
    ax, ay, az = np.radians([rx, ry, rz])
    cx, sx_ = math.cos(ax), math.sin(ax); cy, sy_ = math.cos(ay), math.sin(ay); cz, sz_ = math.cos(az), math.sin(az)
    X = np.array([[1,0,0,0],[0,cx,-sx_,0],[0,sx_,cx,0],[0,0,0,1]], 'f4')
    Y = np.array([[cy,0,sy_,0],[0,1,0,0],[-sy_,0,cy,0],[0,0,0,1]], 'f4')
    Z = np.array([[cz,-sz_,0,0],[sz_,cz,0,0],[0,0,1,0],[0,0,0,1]], 'f4')
    T = np.eye(4, dtype='f4'); T[:3, 3] = [x, y, z]
    return T @ Z @ Y @ X @ np.diag([sx, sy, sz, 1]).astype('f4')

def perspective(fov, aspect, near=5, far=40000):
    f = 1 / math.tan(math.radians(fov) / 2)
    return np.array([[f/aspect,0,0,0],[0,f,0,0],[0,0,(far+near)/(near-far),2*far*near/(near-far)],[0,0,-1,0]], 'f4')

def look_at(eye, target, roll=0):
    e = np.asarray(eye, 'f4'); f = np.asarray(target, 'f4') - e; f /= np.linalg.norm(f) + 1e-9
    up = np.array([math.sin(math.radians(roll)), math.cos(math.radians(roll)), 0.], 'f4')
    if abs(np.dot(f, up)) > .999: up = np.array([0, 0, 1.], 'f4')
    s = np.cross(f, up); s /= np.linalg.norm(s); u = np.cross(s, f)
    v = np.eye(4, dtype='f4'); v[:3, :3] = np.stack([s, u, -f]); v[:3, 3] = -v[:3, :3] @ e
    return v

class Cam:
    FOV = 38.
    def __init__(self, eye=(0, 0, 1560), target=(0, 0, 0), roll=0., fov=None):
        self.eye = np.array(eye, 'f4'); self.target = np.array(target, 'f4'); self.roll = roll; self.fov = fov or self.FOV
    @staticmethod
    def orbit(target, dist, yaw=0, pitch=0, roll=0, fov=None):
        a, b = math.radians(yaw), math.radians(pitch); t = np.array(target, 'f4')
        eye = t + np.array([dist*math.sin(a)*math.cos(b), dist*math.sin(b), dist*math.cos(a)*math.cos(b)])
        return Cam(eye, t, roll, fov)
    @staticmethod
    def fit_dist(h=1080, fov=38.): return h / (2 * math.tan(math.radians(fov) / 2))

# ---------- text / image preparation ------------------------------------------
_fonts = {}
def font(size, weight='Medium'):
    k = (int(size), weight)
    if k not in _fonts: _fonts[k] = ImageFont.truetype(str(FONTS / f'NotoSans-{weight}.ttf'), int(size))
    return _fonts[k]

def text_metrics(s, size, weight='SemiBold', track=0.):
    f = font(size * 2, weight)
    return f.getlength(s) / 2 + track * size * len(s) * .0
def text_width(s, size, weight='SemiBold', track=0.):
    f = font(size * 2, weight); return f.getlength(s) / 2 + track * size * max(0, len(s) - 1)

def premult(arr):
    a = arr[..., 3:4].astype('f4') / 255.
    out = arr.copy(); out[..., :3] = (arr[..., :3].astype('f4') * a + .5).astype('u1'); return out

class Eng:
    def __init__(self, w=1920, h=1080):
        self.w, self.h = w, h
        try:
            self.ctx = moderngl.create_standalone_context(require=330)
        except Exception:
            self.ctx = moderngl.create_standalone_context(backend='egl', require=330)   # headless Linux (Mesa llvmpipe works)
        ctx = self.ctx
        self.tex_cache = OrderedDict(); self.tex_bytes = 0; self.max_bytes = 256 * 1024 * 1024
        self.img_cache = {}; self.text_cache = OrderedDict(); self.text_arrays = {}
        self._build_programs()
        self.quad = ctx.buffer(np.array([-.5,-.5, .5,-.5, -.5,.5, .5,.5], 'f4').tobytes())
        self.vao = ctx.vertex_array(self.p_obj, [(self.quad, '2f', 'p')])
        self.vao_bg = ctx.vertex_array(self.p_bg, [(self.quad, '2f', 'p')])
        self.vao_tr = ctx.vertex_array(self.p_tr, [(self.quad, '2f', 'p')])
        self.vao_post = ctx.vertex_array(self.p_post, [(self.quad, '2f', 'p')])
        self.vao_blur = ctx.vertex_array(self.p_blur, [(self.quad, '2f', 'p')])
        self.vao_bright = ctx.vertex_array(self.p_bright, [(self.quad, '2f', 'p')])
        def rt(w, h, mip=True):
            t = ctx.texture((w, h), 4); t.filter = (moderngl.LINEAR_MIPMAP_LINEAR if mip else moderngl.LINEAR, moderngl.LINEAR)
            t.repeat_x = t.repeat_y = False
            return t, ctx.framebuffer([t])
        self.rt = rt
        self.scene_t = [rt(w, h) for _ in range(2)]
        self.comp_t = rt(w, h)
        bw, bh = max(2, w // 4), max(2, h // 4)
        self.b1 = rt(bw, bh, False); self.b2 = rt(bw, bh, False); self.bsz = (bw, bh)
        self.out_t = ctx.texture((w, h), 3); self.out_f = ctx.framebuffer([self.out_t])
        self.dummy = ctx.texture((1, 1), 4, b'\0\0\0\0')
        self.frame_no = 0

    # ---- shaders -----------------------------------------------------------
    def _build_programs(self):
        c = self.ctx
        VS = '''#version 330
        in vec2 p; uniform mat4 mvp; uniform vec2 quad; out vec2 lp;
        void main(){ lp=p*quad; gl_Position=mvp*vec4(lp,0.,1.); }'''
        FS = '''#version 330
        in vec2 lp; out vec4 frag;
        uniform sampler2D tex; uniform int mode; uniform int tmode; uniform vec2 size; uniform float radius;
        uniform vec4 colA; uniform vec4 colB; uniform vec2 gdir; uniform float gofs; uniform float alpha;
        uniform vec4 crop; uniform vec2 wipe; uniform float blur; uniform float bw; uniform vec4 bcol;
        uniform float soft; uniform float hl; uniform vec2 ring; uniform float cfade;
        float sdRR(vec2 p, vec2 b, float r){ r=min(r,min(b.x,b.y)); vec2 q=abs(p)-b+r; return length(max(q,0.))+min(max(q.x,q.y),0.)-r; }
        vec4 samp(vec2 t){
          if(blur<=0.) return texture(tex,t);
          vec2 ts=vec2(textureSize(tex,0))*(crop.zw-crop.xy); float rt=blur*ts.x/size.x; float lod=clamp(log2(max(rt,1.)*.45),0.,9.);
          vec2 off=blur/size*(crop.zw-crop.xy); vec4 s=vec4(0.); float wsum=0.;
          for(int i=0;i<12;i++){ float a=float(i)*2.39996; float r=sqrt((float(i)+.5)/12.);
            float w=1.-.4*r; s+=textureLod(tex,t+vec2(cos(a),sin(a))*r*off,lod)*w; wsum+=w; }
          return s/wsum; }
        void main(){
          if(mode==0){
            vec2 q=lp/size+.5; vec2 t=mix(crop.xy,crop.zw,vec2(q.x,1.-q.y));
            vec4 c=samp(t); float m=1.;
            if(radius>0.){ float d=sdRR(lp,size*.5,radius); m=clamp(.5-d/max(fwidth(d),1e-4),0.,1.); }
            if(cfade>0.){ vec2 e=min(q,1.-q)*size; m*=clamp(min(e.x,e.y)/cfade,0.,1.); }
            if(wipe.x<1.){ float f=max(wipe.y,1e-3); m*=clamp((wipe.x*(1.+f)-q.x)/f,0.,1.); }
            if(tmode==1){ float g=clamp(dot(q-.5,gdir)+.5+gofs,0.,1.); vec3 col=mix(colA.rgb,colB.rgb,g); float a=c.a*mix(colA.a,colB.a,g);
              frag=vec4(col*a,a)*m*alpha; }
            else { frag=c*colA*m*alpha; }
          } else if(mode==1){
            float d=sdRR(lp,size*.5,radius); float aa=max(fwidth(d),1e-4);
            float fill=clamp(.5-d/aa,0.,1.);
            vec2 q=lp/size+.5;
            if(wipe.x<1.){ float f=max(wipe.y,1e-3); fill*=clamp((wipe.x*(1.+f)-q.x)/f,0.,1.); }
            float g=clamp(dot(lp/size,gdir)+.5+gofs,0.,1.);
            vec4 col=mix(colA,colB,g);
            if(hl>0.){ float top=clamp(.5-q.y+.5,0.,1.); col.rgb+=hl*vec3(1.)*(1.-smoothstep(0.,.9,q.y*-1.+1.))*.55; col.rgb=min(col.rgb,vec3(1.)); }
            vec4 o=vec4(col.rgb*col.a,col.a)*fill;
            if(bw>0.){ float ring_=clamp(.5-(abs(d+bw*.5)-bw*.5)/aa,0.,1.); 
              float bg_=clamp(dot(lp/size,gdir)+.5,0.,1.);
              o=o*(1.-ring_*bcol.a)+vec4(bcol.rgb*bcol.a,bcol.a)*ring_; }
            frag=o*alpha;
          } else if(mode==2){
            vec2 e=lp/(size*.5); float r=length(e); float a;
            if(ring.x>0.){ a=exp(-pow((r-ring.x)/ring.y,2.)); } else { a=exp(-r*r*ring.y); }
            a*=1.-smoothstep(.82,1.,r);
            vec4 col=mix(colA,colB,clamp(r,0.,1.)); frag=vec4(col.rgb*col.a,col.a)*a*alpha;
          } else {
            float d=sdRR(lp,size*.5,radius); float a=1.-smoothstep(-soft*.6,soft*1.3,d);
            frag=vec4(colA.rgb*colA.a,colA.a)*a*a*alpha;
          }
        }'''
        self.p_obj = c.program(vertex_shader=VS, fragment_shader=FS)
        # background: mesh gradient blobs
        self.p_bg = c.program(vertex_shader='''#version 330
        in vec2 p; out vec2 uv; void main(){ uv=p+.5; gl_Position=vec4(p*2.,0.,1.); }''', fragment_shader='''#version 330
        in vec2 uv; out vec4 frag; uniform vec3 top; uniform vec3 bot; uniform float aspect;
        uniform vec4 bl[10]; uniform vec3 bc[10]; uniform int nb; uniform vec4 arc; uniform vec3 arcc; uniform vec2 arcp;
        void main(){
          vec2 p=vec2((uv.x-.5)*aspect,uv.y-.5);
          vec3 col=mix(bot,top,uv.y);
          for(int i=0;i<10;i++){ if(i>=nb) break; vec2 c=vec2((bl[i].x-.5)*aspect,bl[i].y-.5); float r=bl[i].z; float d=length(p-c)/r;
            float a=exp(-d*d*2.2)*bl[i].w; col=mix(col,bc[i],clamp(a,0.,1.)); }
          if(arc.z>0.){ vec2 c=vec2((arc.x-.5)*aspect,arc.y-.5); float d=abs(length(p-c)-arc.z)/arc.w; float a=exp(-d*d)*arcp.x;
            col=mix(col,arcc,clamp(a,0.,1.)); }
          frag=vec4(col,1.); }''')
        # transition compositor
        self.p_tr = c.program(vertex_shader='''#version 330
        in vec2 p; out vec2 uv; void main(){ uv=p+.5; gl_Position=vec4(p*2.,0.,1.); }''', fragment_shader='''#version 330
        in vec2 uv; out vec4 frag; uniform sampler2D A; uniform sampler2D B; uniform int mode; uniform float k;
        uniform vec2 cen; uniform float aspect; uniform vec3 fcol; uniform float strength;
        vec3 sb(sampler2D T, vec2 u, float lod, float rad){
          if(rad<=.0005) return texture(T,u).rgb;
          vec3 s=vec3(0.); float ws=0.;
          for(int i=0;i<10;i++){ float a=float(i)*2.39996; float r=sqrt((float(i)+.5)/10.); float w=1.-.5*r;
            s+=textureLod(T,u+vec2(cos(a)/aspect,sin(a))*r*rad,lod).rgb*w; ws+=w; }
          return s/ws; }
        vec3 zb(sampler2D T, vec2 u, float amt){ // radial zoom blur toward cen
          if(amt<=.0005) return texture(T,u).rgb;
          vec3 s=vec3(0.); for(int i=0;i<8;i++){ float f=float(i)/7.; s+=texture(T,cen+(u-cen)*(1.-amt*f)).rgb; } return s/8.; }
        void main(){
          vec3 a,b;
          if(mode==0){ // zoom-through: A flies toward cam & blurs, B settles from small
            float e=k;
            float sa=1.+e*e*strength; vec2 ua=cen+(uv-cen)/sa;
            float sb_=mix(.62,1.,e); vec2 ub=cen+(uv-cen)/sb_;
            a=zb(A,ua,clamp(e*.55,0.,.5)); b=zb(B,ub,clamp((1.-e)*.35,0.,.35));
            float m=smoothstep(.30,.78,k); frag=vec4(mix(a,b,m),1.);
          } else if(mode==1){ // slide with motion blur
            float off=strength*k; vec2 ua=uv+vec2(off,0.); vec2 ub=uv+vec2(off-strength,0.);
            vec3 sa=vec3(0.),sb2=vec3(0.); float bl=.05*sin(3.14159*k)*abs(strength);
            for(int i=0;i<8;i++){ float f=float(i)/7.-.5; sa+=texture(A,ua+vec2(f*bl,0.)).rgb; sb2+=texture(B,ub+vec2(f*bl,0.)).rgb; }
            sa/=8.; sb2/=8.;
            float edge=strength>0.?(uv.x+off):(1.+uv.x+off);
            float m=strength>0.?step(1.,uv.x+off):step(uv.x+off,0.);
            frag=vec4(m>.5?sb2:sa,1.);
          } else if(mode==2){ // radial reveal from cen, soft edge + glow
            vec2 d=vec2((uv.x-cen.x)*aspect,uv.y-cen.y); float r=length(d); float R=k*(strength);
            float m=1.-smoothstep(R-.06,R+.02,r);
            vec3 av=sb(A,uv,1.,.004*k); vec3 bv=texture(B,uv).rgb;
            float rim=exp(-pow((r-R)/.05,2.))*(1.-k*.6);
            frag=vec4(mix(av,bv,m)+fcol*rim*.55,1.);
          } else if(mode==3){ // glow flash through colour
            a=sb(A,uv,1.,.01*k); b=sb(B,uv,1.,.01*(1.-k)); float m=smoothstep(.35,.65,k);
            float f=exp(-pow((k-.5)/.18,2.)); frag=vec4(mix(a,b,m)+fcol*f*.7,1.);
          } else { // plain cross-dissolve with light blur
            a=sb(A,uv,1.,.006*k); b=sb(B,uv,1.,.006*(1.-k)); frag=vec4(mix(a,b,k),1.);
          } }''')
        # bright pass -> small
        self.p_bright = c.program(vertex_shader='''#version 330
        in vec2 p; out vec2 uv; void main(){ uv=p+.5; gl_Position=vec4(p*2.,0.,1.); }''', fragment_shader='''#version 330
        in vec2 uv; out vec4 frag; uniform sampler2D T; uniform float thr;
        void main(){ vec3 s=vec3(0.); for(int i=0;i<4;i++){ vec2 o=vec2(i%2-.5,i/2-.5)*.004; s+=textureLod(T,uv+o,2.).rgb; } s/=4.;
          float l=max(s.r,max(s.g,s.b)); float k=smoothstep(thr,thr+.35,l); frag=vec4(s*k,1.); }''')
        self.p_blur = c.program(vertex_shader='''#version 330
        in vec2 p; out vec2 uv; void main(){ uv=p+.5; gl_Position=vec4(p*2.,0.,1.); }''', fragment_shader='''#version 330
        in vec2 uv; out vec4 frag; uniform sampler2D T; uniform vec2 dir;
        void main(){ vec3 s=texture(T,uv).rgb*.2270;
          s+=(texture(T,uv+dir*1.3846).rgb+texture(T,uv-dir*1.3846).rgb)*.3162;
          s+=(texture(T,uv+dir*3.2308).rgb+texture(T,uv-dir*3.2308).rgb)*.0703;
          frag=vec4(s,1.); }''')
        self.p_post = c.program(vertex_shader='''#version 330
        in vec2 p; out vec2 uv; void main(){ uv=p+.5; gl_Position=vec4(p*2.,0.,1.); }''', fragment_shader='''#version 330
        in vec2 uv; out vec4 frag; uniform sampler2D S; uniform sampler2D G; uniform float glow; uniform float vign;
        uniform float grain; uniform float seed; uniform float blurAmt; uniform vec3 fcol; uniform float fade;
        uniform float aspect; uniform float ca; uniform vec3 tint; uniform float wb;
        float hash(vec2 p){ p=fract(p*vec2(443.897,441.423)); p+=dot(p,p+19.19); return fract(p.x*p.y); }
        vec3 get(vec2 u){
          if(blurAmt<=.002) return texture(S,u).rgb;
          vec3 s=vec3(0.); float ws=0.; float lod=clamp(log2(blurAmt*400.),0.,6.);
          for(int i=0;i<12;i++){ float a=float(i)*2.39996; float r=sqrt((float(i)+.5)/12.);
            s+=textureLod(S,u+vec2(cos(a)/aspect,sin(a))*r*blurAmt,lod).rgb; ws+=1.; }
          return s/ws; }
        void main(){
          vec2 c=uv-.5; vec3 col;
          if(ca>0.){ col=vec3(get(uv+c*ca).r,get(uv).g,get(uv-c*ca).b); } else col=get(uv);
          vec3 g=texture(G,uv).rgb; col=1.-(1.-col)*(1.-g*glow);
          float v=dot(c*vec2(aspect*.62,1.),c*vec2(aspect*.62,1.)); col*=1.-vign*smoothstep(.12,.85,v);
          col=mix(col,fcol,fade);
          float n=hash(uv*vec2(1920.,1080.)+seed)-.5; col+=n*(grain+1./255.);
          frag=vec4(clamp(col,0.,1.),1.); }''')

    # ---- textures ----------------------------------------------------------
    def image_array(self, key):
        if key not in self.img_cache:
            if isinstance(key, str):
                im = Image.open(key if Path(key).is_absolute() else ROOT / key).convert('RGBA')
            else: im = key
            self.img_cache[key] = (np.ascontiguousarray(premult(np.asarray(im))), im.size)
            while sum(a.nbytes for a, _ in self.img_cache.values()) > 160 * 1024 * 1024 and len(self.img_cache) > 8:
                self.img_cache.pop(next(iter(self.img_cache)))
        return self.img_cache[key]

    def img_size(self, key): return self.image_array(key)[1]

    def tex(self, key, arr=None):
        if key in self.tex_cache:
            self.tex_cache.move_to_end(key); return self.tex_cache[key]
        if arr is None: arr, size = self.image_array(key)
        h, w = arr.shape[:2]
        t = self.ctx.texture((w, h), 4, arr.tobytes()); t.build_mipmaps(); t.filter = (moderngl.LINEAR_MIPMAP_LINEAR, moderngl.LINEAR); t.anisotropy = 8.
        self.tex_cache[key] = t; self.tex_bytes += w * h * 5
        while self.tex_bytes > self.max_bytes and len(self.tex_cache) > 4:
            _, old = self.tex_cache.popitem(last=False); self.tex_bytes -= old.width * old.height * 5; old.release()
        return t

    def text_tex(self, s, size, weight='SemiBold', track=0.):
        """white text on transparent; returns (key, w, h, pad, ascent) in 1x px. Rendered at 2x."""
        key = ('txt', s, int(size), weight, round(track, 4))
        if key not in self.text_cache:
            ss = 2; f = font(size * ss, weight); asc, desc = f.getmetrics(); pad = int(size * .28)
            w1 = f.getlength(s) + track * size * ss * max(0, len(s) - 1)
            W = int(math.ceil(w1)) + 2 * pad * ss; Hh = asc + desc + 2 * pad * ss
            im = Image.new('RGBA', (W, Hh), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
            if track == 0: d.text((pad * ss, pad * ss), s, font=f, fill=(255, 255, 255, 255))
            else:
                x = pad * ss
                for i, ch in enumerate(s):
                    d.text((x, pad * ss), ch, font=f, fill=(255, 255, 255, 255)); x += f.getlength(s[:i+1]) - f.getlength(s[:i]) + track * size * ss
            self.text_cache[key] = (im, W / ss, Hh / ss, pad, asc / ss, w1 / ss)
            while len(self.text_cache) > 600: self.text_cache.popitem(last=False)
        im, W, Hh, pad, asc, w1 = self.text_cache[key]
        return key, im, W, Hh, pad, asc, w1

    # ---- frame building ------------------------------------------------------
    def project(self, cam: Cam, pt):
        pv = perspective(cam.fov, self.w / self.h) @ look_at(cam.eye, cam.target, cam.roll)
        v = pv @ np.array([*pt[:3], 1.], 'f4')
        return np.array([(v[0] / v[3]) * 540. * self.w / self.h, (v[1] / v[3]) * 540., v[3]])  # centered 1080-units, y up

    def draw_scene(self, sc, idx=0):
        t, f = self.scene_t[idx]
        f.use(); self.ctx.viewport = (0, 0, self.w, self.h); self.ctx.disable(moderngl.DEPTH_TEST)
        self.ctx.disable(moderngl.BLEND)
        bg = sc.bg
        P = self.p_bg
        P['top'].value = bg['top'][:3]; P['bot'].value = bg['bot'][:3]; P['aspect'].value = self.w / self.h
        bl = bg.get('blobs', [])[:10]; nb = len(bl)
        arr = np.zeros((10, 4), 'f4'); cols = np.zeros((10, 3), 'f4')
        for i, b in enumerate(bl): arr[i] = (b[0], b[1], b[2], b[3]); cols[i] = rgba(b[4])[:3]
        P['bl'].write(arr.tobytes()); P['bc'].write(cols.tobytes()); P['nb'].value = nb
        a = bg.get('arc'); 
        if a: P['arc'].value = (a[0], a[1], a[2], a[3]); P['arcc'].value = rgba(a[4])[:3]; P['arcp'].value = (a[5], 0.)
        else: P['arc'].value = (0, 0, 0, 1); P['arcc'].value = (0, 0, 0); P['arcp'].value = (0, 0)
        self.vao_bg.render(moderngl.TRIANGLE_STRIP)
        self.ctx.enable(moderngl.BLEND)
        cam = sc.cam; view = look_at(cam.eye, cam.target, cam.roll)
        pv = perspective(cam.fov, self.w / self.h) @ view
        ortho = np.diag([2 / (1080. * self.w / self.h), 2 / 1080., 0.0004, 1]).astype('f4')
        def depth(o):
            m = o['sortm'] if o['sortm'] is not None else o['model']
            return float((view @ np.array([m[0, 3], m[1, 3], m[2, 3], 1.], 'f4'))[2])
        under = [o for o in sc.items if o['space'] == 'u']
        world = [o for o in sc.items if o['space'] == 'w']
        over = [o for o in sc.items if o['space'] == 's']
        world.sort(key=lambda o: (round(depth(o), 3), o['seq']))
        for group, M in ((under, ortho), (world, pv), (over, ortho)):
            for o in group: self._draw(o, M)
        return t

    def _draw(self, o, M):
        P = self.p_obj; ctx = self.ctx
        if o['alpha'] <= .002: return
        sz = o['size']; pad = o['pad']
        P['mvp'].write((M @ o['model']).T.astype('f4').tobytes())
        P['quad'].value = (sz[0] + 2 * pad, sz[1] + 2 * pad); P['size'].value = sz
        P['mode'].value = o['mode']; P['tmode'].value = o['tmode']; P['radius'].value = o['radius']
        P['colA'].value = o['colA']; P['colB'].value = o['colB']; P['gdir'].value = o['gdir']; P['gofs'].value = o['gofs']
        P['alpha'].value = o['alpha']; P['crop'].value = o['crop']; P['wipe'].value = o['wipe']; P['blur'].value = o['blur']
        P['bw'].value = o['bw']; P['bcol'].value = o['bcol']; P['soft'].value = o['soft']; P['hl'].value = o['hl']
        P['ring'].value = o['ring']; P['cfade'].value = o['cfade']
        if o['blend'] == 'add': ctx.blend_func = (moderngl.ONE, moderngl.ONE)
        else: ctx.blend_func = (moderngl.ONE, moderngl.ONE_MINUS_SRC_ALPHA)
        if o['mode'] == 0:
            t = self.tex(o['key'], o.get('arr')); t.use(0); P['tex'].value = 0
        self.vao.render(moderngl.TRIANGLE_STRIP)

    def finish(self, frames, post):
        """frames: list of Scene (1 or 2), post: dict of post params, returns bytes."""
        ctx = self.ctx; ctx.disable(moderngl.BLEND)
        ts = []
        for i, sc in enumerate(frames):
            t = self.draw_scene(sc, i); t.build_mipmaps(); ts.append(t)
        ctx.disable(moderngl.BLEND)
        tr = post.get('tr')
        if len(ts) == 2 and tr:
            ct, cf = self.comp_t; cf.use(); ctx.viewport = (0, 0, self.w, self.h)
            P = self.p_tr; ts[0].use(0); ts[1].use(1); P['A'].value = 0; P['B'].value = 1
            P['mode'].value = tr['mode']; P['k'].value = tr['k']; P['cen'].value = tr.get('cen', (.5, .5))
            P['aspect'].value = self.w / self.h; P['fcol'].value = tuple(tr.get('fcol', (1, 1, 1))); P['strength'].value = tr.get('strength', 3.)
            self.vao_tr.render(moderngl.TRIANGLE_STRIP); ct.build_mipmaps(); src = ct
        else:
            src = ts[0]
        # bloom
        gl = post.get('glow', .5)
        b1t, b1f = self.b1; b2t, b2f = self.b2
        b1f.use(); ctx.viewport = (0, 0, *self.bsz); src.use(0); self.p_bright['T'].value = 0; self.p_bright['thr'].value = post.get('thr', .62)
        self.vao_bright.render(moderngl.TRIANGLE_STRIP)
        for _ in range(2):
            b2f.use(); b1t.use(0); self.p_blur['T'].value = 0; self.p_blur['dir'].value = (1.6 / self.bsz[0], 0); self.vao_blur.render(moderngl.TRIANGLE_STRIP)
            b1f.use(); b2t.use(0); self.p_blur['dir'].value = (0, 1.6 / self.bsz[1]); self.vao_blur.render(moderngl.TRIANGLE_STRIP)
        self.out_f.use(); ctx.viewport = (0, 0, self.w, self.h)
        P = self.p_post; src.use(0); b1t.use(1); P['S'].value = 0; P['G'].value = 1
        P['glow'].value = gl; P['vign'].value = post.get('vign', .22); P['grain'].value = post.get('grain', .012)
        # Random-access frames must not change when a different range rendered first.
        P['seed'].value = float(post.get('frame', 0) % 97); P['blurAmt'].value = post.get('blur', 0.); P['fcol'].value = tuple(post.get('fcol', (1, 1, 1)))
        P['fade'].value = post.get('fade', 0.); P['aspect'].value = self.w / self.h; P['ca'].value = post.get('ca', 0.)
        self.vao_post.render(moderngl.TRIANGLE_STRIP)
        self.frame_no += 1
        return self.out_f.read(components=3, alignment=1)

# ---------- scene builder ---------------------------------------------------
def rect_crop(key_size, rect, pad=0):
    iw, ih = key_size; x, y, w, h = rect
    return (max(0, (x - pad) / iw), max(0, (y - pad) / ih), min(1, (x + w + pad) / iw), min(1, (y + h + pad) / ih))

class Scene:
    def __init__(self, eng: Eng, cam: Cam | None = None, bg=None):
        self.eng = eng; self.cam = cam or Cam((0, 0, Cam.fit_dist(eng.h)), (0, 0, 0)); self.items = []; self.seq = 0
        self.bg = bg or dict(top=(1, 1, 1), bot=(1, 1, 1), blobs=[])

    def _o(self, **kw):
        base = dict(mode=0, tmode=0, key=None, model=np.eye(4, dtype='f4'), size=(1, 1), pad=0, radius=0., colA=(1, 1, 1, 1), colB=(1, 1, 1, 1),
                    gdir=(1., 0.), gofs=0., alpha=1., crop=(0., 0., 1., 1.), wipe=(2., .1), blur=0., bw=0., bcol=(0, 0, 0, 0), soft=0., hl=0.,
                    ring=(0., 3.), cfade=0., blend='over', space='w', sortm=None, seq=self.seq)
        base.update(kw); self.seq += 1; self.items.append(base); return base

    def _model(self, pos, rot, scale, parent):
        sx, sy = (scale, scale) if np.isscalar(scale) else scale
        m = mat(pos[0], pos[1], pos[2] if len(pos) > 2 else 0, sx, sy, 1, *rot)
        sm = None
        if parent is not None: m = parent @ m; sm = parent
        return m, sm

    def image(self, key, pos=(0, 0, 0), w=None, h=None, rot=(0, 0, 0), scale=1, alpha=1., radius=0., blur=0., crop=(0, 0, 1, 1), wipe=(2., .1),
              tint=(1, 1, 1, 1), parent=None, space='w', blend='over', cfade=0., arr=None, sortm='auto'):
        iw, ih = self.eng.img_size(key) if arr is None else (arr.shape[1], arr.shape[0])
        cw, ch = iw * (crop[2] - crop[0]), ih * (crop[3] - crop[1])
        w = cw if w is None else w; h = ch * (w / cw) if h is None else h
        m, sm = self._model(pos, rot, scale, parent)
        return self._o(mode=0, tmode=0, key=key, arr=arr, model=m, sortm=sm, size=(w, h), alpha=alpha, radius=radius, blur=blur, crop=crop, wipe=wipe,
                       colA=rgba(tint), space=space, blend=blend, cfade=cfade, pad=0)

    def text(self, s, pos=(0, 0, 0), size=80, weight='SemiBold', colors=('#FFFFFF', None), gdir=(1., 0.), gofs=0., track=0., anchor='c', alpha=1., blur=0.,
             rot=(0, 0, 0), scale=1, wipe=(2., .12), parent=None, space='w', vshift=0., blend='over', sortm='auto'):
        if size < 1.5 or not s: return None
        key, im, W, Hh, pad, asc, w1 = self.eng.text_tex(s, size, weight, track)
        ca = rgba(colors[0]); cb = rgba(colors[1]) if colors[1] is not None else ca
        sc_ = scale; x, y = pos[0], pos[1]
        if anchor == 'l': x += (W / 2 - pad) * sc_
        elif anchor == 'r': x -= (W / 2 - pad) * sc_
        y += (-vshift) * sc_
        m, sm = self._model((x, y, pos[2] if len(pos) > 2 else 0), rot, 1, parent)
        # scale about anchor: build model with scale at the anchor point
        if scale != 1:
            ax = {'l': pos[0], 'r': pos[0], 'c': pos[0]}[anchor]
            m, sm = self._model((pos[0], pos[1] + (-vshift) * sc_, pos[2] if len(pos) > 2 else 0), rot, scale, parent)
            off = {'l': (W / 2 - pad), 'r': -(W / 2 - pad), 'c': 0}[anchor]
            m = m @ mat(off, 0, 0)
        if key not in self.eng.text_arrays:
            self.eng.text_arrays[key] = np.ascontiguousarray(premult(np.asarray(im)))
        return self._o(mode=0, tmode=1, key=key, arr=self.eng.text_arrays[key], model=m, sortm=sm, size=(W, Hh), colA=ca, colB=cb, gdir=gdir, gofs=gofs,
                       alpha=alpha, blur=blur, wipe=wipe, space=space, blend=blend)

    def box(self, pos=(0, 0, 0), w=100, h=100, radius=None, colA='#FFFFFF', colB=None, gdir=(0., -1.), gofs=0., alpha=1., border=None, hl=0., rot=(0, 0, 0), scale=1,
            wipe=(2., .1), parent=None, space='w', blend='over', pad=2.):
        radius = min(w, h) / 2 if radius is None else radius
        a = rgba(colA); b = rgba(colB) if colB is not None else a
        m, sm = self._model(pos, rot, scale, parent)
        bw, bc = (border[1], rgba(border[0])) if border else (0., (0, 0, 0, 0))
        return self._o(mode=1, model=m, sortm=sm, size=(w, h), pad=pad + bw, radius=radius, colA=a, colB=b, gdir=gdir, gofs=gofs, alpha=alpha, bw=bw, bcol=bc, hl=hl,
                       wipe=wipe, space=space, blend=blend)

    def glow(self, pos=(0, 0, 0), w=300, h=None, colA='#FFFFFF', colB=None, alpha=1., ring=None, k=2.6, rot=(0, 0, 0), parent=None, space='w', blend='add'):
        h = w if h is None else h
        a = rgba(colA); b = rgba(colB) if colB is not None else (a[0], a[1], a[2], 0.)
        m, sm = self._model(pos, rot, 1, parent)
        return self._o(mode=2, model=m, sortm=sm, size=(w, h), colA=a, colB=b, alpha=alpha, ring=(ring[0], ring[1]) if ring else (0., k), space=space, blend=blend)

    def shadow(self, pos=(0, 0, 0), w=100, h=100, radius=24, soft=40, alpha=.3, color=(0, .05, .03, 1), rot=(0, 0, 0), parent=None, space='w'):
        m, sm = self._model(pos, rot, 1, parent)
        return self._o(mode=3, model=m, sortm=sm, size=(w, h), pad=soft * 1.6 + 4, radius=radius, colA=rgba(color), alpha=alpha, soft=soft, space=space)

    def card(self, key, pos=(0, 0, 0), w=None, rot=(0, 0, 0), scale=1, alpha=1., radius=26, blur=0., crop=(0, 0, 1, 1), parent=None, shadow=.35, soft=60,
             border=None, space='w', sy=None, wipe=(2., .1), dy_shadow=26):
        """image with rounded corners + drop shadow, as one group"""
        iw, ih = self.eng.img_size(key); cw, ch = iw * (crop[2] - crop[0]), ih * (crop[3] - crop[1]); w = cw if w is None else w; h = ch * w / cw
        m, sm = self._model(pos, rot, scale, parent)
        if shadow > 0:
            self._o(mode=3, model=m @ mat(0, -dy_shadow, -1), sortm=sm if sm is not None else m, size=(w, h), pad=soft * 1.6 + 4, radius=radius, colA=(0, .04, .03, 1), alpha=shadow * alpha, soft=soft, space=space)
        o = self._o(mode=0, tmode=0, key=key, model=m, sortm=sm if sm is not None else m, size=(w, h), alpha=alpha, radius=radius, blur=blur, crop=crop, wipe=wipe, space=space)
        if border:
            self._o(mode=1, model=m @ mat(0, 0, .5), sortm=sm if sm is not None else m, size=(w, h), pad=border[1] + 2, radius=radius, colA=(0, 0, 0, 0), colB=(0, 0, 0, 0), bw=border[1], bcol=rgba(border[0]), alpha=alpha, space=space)
        return m
