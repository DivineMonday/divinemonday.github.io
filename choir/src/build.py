# Builds choir/index.html: the page with the engine inside, one file.
import os
D=os.path.dirname(os.path.abspath(__file__))
app=open(D+'/app.html',encoding='utf8').read(); eng=open(D+'/choir-engine.js',encoding='utf8').read()+'\n'+open(D+'/choir-follow.js',encoding='utf8').read()
assert '/*ENGINE*/' in app
open(D+'/../index.html','w',encoding='utf8').write(app.replace('/*ENGINE*/',eng)); print('built',len(app)+len(eng))
