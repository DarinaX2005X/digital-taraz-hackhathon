"""Editable native Tirlik film: functional objects, camera paths and A/B joins.

Authored illustration, not a recording or invented screenshot of the live app.
"""
from dataclasses import dataclass
from functools import lru_cache
import math
import numpy as np
from PIL import Image, ImageDraw
from scipy.interpolate import PchipInterpolator
from engine import Cam, Scene, clamp, e_io, e_out, hexc, lerp, mat, premult, rgba, text_width

FPS=60
DURATION=104
D0=Cam.fit_dist(1080)
INK='#17332E';GREEN='#086A60';TEAL='#218B78';MINT='#DDEFE6'
PAPER='#F3F6F4';CORAL='#E48068';YELLOW='#F5D890';WHITE='#FFFFFF'

@dataclass(frozen=True)
class Shot:
    id:str
    start:float
    end:float
    reading:tuple[float,float]
    caption:str

SHOTS=(
    Shot('brand',0,3,(1.4,2.5),'Tirlik. Всё для вашего бизнеса.'),
    Shot('promise',3,8,(5.7,7.4),'Поставьте задачу. Получите рабочие материалы.'),
    Shot('task',8,15,(11.4,14.3),'Начните с цели и добавьте исходные материалы. Tirlik использует контекст вашей работы.'),
    Shot('mechanism',15,21,(18.2,20.4),'Проверка данных, условия и решение ведут к новым редактируемым материалам.'),
    Shot('documents',21,29,(25.1,28.3),'Предложения и документы можно продолжать редактировать, сохраняя ручные правки.'),
    Shot('sheets',29,37,(33,36.3),'Сметы и расчёты остаются в таблицах с формулами и связанными данными.'),
    Shot('design',37,46,(41.3,45.3),'Рекламные материалы состоят из редактируемых слоёв и адаптируются к разным форматам.'),
    Shot('operations',46,54,(50,53.3),'Планы работы учитывают сроки, зависимости и загрузку.'),
    Shot('procurement',54,62,(58,61.3),'Закупки сопоставляют упаковку, доставку, оплату и другие условия поставщиков.'),
    Shot('finance',62,70,(66,69.3),'Финансы и прогноз помогают сравнивать сценарии и видеть условия расчёта.'),
    Shot('connected',70,78,(74,77.3),'Связанные изменения можно проверить и принять вместе. Ручные правки сохраняются.'),
    Shot('package',78,85,(81.2,84.3),'Готовые версии передаются пакетом DOCX и XLSX. Исходники остаются в работе.'),
    Shot('team',85,91,(88,90.3),'В проекте сохраняются контекст и роли команды.'),
    Shot('recurring',91,96,(93.5,95.4),'Повторяющиеся задачи продолжаются с проверкой изменений нового периода.'),
    Shot('finale',96,104,(100,103.9),'Tirlik. Всё для вашего бизнеса. Откройте пример на tirlik.vercel.app.'),
)

@dataclass(frozen=True)
class Join:
    left:str
    right:str
    start:float
    end:float
    mode:int
    center:tuple[float,float]=(.5,.5)
    strength:float=1.

JOINS=(
    Join('brand','promise',2.72,3.28,0,strength=3.4),
    Join('promise','task',7.65,8.35,0,strength=2.3),
    Join('task','mechanism',14.70,15.30,2,(.72,.47),2.2),
    Join('mechanism','documents',20.72,21.28,1,strength=1),
    Join('documents','sheets',28.70,29.30,1,strength=-1),
    Join('sheets','design',36.67,37.33,0,(.6,.5),2),
    Join('design','operations',45.70,46.30,1,strength=1),
    Join('operations','procurement',53.72,54.28,2,(.75,.5),2.2),
    Join('procurement','finance',61.70,62.30,1,strength=-1),
    Join('finance','connected',69.72,70.28,0,(.6,.5),1.9),
    Join('connected','package',77.72,78.28,2,(.65,.4),2.2),
    Join('package','team',84.72,85.28,1,strength=1),
    Join('team','recurring',90.72,91.28,1,strength=-1),
    Join('recurring','finale',95.68,96.32,0,strength=2.5),
)
EVENTS={'brand_assemble':.92,'promise_words':4.3,'task_inputs':10.6,'mechanism_flow':17.1,'document_edit':24.4,'sheet_formula':32.3,'design_layers':40.4,'plan_dependency':49.1,'supplier_unknown':57.6,'forecast_scenario':65.3,'accept_changes':73.7,'export_package':80.7,'team_context':87.5,'period_difference':92.7,'brand_land':99.5}

