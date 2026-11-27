const C=require('./choir-engine.js');require('./choir-follow.js');const fs=require('fs');
const files=process.argv.slice(2);let fails=0,n=0;
for(const f of files){const b=fs.readFileSync(f);
 for(const mode of ['film','gospel','baroque','polyphony','gregorian'])for(const who of [[1,1],[1,0],[0,1]]){n++;
  let r;try{r=C.follow(b,{style:mode,men:!!who[0],women:!!who[1],seed:5});}catch(e){console.log('CRASH',f,mode,e.message);fails++;continue;}
  const Z=r.zones,bad=[];if(!r.notes.length)bad.push('empty');
  for(const x of r.notes){if(x.p<Z.menLo||x.p>Z.womenHi)bad.push('range '+x.p);if(!who[1]&&x.p>Z.menHi)bad.push('men>'+x.p);if(!who[0]&&x.p<Z.womenLo)bad.push('women<'+x.p);if(x.d<=0||x.v<1||x.v>127)bad.push('note');}
  const back=C.parseMidi(C.toMidi(r,'t'));if(back.notes.length!==r.notes.length)bad.push('midi '+back.notes.length+'/'+r.notes.length);
  if(bad.length){fails++;console.log('FAIL',f.split('/').pop(),mode,who,bad.slice(0,3));}
  if(who[0]&&who[1])console.log(f.split('/').pop().slice(0,24),mode,r.notes.length,'poly',r.maxPoly,r.roles.join(','));
 }}
console.log(n,'runs',fails,'fails');
