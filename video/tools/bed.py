import numpy as np, wave, sys
SR=44100; DUR=15.0; N=int(SR*DUR); BEAT=0.5
L=np.zeros(N); R=np.zeros(N)
rng=np.random.default_rng(7)
def add(sig,t,pan=0.0,g=1.0):
    i=int(t*SR); j=min(N,i+len(sig)); s=sig[:j-i]*g
    L[i:j]+=s*(1-pan)/1.0 if pan>0 else s; R[i:j]+=s*(1+pan) if pan<0 else s
def env(n,a,d):
    t=np.arange(n)/SR; return np.minimum(1,t/a)*np.exp(-t/d)
def kick():
    n=int(.35*SR); t=np.arange(n)/SR; f=50+110*np.exp(-t*28)
    return np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*9)*0.9
def hat(o=False):
    n=int((.18 if o else .05)*SR); x=rng.standard_normal(n); x=np.diff(np.concatenate([[0],x]))
    return x*env(n,.001,.06 if o else .012)*0.18
def clap():
    n=int(.25*SR); x=rng.standard_normal(n); t=np.arange(n)/SR
    e=np.exp(-t*22)+0.6*np.exp(-np.maximum(0,t-.012)*30)*(t>.012)
    return np.convolve(x,[1,-.6],'same')*e*0.28
def pluck(freq,dur=.32,g=.22):
    n=int(dur*SR); t=np.arange(n)/SR
    x=sum(np.sin(2*np.pi*freq*k*t)/k**1.4 for k in range(1,6))
    return x*env(n,.003,.09)*g
def pad(freqs,dur,g=.05):
    n=int(dur*SR); t=np.arange(n)/SR; x=sum(np.sin(2*np.pi*f*t)+.5*np.sin(2*np.pi*f*1.003*t) for f in freqs)
    a=np.minimum(1,t/.4)*np.minimum(1,(dur-t)/1.2); return x*a*g
def sub(freq,dur=.45,g=.32):
    n=int(dur*SR); t=np.arange(n)/SR; return np.sin(2*np.pi*freq*t)*env(n,.005,.22)*g
m=lambda k:440*2**((k-69)/12)
prog=[[60,64,67,72],[55,59,62,67],[57,60,64,69],[53,57,60,65]]  # C G Am F
for bar in range(8):
    t0=bar*2.0; ch=prog[bar%4]
    for s in range(8):  # 16th-ish arpeggio on 8ths
        t=t0+s*0.25
        if t>=12.0: break
        note=ch[[0,2,1,3,2,1,3,2][s]]+12
        add(pluck(m(note)),t,pan=0.3 if s%2 else -0.3,g=1.0 if t>=2 else 0.7)
    for b in range(4):
        t=t0+b*BEAT
        if t>=12.0: break
        if t>=2.0 or b==3: add(kick(),t)
        if t>=2.0 and b%2==1: add(clap(),t)
        if t>=2.0: add(sub(m(ch[0]-24)),t)
        add(hat(),t+0.25); add(hat(),t+0.125,g=.5) if t>=6.5 else None
        add(hat(True),t+0.375,g=.6) if t>=2 else None
# end: hit + ringing C major pad
add(kick(),12.0,g=1.2); add(pad([m(48),m(55),m(60),m(64),m(67)],3.0,.06),12.0)
for i,k in enumerate([72,76,79,84]): add(pluck(m(k),.9,.16),12.0+i*0.125)
# fades
fi=np.minimum(1,np.arange(N)/(SR*0.05)); fo=np.clip((DUR-np.arange(N)/SR)/0.6,0,1)
st=np.stack([L,R],1)*(fi*fo)[:,None]; st=st/np.max(np.abs(st))*0.8
w=wave.open(sys.argv[1],'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
w.writeframes((st*32767).astype('<i2').tobytes()); w.close()