def seg(t,a,b):return clamp((t-a)/(b-a))

class CameraPath:
    """Shape-preserving path: time, x, y, z, zoom, yaw, pitch, roll."""
    def __init__(self,knots):
        self.ts=np.asarray([v[0] for v in knots]);self.curve=PchipInterpolator(self.ts,np.asarray([v[1:] for v in knots]),axis=0)
    def at(self,t):
        v=self.curve(np.clip(t,self.ts[0],self.ts[-1]))
        return Cam.orbit(v[:3],D0/max(v[3],.1),v[4],v[5],v[6])

def background(t,dark=False,vivid=False):
    if dark:return dict(top=hexc('#163E34'),bot=hexc('#08211B'),blobs=[(.18,.62,.65,.36,'#2E8D72'),(.82,.35,.55,.30,'#10594D'),(.55,.95,.5,.16,CORAL)])
    if vivid:return dict(top=hexc('#138E75'),bot=hexc('#063B31'),blobs=[(.4+.025*math.sin(t),.6,.7,.65,'#36B992'),(.86,.72,.45,.24,YELLOW),(.1,.14,.4,.45,'#0D5447')])
    return dict(top=hexc('#F8FBF7'),bot=hexc('#E7F1E9'),blobs=[(.15+.04*math.sin(t*.3),.7,.65,.55,'#B7DBC0'),(.85,.3,.6,.48,'#A8DACA'),(.55,.95,.45,.35,'#F1D5C1')])

def post(dark=False):return dict(glow=.16 if dark else .08,thr=.88,vign=.12 if dark else .025,grain=.001,ca=0.)

def kinetic(sc,words,t,start,y=0,size=120,color=INK,center=0,stagger=.14,z=0,space='w',alpha=1):
    widths=[text_width(w,size,'SemiBold',-.02) for w in words];gap=size*.24;left=center-(sum(widths)+gap*(len(words)-1))/2
    for i,(word,width) in enumerate(zip(words,widths)):
        u=seg(t,start+i*stagger,start+i*stagger+.65);k=e_out(u)
        if u>0:sc.text(word,(left+width/2+65*(1-k),y-28*(1-k),z),size,'SemiBold',colors=(color,TEAL if color==INK else MINT),alpha=alpha*clamp(u*3),blur=22*(1-k)**1.5,track=-.02,space=space)
        left+=width+gap

def satellites(sc,t,dark=False):
    for i,(x,y,z,w) in enumerate([(-760,330,-380,180),(880,-290,-260,220),(-1100,-250,-520,120),(1160,210,-470,170)]):
        sc.box((x,y+12*math.sin(t*.8+i),z),w,40,20,rgba(MINT,.09 if dark else .42),rgba(WHITE,.06 if dark else .65),border=(rgba(WHITE,.15 if dark else .7),1.4))

@lru_cache(maxsize=8)
def icon(kind):
    im=Image.new('RGBA',(512,600),(0,0,0,0));d=ImageDraw.Draw(im)
    d.rounded_rectangle((55,30,457,565),28,fill=WHITE,outline='#C5D2CA',width=3)
    if kind=='document':
        d.rectangle((90,70,420,155),fill=MINT)
        for i,w in enumerate([285,315,240,300,215]):d.rounded_rectangle((95,215+i*49,95+w,227+i*49),6,fill=GREEN if i==0 else '#B7CEC0')
    elif kind=='sheet':
        for row in range(6):
            for col in range(3):
                x=90+col*110;y=89+row*68;d.rectangle((x,y,x+110,y+68),fill=MINT if row==0 else WHITE,outline='#B7CEC0',width=2)
        d.rounded_rectangle((309,428,418,496),6,fill=GREEN)
    elif kind=='design':
        d.rounded_rectangle((88,70,424,520),10,fill=YELLOW);d.ellipse((180,250,520,590),fill=CORAL);d.rectangle((88,330,423,385),fill=GREEN)
        for y,w in [(120,250),(161,205)]:d.rounded_rectangle((115,y,115+w,y+22),7,fill=INK)
    else:
        for i,(x,w,c) in enumerate([(98,200,GREEN),(175,210,'#6DAF93'),(125,280,CORAL),(280,120,TEAL)]):
            y=126+i*92;d.rounded_rectangle((x,y,x+w,y+54),12,fill=c)
    return im

