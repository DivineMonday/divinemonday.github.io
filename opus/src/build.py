# Builds opus/index.html from the Symphony engine (read from symphony/index.html), the Choir engine and the Opus brain.
import os
D=os.path.dirname(os.path.abspath(__file__)); R=os.path.join(D,'..','..')
s=open(os.path.join(R,'symphony','index.html'),encoding='utf8').read()
i=s.index('/* Divine Symphony Machine · engine'); i=s.rfind('<script>',0,i)+8; j=s.index('</script>',i); sym=s[i:j]
ch=open(os.path.join(R,'choir','src','choir-engine.js'),encoding='utf8').read()+'\n'+open(os.path.join(R,'choir','src','choir-follow.js'),encoding='utf8').read()
op=open(os.path.join(D,'opus.js'),encoding='utf8').read()
app=open(os.path.join(D,'app.html'),encoding='utf8').read()
for k in ['/*SYM*/','/*CHOIR*/','/*OPUS*/']: assert k in app
out=app.replace('/*SYM*/',sym).replace('/*CHOIR*/',ch).replace('/*OPUS*/',op)
open(os.path.join(D,'..','index.html'),'w',encoding='utf8').write(out); print('built',len(out))
