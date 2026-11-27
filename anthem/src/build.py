# Builds anthem/index.html: the Music Studio engine, the Choir engine, the shared ear and judge from Opus, and the Anthem brain.
import os
D=os.path.dirname(os.path.abspath(__file__)); R=os.path.join(D,'..','..')
s=open(os.path.join(R,'studio','index.html'),encoding='utf8').read()
i=s.index('/* Divine Music Machine engine'); i=s.rfind('<script>',0,i)+8; j=s.index('</script>',i); dmm=s[i:j]
ch=open(os.path.join(R,'choir','src','choir-engine.js'),encoding='utf8').read()+'\n'+open(os.path.join(R,'choir','src','choir-follow.js'),encoding='utf8').read()
op=open(os.path.join(R,'opus','src','opus.js'),encoding='utf8').read()
def seg(a,b):
    i=op.index(a); j=op.index(b,i); return op[i:j]
shared='\n'.join([seg("  const rng = (seed)","  const MAJ ="),seg("  // ---------- judging a sketch ----------","  function sketch(p)"),seg("  // ---------- drop anything: the machine listens to it ----------","  root.Opus =")])
an=open(os.path.join(D,'anthem.js'),encoding='utf8').read().replace('/*SHARED*/',shared)
open(os.path.join(D,'anthem.built.js'),'w',encoding='utf8').write(an)
app=open(os.path.join(D,'app.html'),encoding='utf8').read()
out=app.replace('/*DMM*/',dmm).replace('/*CHOIR*/',ch).replace('/*ANTHEM*/',an)
open(os.path.join(D,'..','index.html'),'w',encoding='utf8').write(out); print('built',len(out))