@lru_cache(maxsize=1)
def mark():
    im=Image.new('RGBA',(480,480),(0,0,0,0));d=ImageDraw.Draw(im)
    d.rounded_rectangle((4,4,476,476),56,fill=WHITE,outline='#C5D2CA',width=4)
    d.rounded_rectangle((88,110,382,202),24,fill=GREEN);d.rounded_rectangle((184,160,276,386),24,fill=GREEN)
    d.rounded_rectangle((312,238,382,308),14,fill=CORAL);d.line((228,110,228,202),fill=WHITE,width=16)
    return im

PIXELS={}
def texture(sc,im,key,pos,w,**kwargs):
    if key not in PIXELS:PIXELS[key]=np.ascontiguousarray(premult(np.asarray(im)))
    return sc.image(key,pos,w=w,arr=PIXELS[key],**kwargs)

def paper(sc,m,w,h,alpha=1):
    sc.shadow((0,-25,-3),w,h,23,55,.26*alpha,parent=m)
    sc.box((0,0,0),w,h,23,WHITE,'#F4F8F5',border=(rgba(WHITE,.9),2),parent=m,alpha=alpha)

def line(sc,a,b,width=4,color=GREEN,alpha=1,z=0,parent=None):
    dx=b[0]-a[0];dy=b[1]-a[1];length=math.hypot(dx,dy)
    if length>.1:sc.box(((a[0]+b[0])/2,(a[1]+b[1])/2,z),length,width,width/2,color,rot=(0,0,math.degrees(math.atan2(dy,dx))),alpha=alpha,parent=parent,pad=2)

def title(sc,words,t,color=INK,until=2.8,y=445,size=70):
    fade=1-e_io(seg(t,until-.6,until))
    if fade>0:kinetic(sc,words,t,.1,y=y,size=size,color=color,space='s',alpha=fade)

def shot_brand(E,t):
    z=1+3*e_io(seg(t,2.3,3.3));sc=Scene(E,Cam.orbit((0,0,0),D0/z),background(t,True));satellites(sc,t,True)
    a=e_out(seg(t,.05,.95));shift=e_io(seg(t,.8,1.6))
    texture(sc,mark(),'tirlik-mark',(-245*shift,-100*(1-a),0),260,rot=(0,18*(1-a),-12*(1-a)),alpha=clamp(a*2),blur=25*(1-a),scale=.7+.3*a)
    u=seg(t,.92,1.7)
    if u>0:sc.text('Tirlik',(10,0,0),168,'SemiBold',colors=(WHITE,MINT),anchor='l',alpha=clamp(u*3),wipe=(u*1.5,.2),blur=15*(1-e_out(u)),track=-.035)
    return sc,post(True)

def shot_promise(E,t):
    cam=CameraPath([(0,-820,0,0,1.2,3,1,0),(1,-520,0,0,1.15,-2,0,0),(2,450,0,0,1.15,2,0,0),(3.5,1050,0,0,1.18,0,0,0),(5,1100,0,0,1.7,0,0,0)]).at(t)
    sc=Scene(E,cam,background(t))
    for i,(word,x) in enumerate(zip(['Задача.','Решение.','Материалы.'],[-820,0,1080])):
        u=seg(t,.05+i*.65,.75+i*.65)
        fade=1-e_io(seg(t,1.4+i*.65,2.1+i*.65)) if i<2 else 1
        if u>0:sc.text(word,(x+65*(1-e_out(u)),0,0),170,'SemiBold',colors=(INK,GREEN),alpha=clamp(u*3)*fade,blur=25*(1-e_out(u))**1.5,track=-.03)
    for i,kind in enumerate(['document','sheet','design']):
        u=e_out(seg(t,2.5+i*.15,3.3+i*.15))
        if u>0:texture(sc,icon(kind),'icon-'+kind,(850+i*205,220+80*(1-u),70-i*60),130,alpha=u,rot=(0,(i-1)*12,(i-1)*-7))
    return sc,post()

