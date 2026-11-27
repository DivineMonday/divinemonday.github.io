// Checks every style, nuance, spirit, form, role and texture against the choir rules.
const C = require('./choir-engine.js');
let n = 0, fails = 0; const issues = {};
const bad = (k, msg) => { fails++; issues[k] = (issues[k] || 0) + 1; if (issues[k] <= 2) console.log('  ', k, msg); };
for (const style of Object.keys(C.STYLES)) for (const nuance of Object.keys(C.STYLES[style].nuances)) for (const spirit of C.STYLES[style].spirits)
  for (const form of Object.keys(C.FORMS)) for (const [men, women] of [[1, 1], [1, 0], [0, 1]]) for (const texture of ['together', 'callresponse', 'womenlead', 'menlead', 'middle']) {
    const role = Object.keys(C.ROLES)[n % 5], solo = n % 7 === 0 ? 'women' : n % 11 === 0 ? 'men' : 'none', seconds = n % 3 === 0 ? 150 : 0;
    const o = { style, nuance, spirit, form, role, men: !!men, women: !!women, texture, solo, seed: 1000 + n, seconds }; n++;
    let r; try { r = C.compose(o); } catch (e) { bad('crash', JSON.stringify(o) + ' ' + e.stack.split('\n').slice(0, 2).join(' ')); continue; }
    const Z = r.zones, tag = style + '/' + nuance + '/' + spirit + '/' + form + (men ? 'M' : '') + (women ? 'W' : '') + '/' + texture;
    if (!r.notes.length) { bad('empty', tag); continue; }
    for (const x of r.notes) { if (!(x.d > 0) || !(x.v > 0 && x.v < 128) || !Number.isFinite(x.t)) { bad('note', tag + JSON.stringify(x)); break; } }
    const lo = Math.min(...r.notes.map((x) => x.p)), hi = Math.max(...r.notes.map((x) => x.p));
    if (lo < Z.menLo || hi > Z.womenHi) bad('range', tag + ' ' + lo + '..' + hi);
    if (!women && hi > Z.menHi) bad('men-only above men keys', tag + ' ' + hi);
    if (!men && lo < Z.womenLo) bad('women-only below women keys', tag + ' ' + lo);
    if (seconds) { const s = r.beats * 60 / r.bpm; if (Math.abs(s - seconds) > 6) bad('length', tag + ' ' + Math.round(s) + 's'); }
    // breathing: no key held longer than 4 bars without a rest across the whole choir
    const ends = r.notes.map((x) => [x.t, x.t + x.d]).sort((a, b) => a[0] - b[0]); let runStart = ends[0][0], runEnd = ends[0][1], longest = 0;
    for (const [a, b] of ends) { if (a > runEnd + 10) { longest = Math.max(longest, runEnd - runStart); runStart = a; } runEnd = Math.max(runEnd, b); } longest = Math.max(longest, runEnd - runStart);
    if (longest > C.PPQ * r.meter * 9 && r.engine !== 'cluster') bad('no breath', tag + ' ' + (longest / C.PPQ / r.meter).toFixed(1) + ' bars');
    // big leaps inside one voice, within a phrase
    for (const v of ['S', 'A', 'T', 'B']) { const ln = r.notes.filter((x) => x.voice === v).sort((a, b) => a.t - b.t);
      for (let i = 1; i < ln.length; i++) { const a = ln[i - 1], b = ln[i]; if (Math.abs(b.t - (a.t + a.d)) < C.PPQ / 2 - 50 && Math.abs(b.p - a.p) > 12) { bad('leap', tag + ' ' + v + ' ' + a.p + '>' + b.p); break; } } }
    if (r.playMode === 'legato' && r.maxPoly > 1) bad('legato', tag);
    const mid = C.toMidi(r, 'test'); if (mid.length < 100) bad('midi', tag);
  }
console.log(n, 'pieces,', fails, 'fails', JSON.stringify(issues));