def shot_task(E,t):
    cam=CameraPath([(0,-180,20,0,.9,-11,5,2),(1.5,0,0,0,1,4,2,-1),(4,0,0,0,1.05,0,0,0),(7,180,0,0,1.2,0,0,0)]).at(t)
    sc=Scene(E,cam,background(t,True));satellites(sc,t,True)
    kinetic(sc,['Что','нужно','сделать?'],t,.15,y=300,size=105,color=WHITE)
    m=mat(0,35,0,1,1,1,0,-3,0);a=e_out(seg(t,.5,1.4))
    sc.box((0,0,0),1260,165,30,rgba(WHITE,.10),rgba(MINT,.16),border=(rgba(MINT,.5),2),alpha=a,parent=m)
    sc.text('Подготовь материалы для моей задачи.',(-560,0,1),51,'Medium',colors=(WHITE,MINT),anchor='l',wipe=(seg(t,.9,2.6),.15),alpha=a,parent=m)
    for i,(kind,lab) in enumerate([('document','Исходники'),('sheet','Данные'),('plan','Условия')]):
        u=e_out(seg(t,2.2+i*.18,3+i*.18));x=-450+i*450;y=-260-120*(1-u)
        texture(sc,icon(kind),'icon-'+kind,(x-85,y,50+i*20),135,rot=(0,(i-1)*12,(i-1)*6),alpha=u)
        sc.text(lab,(x+10,y,65),45,'Medium',colors=(WHITE,MINT),anchor='l',alpha=u)
    return sc,post(True)

def shot_mechanism(E,t):
    cam=CameraPath([(0,-100,0,0,.95,-8,8,2),(2,0,0,0,1,6,4,-1),(4.2,0,0,0,1.08,0,0,0),(6,120,0,0,1.25,0,0,0)]).at(t)
    sc=Scene(E,cam,background(t,vivid=True))
    for i,kind in enumerate(['document','sheet','plan']):
        u=e_io(seg(t,.4+i*.13,2.8+i*.13));x=lerp(-660,-250+i*310,u);y=lerp((i-1)*240,(i-1)*85,u);z=lerp(-100,140-i*90,u)
        texture(sc,icon(kind),'icon-'+kind,(x,y,z),lerp(185,270,u),rot=(0,lerp(-28,(i-1)*-9,u),(i-1)*-5),alpha=e_out(seg(t,i*.14,.5+i*.14)))
    for i,lab in enumerate(['Проверить','Сравнить','Выбрать']):
        u=e_out(seg(t,.5+i*.3,1.2+i*.3));sc.text(lab,(-550,230-i*165,0),69,'SemiBold',colors=(WHITE,MINT),alpha=u*(1-e_io(seg(t,2.2,3.3))))
    a=e_out(seg(t,3.1,3.8));sc.text('Новые рабочие материалы',(0,-360,0),75,'SemiBold',colors=(WHITE,MINT),alpha=a,space='s')
    return sc,post(True)

def shot_documents(E,t):
    cam=CameraPath([(0,-210,90,0,.82,-12,6,3),(1.5,-30,50,0,1,-4,3,0),(3.2,80,-10,0,1.2,0,0,0),(6.6,80,-10,0,1.2,0,0,0),(8,240,-10,0,1.25,0,0,0)]).at(t)
    sc=Scene(E,cam,background(t));satellites(sc,t)
    for i in [2,1,0]:
        m=mat(i*110-110,-i*20,-i*95,1,1,1,0,-i*4,-i*2);paper(sc,m,930,790)
        if i==0:
            sc.text('Предложение',(-380,270,2),65,'SemiBold',colors=(INK,GREEN),anchor='l',parent=m)
            for j,lab in enumerate(['Состав работ','Стоимость и условия','Сроки и следующий шаг']):
                sc.text(lab,(-380,140-j*75,2),36,'Medium',colors=(INK,INK),anchor='l',parent=m)
            u=e_io(seg(t,2.7,3.6));sc.box((-30,-190,2),720,134,13,MINT,alpha=u,parent=m)
            sc.text('Ваши правки остаются.',(-360,-190,4),43,'Medium',colors=(INK,GREEN),anchor='l',alpha=u,wipe=(u,.12),parent=m)
    title(sc,['Предложения','и','документы.'],t,until=2.2)
    return sc,post()

def shot_sheets(E,t):
    cam=CameraPath([(0,0,0,0,.88,11,10,-2),(2,0,0,0,1,2,6,0),(4,40,-30,0,1.05,0,0,0),(6.7,40,-30,0,1.05,0,0,0),(8,150,-20,0,1.15,0,0,0)]).at(t)
    sc=Scene(E,cam,background(t));m=mat(0,-50,0,1,1,1,7,-5,-1);paper(sc,m,1430,725)
    for lab,x,w in [('Статья',-530,400),('Цена',-100,240),('Кол-во',180,200),('Сумма',440,250)]:
        sc.box((x,250,2),w,86,0,MINT,parent=m);sc.text(lab,(x,250,3),33,'SemiBold',colors=(INK,GREEN),parent=m)
    for i,lab in enumerate(['Материалы','Работа','Доставка']):
        y=130-i*120;sc.text(lab,(-680,y,3),35,'Medium',colors=(INK,INK),anchor='l',parent=m)
        line(sc,(-685,y-55),(685,y-55),2,'#C5D8CC',parent=m)
        for j,x in enumerate([-100,180,440]):
            if i==0 and j==2:continue
            sc.text('—',(x,y,3),32,'Medium',colors=('#779887','#779887'),parent=m)
    u=e_io(seg(t,2.6,3.5));sc.box((440,130,4),250,106,10,GREEN,alpha=u,parent=m)
    sc.text('= A1 × B1',(440,130,5),35,'Medium',colors=(WHITE,WHITE),alpha=u,wipe=(u,.12),parent=m)
    if t>4:sc.text('Формулы. Связанные данные.',(0,-450,0),48,'Medium',colors=(INK,GREEN),space='s',alpha=e_out(seg(t,4,4.6)))
    title(sc,['Сметы','и','расчёты.'],t,until=2.2)
    return sc,post()

def artwork(sc,m,w=640,h=750,alpha=1,layers=0):
    sc.shadow((0,-20,-3),w,h,8,45,.25*alpha,parent=m)
    sc.box((0,0,0),w,h,8,YELLOW,'#F8E7B5',alpha=alpha,parent=m)
    sc.box((120,-70,15+layers*90),350,350,175,CORAL,'#EDAA87',alpha=alpha,parent=m)
    sc.box((70,-90,25+layers*170),w*.86,76,5,GREEN,TEAL,alpha=alpha,parent=m)
    sc.text('Ваш новый',(-w*.4,h*.30,35+layers*250),65,'SemiBold',colors=(INK,INK),anchor='l',alpha=alpha,parent=m)
    sc.text('проект.',(-w*.4,h*.19,36+layers*250),79,'SemiBold',colors=(INK,INK),anchor='l',alpha=alpha,parent=m)
    sc.text('Идея. Текст. Композиция.',(-w*.4,-h*.36,38),27,'Medium',colors=(INK,INK),anchor='l',alpha=alpha,parent=m)

def shot_design(E,t):
    cam=CameraPath([(0,0,0,0,1.32,0,0,0),(1.5,0,0,0,1,-10,6,1),(4,-70,20,50,.86,24,11,-2),(6.4,0,0,0,.88,4,3,0),(9,0,0,0,1,0,0,0)]).at(t)
    sc=Scene(E,cam,background(t,True));satellites(sc,t,True)
    k=e_io(seg(t,2.2,3.5))*(1-e_io(seg(t,5.3,6.4)))
    artwork(sc,mat(-70,0,0,1,1,1,0,0,0),750,810,layers=k)
    a=e_out(seg(t,5.8,6.7))
    if a>0:
        artwork(sc,mat(650+320*(1-a),-60,-110,.49,.49,1,0,-9,-3),540,930,alpha=a)
        artwork(sc,mat(-710-320*(1-a),-15,-150,.58,.58,1,0,11,3),820,590,alpha=a)
    title(sc,['Реклама.','Дизайн.','Форматы.'],t,WHITE,until=2)
    if 3.5<t<5.6:sc.text('Слои остаются редактируемыми.',(0,-440,0),47,'Medium',colors=(WHITE,MINT),space='s',alpha=e_out(seg(t,3.5,4))*(1-e_io(seg(t,5.1,5.6))))
    return sc,post(True)

def shot_operations(E,t):
    cam=CameraPath([(0,-160,30,0,.88,-14,15,2),(2,0,0,0,.96,-4,8,0),(4,80,0,0,1.02,0,3,0),(6.6,80,0,0,1.02,0,3,0),(8,150,0,0,1.14,0,0,0)]).at(t)
    sc=Scene(E,cam,background(t));m=mat(0,-25,0,1,1,1,11,0,-1)
    for i,(lab,x,y,w,col) in enumerate([('Подготовка',-490,210,440,GREEN),('Производство',-130,10,650,TEAL),('Передача',430,-190,360,CORAL)]):
        u=e_out(seg(t,.3+i*.5,1.4+i*.5));sc.shadow((x,y-18,-3),w,120,20,36,.2*u,parent=m)
        sc.box((x-350*(1-u),y,i*25),w,120,20,col,alpha=u,parent=m)
        sc.text(lab,(x,y,i*25+2),40,'Medium',colors=(WHITE,WHITE) if i<2 else (INK,INK),alpha=u,parent=m)
    u=e_io(seg(t,2.5,3.5))
    for a,b in [((-270,210),(-270,10)),((195,10),(195,-190))]:line(sc,a,(lerp(a[0],b[0],u),lerp(a[1],b[1],u)),5,GREEN,z=90,parent=m)
    title(sc,['Сроки','и','загрузка.'],t,until=2.4)
    if t>4:sc.text('Зависимости видны до решения.',(0,-425,0),49,'Medium',colors=(INK,GREEN),space='s',alpha=e_out(seg(t,4,4.6)))
    return sc,post()

def shot_procurement(E,t):
    cam=CameraPath([(0,-200,20,0,.85,-13,6,2),(1.8,0,0,0,.95,3,2,0),(4,150,-10,0,1.1,0,0,0),(6.6,150,-10,0,1.1,0,0,0),(8,190,0,0,1.2,0,0,0)]).at(t)
    sc=Scene(E,cam,background(t))
    for i,head in enumerate(['Упаковка','Доставка','Оплата']):
        u=e_out(seg(t,.2+i*.25,1.2+i*.25));m=mat(-510+i*510,60*(1-u),-i*45,1,1,1,0,(i-1)*-9,(i-1)*2)
        paper(sc,m,455,660,alpha=u);sc.text(head,(0,230,3),48,'SemiBold',colors=(INK,GREEN),alpha=u,parent=m)
        for j in range(3):
            y=95-j*140;sc.box((0,y,3),350,95,12,MINT if j!=1 else '#EBF2ED',alpha=u,parent=m)
            if i<2 or j!=1:sc.text(['Сопоставить','Уточнить','Выбрать'][j],(0,y,4),34,'Medium',colors=(INK,INK),alpha=u,parent=m)
            else:
                k=e_out(seg(t,3,3.7));sc.box((0,y,4),350,95,12,YELLOW,alpha=k,parent=m);sc.text('Неизвестно',(0,y,5),37,'Medium',colors=(INK,INK),alpha=k,parent=m)
    title(sc,['Условия','важнее','ценника.'],t,until=2.5,size=77)
    return sc,post()

def shot_finance(E,t):
    cam=CameraPath([(0,-130,-30,0,.88,8,9,-2),(2,0,0,0,.98,2,4,0),(4,170,30,0,1.05,0,0,0),(6.6,170,30,0,1.05,0,0,0),(8,240,60,0,1.18,0,0,0)]).at(t)
    sc=Scene(E,cam,background(t,True));m=mat(0,-35,0,1,1,1,5,-4,0)
    line(sc,(-730,-260),(740,-260),3,'#71988A',parent=m);line(sc,(-730,-260),(-730,320),3,'#71988A',parent=m)
    for y in [-120,20,160,300]:line(sc,(-730,y),(740,y),1,'#315D4D',parent=m)
    points=[(-680+i*190,v) for i,v in enumerate([-170,-80,-120,20,50,90,140])];k=e_out(seg(t,.5,2.6))
    for i in range(len(points)-1):
        a,b=points[i],points[i+1];u=clamp(k*(len(points)-1)-i);line(sc,a,(lerp(a[0],b[0],u),lerp(a[1],b[1],u)),9,MINT,z=3,parent=m)
    k=e_io(seg(t,2.8,4));base=points[4]
    for dy,col in [(230,YELLOW),(-105,CORAL)]:
        for i in range(10):
            a=i/10;b=min((i+.6)/10,k)
            if b>a:line(sc,(base[0]+a*380,base[1]+dy*a),(base[0]+b*380,base[1]+dy*b),7,col,z=5,parent=m)
    sc.text('База',(-640,-365,0),42,'Medium',colors=(MINT,MINT),parent=m)
    sc.text('Сценарии',(460,-365,0),42,'Medium',colors=(YELLOW,YELLOW),alpha=k,parent=m)
    title(sc,['Финансы.','Прогноз.','Условия.'],t,WHITE,until=2.3,size=73)
    return sc,post(True)

def shot_connected(E,t):
    cam=CameraPath([(0,0,0,0,.9,-10,7,1),(2,0,0,0,.97,4,3,-1),(4,0,0,0,1.04,0,0,0),(6.6,0,0,0,1.04,0,0,0),(8,200,0,0,1.2,0,0,0)]).at(t)
    sc=Scene(E,cam,background(t));centers=[(-610,0),(0,100),(610,0)];k=e_io(seg(t,2.5,3.6))
    for a,b in [(centers[0],centers[1]),(centers[1],centers[2])]:
        line(sc,a,b,4,'#9EC9B7',z=-90)
        if 0<k<1:sc.glow((lerp(a[0],b[0],k),lerp(a[1],b[1],k),-80),100,100,CORAL,alpha=.6,k=4)
    for i,kind in enumerate(['document','sheet','plan']):
        x,y=centers[i];texture(sc,icon(kind),'icon-'+kind,(x,y,0),330,rot=(0,(i-1)*-9,(i-1)*2))
        if t>3.7:
            a=e_out(seg(t,3.7+i*.12,4.3+i*.12));sc.box((x,y-295,30),275,76,26,GREEN,alpha=a);sc.text('Согласовано',(x,y-295,31),32,'Medium',colors=(WHITE,WHITE),alpha=a)
    title(sc,['Одна','согласованная','правка.'],t,until=2.4,size=79)
    if t>4.8:sc.text('Связанные материалы обновляются вместе.',(0,-445,0),46,'Medium',colors=(INK,GREEN),space='s',alpha=e_out(seg(t,4.8,5.4)))
    return sc,post()

def shot_package(E,t):
    cam=CameraPath([(0,-170,0,0,.95,-9,6,2),(2,0,0,0,1,3,3,0),(4.3,0,-20,0,1.05,0,0,0),(7,0,-30,0,1.12,0,0,0)]).at(t)
    sc=Scene(E,cam,background(t,True))
    for i,(kind,ext) in enumerate([('document','DOCX'),('sheet','XLSX')]):
        a=e_out(seg(t,.1+i*.2,.9+i*.2));x=(-1 if i==0 else 1)*370
        texture(sc,icon(kind),'icon-'+kind,(x+(-1 if i==0 else 1)*300*(1-a),40,0),330,rot=(0,(-1 if i==0 else 1)*8,(-1 if i==0 else 1)*-3),alpha=a)
        sc.text(ext,(x,-270,20),69,'SemiBold',colors=(WHITE,MINT),alpha=a)
    u=e_out(seg(t,2.2,3));sc.box((0,-395,60),570,90,25,MINT,YELLOW,alpha=u,border=(WHITE,2));sc.text('ZIP · принятые версии',(0,-395,61),39,'SemiBold',colors=(INK,GREEN),alpha=u)
    kinetic(sc,['Передайте','готовую','работу.'],t,.1,y=430,size=81,color=WHITE,space='s')
    return sc,post(True)

def shot_team(E,t):
    cam=CameraPath([(0,0,0,0,.93,-8,7,1),(2,0,0,0,1,5,3,-1),(4,0,0,0,1.02,0,0,0),(6,120,0,0,1.12,0,0,0)]).at(t)
    sc=Scene(E,cam,background(t,True));texture(sc,icon('plan'),'icon-plan',(0,-30,0),290)
    for i,label in enumerate(['Владелец','Редактор','Читатель']):
        theta=i*math.tau/3+.15;a=e_out(seg(t,.3+i*.25,1.2+i*.25));x=math.cos(theta)*590;y=math.sin(theta)*590*.46
        line(sc,(0,-30),(x*a,y*a),3,'#739D8A',z=-60);sc.box((x*a,y*a,70),340,104,38,MINT if i==0 else rgba(WHITE,.10),border=(rgba(MINT,.6),2),alpha=a)
        sc.text(label,(x*a,y*a,71),41,'Medium',colors=(INK,INK) if i==0 else (WHITE,MINT),alpha=a)
    title(sc,['Общий','контекст.','Свои','роли.'],t,WHITE,until=2.4,size=73)
    if t>3.2:sc.text('Продолжайте работу вместе.',(0,-430,0),54,'Medium',colors=(WHITE,MINT),space='s',alpha=e_out(seg(t,3.2,3.8)))
    return sc,post(True)

def shot_recurring(E,t):
    cam=CameraPath([(0,-100,0,0,.9,-8,4,1),(1.5,0,0,0,1,3,2,0),(3.5,50,0,0,1,0,0,0),(5,80,0,0,1.06,0,0,0)]).at(t)
    sc=Scene(E,cam,background(t))
    for i,label in enumerate(['Прошлый период','Новый период']):
        a=e_out(seg(t,i*.4,.9+i*.4));m=mat(-440+i*880,0,-i*60,1,1,1,0,(i*2-1)*-7,(i*2-1)*2)
        paper(sc,m,620,650,alpha=a);sc.text(label,(0,225,2),44,'SemiBold',colors=(INK,GREEN),alpha=a,parent=m)
        for j,lab in enumerate(['Задача и материалы','Условия','Результат']):sc.text(lab,(-230,95-j*95,3),34,'Medium',colors=(INK,INK),anchor='l',alpha=a,parent=m)
        if i:
            u=e_out(seg(t,1.5,2.4));sc.box((0,-95,4),500,72,9,YELLOW,alpha=u,parent=m);sc.text('Что изменилось?',(0,-95,5),36,'Medium',colors=(INK,INK),alpha=u,parent=m)
    title(sc,['Продолжать','с','контекстом.'],t,until=1.9,size=76)
    return sc,post()

def shot_finale(E,t):
    cam=CameraPath([(0,0,0,0,.85,8,4,2),(2.4,0,0,0,.95,0,0,0),(4.6,0,0,0,1,0,0,0),(8,0,0,0,1,0,0,0)]).at(t)
    sc=Scene(E,cam,background(t));u=e_io(seg(t,.3,3))
    for i,kind in enumerate(['document','sheet','design','plan']):
        angle=i*math.tau/4+t*.12;r=lerp(550,1250,u)
        texture(sc,icon(kind),'icon-'+kind,(math.sin(angle)*r,math.cos(angle)*r*.5,-80-i*60),lerp(220,140,u),rot=(0,math.sin(angle)*15,math.sin(angle)*-9),alpha=1-u*.7)
    a=e_out(seg(t,2.6,3.5))
    if a>0:
        texture(sc,mark(),'tirlik-mark',(-250,205,0),175,alpha=a,scale=.8+.2*a)
        sc.text('Tirlik',(-125,205,0),135,'SemiBold',colors=(INK,GREEN),anchor='l',alpha=a,blur=15*(1-a),track=-.035)
        kinetic(sc,['Всё','для','вашего','бизнеса.'],t,3.1,y=-30,size=92,color=INK,alpha=a)
        sc.box((0,-242,0),700,130,34,GREEN,TEAL,alpha=a,hl=.04);sc.text('Открыть пример',(0,-242,1),49,'Medium',colors=(WHITE,WHITE),alpha=a)
        sc.text('tirlik.vercel.app',(0,-390,0),42,'Medium',colors=(INK,GREEN),alpha=a)
    return sc,post()

BUILDERS={s.id:globals()['shot_'+s.id] for s in SHOTS}

def build_shot(E,shot,t):return BUILDERS[shot.id](E,t-shot.start)

def build(E,frame):
    t=frame/FPS;by_id={s.id:s for s in SHOTS}
    for join in JOINS:
        if join.start<=t<=join.end:
            a,pa=build_shot(E,by_id[join.left],t);b,pb=build_shot(E,by_id[join.right],t);k=seg(t,join.start,join.end)
            settings={key:lerp(pa.get(key,0),pb.get(key,0),e_io(k)) for key in set(pa)|set(pb)}
            settings.update(frame=frame,tr=dict(mode=join.mode,k=e_io(k),cen=join.center,strength=join.strength,fcol=hexc(MINT)[:3]))
            return [a,b],settings
    shot=next(s for s in SHOTS if s.start<=t<s.end);scene,settings=build_shot(E,shot,t);settings['frame']=frame
    return [scene],settings

def frame_bytes(E,frame):
    frames,settings=build(E,frame);return E.finish(frames,settings)

def validate():
    assert SHOTS[0].start==0 and SHOTS[-1].end==DURATION
    assert len({s.id for s in SHOTS})==len(SHOTS)
    for i,s in enumerate(SHOTS):
        assert s.start<s.reading[0]<s.reading[1]<s.end
        if i:assert SHOTS[i-1].end==s.start
    for i,j in enumerate(JOINS):
        assert (j.left,j.right)==(SHOTS[i].id,SHOTS[i+1].id)
        assert j.start<SHOTS[i].end<j.end and 0<j.end-j.start<.9
    for name,t in EVENTS.items():assert 0<t<DURATION,name
    return {'shots':len(SHOTS),'duration':DURATION,'fps':FPS,'frames':FPS*DURATION,'explicitJoins':len(JOINS)}
