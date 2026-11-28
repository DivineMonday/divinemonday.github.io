/* Divine Anthem: one button, a whole track with band, beat and choir.
   The Music Studio engine writes the song, the Choir Machine sings with it; the machine sketches several, keeps the best,
   and remembers what it gave you. The ear and the judge are shared with Divine Opus. */
(function (root) {
  const D = root.DMM, C = root.Choir, PPQ = D.PPQ;
  const FEELINGS = { heroic: { name: 'Heroic' }, tender: { name: 'Tender' }, mysterious: { name: 'Mysterious' }, joyful: { name: 'Joyful' }, melancholy: { name: 'Melancholy' }, stormy: { name: 'Stormy' }, dreamy: { name: 'Dreamy' }, solemn: { name: 'Solemn' } };
  const Y = { FEELINGS }, FEELS = Object.keys(FEELINGS);
  const MAJ = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'], MIN = MAJ.map((x) => x.toLowerCase());
  const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const hash = (bytes) => { let h = 2166136261; const n = Math.min(bytes.length, 1 << 20), step = Math.max(1, Math.floor(bytes.length / n)); for (let i = 0; i < bytes.length; i += step) { h ^= bytes[i]; h = Math.imul(h, 16777619); } return h >>> 0; };
  const strHash = (s) => hash(new TextEncoder().encode(String(s)));

  // ---------- judging a sketch ----------
  const entropy = (arr) => { const m = {}; for (const x of arr) m[x] = (m[x] || 0) + 1; const n = arr.length || 1; let h = 0; for (const k in m) { const p = m[k] / n; h -= p * Math.log2(p); } return h; };
  const figures = (mel) => { const iv = []; for (let i = 1; i < mel.length; i++) iv.push(mel[i].p - mel[i - 1].p); const f = {}; for (let i = 0; i + 3 < iv.length; i++) { const g = iv.slice(i, i + 3).join(); f[g] = (f[g] || 0) + 1; } return Object.entries(f).sort((a, b) => b[1] - a[1]).slice(0, 60).map((x) => x[0]); };
  function judge(A, choir, p, history) {
    const mel = A.mel, iv = []; for (let i = 1; i < mel.length; i++) iv.push(mel[i].p - mel[i - 1].p);
    const ivEnt = entropy(iv.map((x) => { const a = Math.abs(x); return a > 7 ? 8 : a === 6 ? 5 : a; })) / 3;
    const rhEnt = entropy(mel.map((n) => Math.round(n.d / 120))) / 3;
    const ps = mel.map((n) => n.p), range = ps.length ? Math.max(...ps) - Math.min(...ps) : 0, rangeS = 1 - Math.min(1, Math.abs(range - 19) / 14);
    let ping = 0; for (let i = 2; i < ps.length; i++) if (ps[i] === ps[i - 2] && Math.abs(ps[i] - ps[i - 1]) <= 2 && ps[i] !== ps[i - 1]) ping++; ping /= Math.max(1, ps.length);
    const dyn = A.dyn, top = dyn.indexOf(Math.max(...dyn)) / Math.max(1, dyn.length - 1), arc = top > 0.5 && top < 0.95 ? 1 : 0.3, dynR = Math.max(...dyn) - Math.min(...dyn.filter((x) => x > 0));
    const roles = new Set(choir.roles), choirS = roles.size / 8 + (roles.has('rest') ? 0.3 : 0) + (roles.has('tutti') ? 0.3 : 0);
    const figs = figures(mel); let sim = 0, same = 0; const combo = p.era + '/' + p.style + '/' + p.chain.map((c) => c.form).join('-');
    for (const h of history) { const s = new Set(h.figs); let k = 0; for (const g of figs) if (s.has(g)) k++; sim = Math.max(sim, k / Math.max(1, Math.min(figs.length, h.figs.length))); if (h.combo === combo) same = 1; }
    const score = 2 * ivEnt + 1.5 * rhEnt + rangeS + arc + 1.2 * dynR + choirS - 6 * ping - 3 * sim - 1.2 * same;
    return { score, figs, combo, parts: { ivEnt, rhEnt, range, ping, arc, sim } };
  }

  // ---------- one file: the orchestra and the choir on its own track ----------
  const vlq = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
  // read a track chunk into absolute-time events, raw bytes kept (running status written out)
  function readTrack(d) { const ev = []; let i = 0, t = 0, rs = 0; const vl = () => { let v = 0, c; do { c = d[i++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; };
    while (i < d.length) { t += vl(); let st = d[i]; if (st & 0x80) i++; else st = rs;
      if (st === 0xff) { const ty = d[i++], s0 = i, l = vl(), body = Array.from(d.subarray(i, i + l)); i += l; if (ty === 0x2f) break; ev.push({ t, b: [0xff, ty, ...Array.from(d.subarray(s0, s0 + (i - l - s0))), ...body], ty }); continue; }
      if (st === 0xf0 || st === 0xf7) { const s0 = i, l = vl(); i += l; ev.push({ t, b: [st, ...Array.from(d.subarray(s0, i))] }); continue; }
      rs = st; const n = (st & 0xf0) === 0xc0 || (st & 0xf0) === 0xd0 ? 1 : 2; ev.push({ t, b: [st, ...Array.from(d.subarray(i, i + n))] }); i += n; }
    return ev; }
  const writeTrack = (ev) => { const body = []; let last = 0; ev.sort((a, b) => a.t - b.t || (a.o || 0) - (b.o || 0)); for (const e of ev) { body.push(...vlq(Math.max(0, e.t - last)), ...e.b); last = Math.max(last, e.t); } body.push(0, 0xff, 0x2f, 0); return body; };
  // no conductor track: tempo, metre and markers ride along on the first instrument, so the file starts at Piccolo and ends at Choir
  function noConductor(b) {
    const chunks = []; let i = 14; while (i + 8 <= b.length) { const l = ((b[i + 4] << 24) | (b[i + 5] << 16) | (b[i + 6] << 8) | b[i + 7]) >>> 0; chunks.push(b.subarray(i + 8, i + 8 + l)); i += 8 + l; }
    if (chunks.length < 2) return b;
    const cond = readTrack(chunks[0]).filter((e) => e.ty !== 0x03).map((e) => Object.assign(e, { o: -1 })), first = readTrack(chunks[1]);
    const merged = [new Uint8Array(writeTrack(first.filter((e) => e.ty === 0x03).concat(cond, first.filter((e) => e.ty !== 0x03))))].concat(chunks.slice(2).map((c) => c));
    let size = 14; for (const c of merged) size += 8 + c.length; const out = new Uint8Array(size); out.set(b.subarray(0, 14), 0); const nt = merged.length; out[10] = nt >> 8; out[11] = nt & 255; if (out[9] === 0) out[9] = 1;
    let o = 14; for (const c of merged) { const L = c.length; out.set([0x4d, 0x54, 0x72, 0x6b, (L >>> 24) & 255, (L >>> 16) & 255, (L >>> 8) & 255, L & 255], o); out.set(c, o + 8); o += 8 + L; }
    return out;
  }
  function withChoir(orch, ch, name) {
    const b = orch, ntr = (b[10] << 8) | b[11], ev = [];
    const txt = (s) => Array.from(new TextEncoder().encode(s));
    ev.push([0, 0, [0xff, 0x03, ...vlq(txt(name).length), ...txt(name)]]);
    for (const c of ch.cc) ev.push([c.t, 1, [0xbf, 1, c.v]]);
    for (const m of ch.markers) { const t = txt('Choir: ' + m.text); ev.push([m.t, 1, [0xff, 0x01, ...vlq(t.length), ...t]]); }
    for (const n of ch.notes) { ev.push([n.t, 2, [0x9f, n.p, n.v]]); ev.push([n.t + n.d, 0, [0x8f, n.p, 0]]); }
    ev.sort((a, x) => a[0] - x[0] || a[1] - x[1]);
    const body = []; let last = 0; for (const [t, , d] of ev) { body.push(...vlq(Math.max(0, t - last)), ...d); last = Math.max(last, t); }
    body.push(0, 0xff, 0x2f, 0);
    const out = new Uint8Array(b.length + 8 + body.length); out.set(b, 0);
    const nt = ntr + 1; out[10] = nt >> 8; out[11] = nt & 255; if (out[9] === 0) out[9] = 1;
    let o = b.length; out.set([0x4d, 0x54, 0x72, 0x6b, (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255], o); out.set(body, o + 8);
    return out;
  }


  // ---------- drop anything: the machine listens to it ----------
  const WORDS = {
    heroic: 'hero brave victory win fight proud glory strong held moed overwinning trots sieg mut stolz kracht',
    tender: 'love dear soft kiss heart gentle lief liefde zacht hart kus sanft liebe herz zart',
    mysterious: 'dark secret night shadow mystery fog unknown donker geheim nacht schaduw mist dunkel geheimnis schatten',
    joyful: 'happy joy sun party dance laugh fun blij feest zon dans lachen vrolijk froh freude sonne tanz',
    melancholy: 'sad rain alone tears lost miss grey verdriet regen alleen tranen gemis traurig allein tränen',
    stormy: 'storm angry war wild wind fire chase boos oorlog wild vuur jacht sturm wut krieg feuer',
    dreamy: 'dream sleep cloud float moon sky star droom slapen wolk maan lucht ster traum schlaf wolke mond himmel',
    solemn: 'church god prayer holy honour ceremony memory kerk gebed heilig eer herdenking kirche gebet heilig ehre'
  };
  function fromText(t, name) {
    const w = t.toLowerCase(), sc = {}; for (const [f, list] of Object.entries(WORDS)) sc[f] = list.split(' ').filter((x) => w.includes(x)).length;
    const best = Object.entries(sc).sort((a, b) => b[1] - a[1])[0], seed = strHash(t), feel = best[1] ? best[0] : FEELS[seed % FEELS.length];
    return { feel, seed, desc: (name || 'your words') + ': ' + (best[1] ? 'it reads as ' : 'it gives off ') + Y.FEELINGS[feel].name.toLowerCase() };
  }
  async function fromImage(file) {
    const url = URL.createObjectURL(file), img = new Image(); img.src = url; await img.decode(); const cv = document.createElement('canvas'); cv.width = cv.height = 48; const g = cv.getContext('2d'); g.drawImage(img, 0, 0, 48, 48); URL.revokeObjectURL(url);
    const d = g.getImageData(0, 0, 48, 48).data; let r = 0, gg = 0, b = 0, sat = 0; const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); sat += mx ? (mx - mn) / mx : 0; }
    r /= n; gg /= n; b /= n; sat /= n; const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), light = (mx + mn) / 510;
    let hue = 0; if (mx !== mn) { hue = mx === r ? ((gg - b) / (mx - mn)) % 6 : mx === gg ? (b - r) / (mx - mn) + 2 : (r - gg) / (mx - mn) + 4; hue = (hue * 60 + 360) % 360; }
    let feel, col;
    if (sat < 0.15) { feel = light < 0.45 ? 'solemn' : 'dreamy'; col = light < 0.45 ? 'grey and dark' : 'pale and quiet'; }
    else if (hue < 25 || hue >= 335) { feel = light < 0.45 ? 'stormy' : 'heroic'; col = 'red'; }
    else if (hue < 70) { feel = 'joyful'; col = 'warm and golden'; }
    else if (hue < 160) { feel = 'tender'; col = 'green'; }
    else if (hue < 250) { feel = light < 0.45 ? 'mysterious' : 'dreamy'; col = light < 0.45 ? 'deep blue' : 'light blue'; }
    else { feel = light < 0.5 ? 'melancholy' : 'dreamy'; col = 'violet'; }
    const seed = (Math.round(r) * 65599 + Math.round(gg) * 257 + Math.round(b) + strHash(file.name)) >>> 0;
    return { feel, seed, desc: file.name + ': ' + col + (light < 0.4 ? ', dark' : light > 0.65 ? ', bright' : '') + ', so ' + Y.FEELINGS[feel].name.toLowerCase() };
  }
  async function fromAudio(buf, name) {
    const ac = new (window.AudioContext || window.webkitAudioContext)(); const au = await ac.decodeAudioData(buf.slice(0)); ac.close && ac.close();
    const x = au.getChannelData(0), F = 2048, rms = []; let zc = 0;
    for (let i = 0; i + F < x.length; i += F * 4) { let s = 0; for (let k = 0; k < F; k++) { s += x[i + k] * x[i + k]; if (k && (x[i + k] > 0) !== (x[i + k - 1] > 0)) zc++; } rms.push(Math.sqrt(s / F)); }
    const mean = rms.reduce((a, v) => a + v, 0) / (rms.length || 1), sd = Math.sqrt(rms.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (rms.length || 1)), bright = zc / (rms.length * F || 1), dynam = sd / (mean || 1);
    const loud = mean > 0.12, high = bright > 0.06;
    const feel = loud ? (dynam > 0.5 ? 'stormy' : high ? 'joyful' : 'heroic') : (high ? (dynam > 0.6 ? 'dreamy' : 'tender') : (dynam > 0.6 ? 'mysterious' : mean < 0.05 ? 'melancholy' : 'solemn'));
    const seed = (hash(new Uint8Array(x.buffer, 0, Math.min(x.byteLength, 1 << 20))) ^ Math.round(au.duration * 1000)) >>> 0;
    return { feel, seed, len: au.duration > 240 ? 2 : null, desc: name + ': ' + (loud ? 'loud' : 'quiet') + ', ' + (high ? 'bright' : 'dark') + (dynam > 0.5 ? ', restless' : ', steady') + ', so ' + Y.FEELINGS[feel].name.toLowerCase() };
  }
  function fromMidi(bytes, name) {
    const A = C.analyseMidi(bytes), M = C.parseMidi(bytes), bpm = 60000000 / M.tempos[0].us;
    const N = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'], kn = N[A.tonic], key = A.minor ? (MIN.includes(kn.toLowerCase()) ? kn.toLowerCase() : null) : (MAJ.includes(kn) ? kn : null);
    const feel = A.minor ? (bpm > 110 ? 'stormy' : bpm < 75 ? 'melancholy' : 'mysterious') : (bpm > 110 ? 'joyful' : bpm < 75 ? 'tender' : 'heroic');
    return { feel, key, seed: hash(new Uint8Array(bytes)), desc: name + ': ' + kn + (A.minor ? ' minor' : ' major') + ', ' + Math.round(bpm) + ' bpm, so ' + Y.FEELINGS[feel].name.toLowerCase() + (key ? ', in the same key' : '') };
  }
  async function listen(file) {
    const buf = await file.arrayBuffer(), bytes = new Uint8Array(buf), nm = file.name || 'your file';
    if (bytes[0] === 0x4d && bytes[1] === 0x54 && bytes[2] === 0x68 && bytes[3] === 0x64) { try { return fromMidi(buf, nm); } catch (e) { /* fall through */ } }
    if (/^image\//.test(file.type)) { try { return await fromImage(file); } catch (e) { /* fall through */ } }
    if (/^(audio|video)\//.test(file.type) || /\.(mp3|wav|m4a|aac|ogg|flac|aif+)$/i.test(nm)) { try { return await fromAudio(buf, nm); } catch (e) { /* fall through */ } }
    if (/^text\//.test(file.type) || /\.(txt|md|lrc|csv|json|html?)$/i.test(nm)) return fromText(new TextDecoder().decode(bytes.subarray(0, 200000)), nm);
    const seed = hash(bytes), feel = FEELS[seed % FEELS.length];
    return { feel, seed, desc: nm + ': its bytes say ' + Y.FEELINGS[feel].name.toLowerCase() };
  }


  const GENRES = D.GENRE_ORDER.filter((g) => D.GENRES[g]);
  const FEEL_GENRES = { heroic: ['rock', 'punk', 'trance', 'eurodance'], tender: ['songwriter', 'pop', 'chillout'], mysterious: ['triphop', 'dubtechno', 'minimal', 'ambient'], joyful: ['funk', 'house', 'pop', 'eurodance', 'garage'],
    melancholy: ['triphop', 'synthwave', 'blues', 'songwriter'], stormy: ['dnb', 'breakbeat', 'techno', 'ebm', 'acid'], dreamy: ['ambient', 'chillout', 'dub', 'synthwave'], solemn: ['ambient', 'dubtechno', 'blues'] };
  const CHOIR = { blues: ['gospel'], rock: ['film', 'gospel'], pop: ['gospel', 'film'], hiphop: ['gospel', 'gregorian'], punk: ['gregorian', 'film'], newwave: ['film', 'polyphony'], house: ['gospel', 'film'], techno: ['gregorian', 'film'],
    acid: ['gregorian'], breakbeat: ['film'], triphop: ['film', 'polyphony'], dnb: ['film', 'gregorian'], synthwave: ['film'], divine: ['gospel', 'film'], minimal: ['gregorian'], dubtechno: ['gregorian', 'polyphony'], club: ['gospel'],
    trance: ['film', 'polyphony'], eurodance: ['film', 'gospel'], garage: ['gospel'], ebm: ['gregorian'], chillout: ['polyphony', 'film'], ambient: ['polyphony', 'gregorian'], dub: ['gospel'], funk: ['gospel'], songwriter: ['polyphony', 'film'] };
  // always the same tracks in the same order, so one Studio One template fits every song
  const TRACKS = [['beat', 'Beat'], ['bass', 'Bass'], ['chords', 'Chords'], ['pad', 'Pad'], ['melody', 'Melody'], ['answer', 'Answer']];
  const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  function plan(genre, hint, seed) {
    const R = rng(seed), pick = (a) => a[Math.floor(R() * a.length)]; hint = hint || {};
    const g = genre || (hint.feel && R() < 0.85 ? pick(FEEL_GENRES[hint.feel]) : pick(GENRES));
    let style = R() < 0.78 ? pick(CHOIR[g] || ['film']) : pick(['gregorian', 'polyphony', 'baroque', 'film', 'gospel']);
    const w = R(), men = w < 0.93, women = w < 0.86 || w >= 0.93;
    const tools = pickTools(rng((seed ^ 0x2545f491) >>> 0), g);
    return { genre: g, style, men, women, seed, era: g, tools, chain: [{ form: Object.values(tools).join('-') }] };
  }
  function build(p, hint) {
    const s = D.newSong(p.genre, { seed: p.seed }); hint = hint || {};
    if (hint.key) { const m = /^([A-Ga-g][#b]?)$/.exec(hint.key); if (m) { const minor = hint.key === hint.key.toLowerCase(), i = MAJ.findIndex((x) => x.toLowerCase() === hint.key.toLowerCase()); if (i >= 0) { s.key = { root: i, scale: minor ? 'minor' : 'major' }; s.keyAuto = false; } } }
    const G = D.GENRES[p.genre]; if (hint.bpm && G.bpm) { let b = hint.bpm; while (b < G.bpm[0]) b *= 2; while (b > G.bpm[1]) b /= 2; if (b >= G.bpm[0] && b <= G.bpm[1]) { s.bpm = Math.round(b); s.bpmAuto = false; } }
    const BT = D.barTicks(s), markers = []; let bar = 0; const cnt = {};
    for (const sec of s.sections) { cnt[sec.type] = (cnt[sec.type] || 0) + 1; markers.push({ t: bar * BT, text: sec.type[0].toUpperCase() + sec.type.slice(1) + ' ' + cnt[sec.type] }); bar += sec.bars; }
    const tracks = arrange(bandTracks(s, hint.beat), s, p.genre, p.seed, p.tools), first = bandMidi(s, markers, tracks);
    const choir = C.follow(first, { style: p.style, men: p.men, women: p.women, seed: p.seed ^ 0x5bd1e995, song: true });
    const bytes = bandMidi(s, markers, react(tracks, choir, BT));
    return { s, bytes, choir, A: C.analyseMidi(first) };
  }
  // the band as MIDI; the beat speaks the language of the drum app you chose
  function bandTracks(s, beat) {
    const bp = D.PLUGINS[beat] ? beat : 'gm', fam = D.PLUGINS[bp].family && !D.PLUGINS[bp].noPlayer;
    return TRACKS.map(([part, name], i) => { let notes = []; try { notes = D.applyMask(s, part, D.renderSong(s, part, { polished: true }), part === 'beat' ? bp : 'plain', { octave: 0, roles: {}, mode: part === 'beat' && fam ? 'instrument' : undefined }); if (part !== 'beat') notes = notes.filter((n) => !n.ks); } catch (e) { notes = []; } return { part, name, channel: part === 'beat' ? 9 : i, notes }; });
  }
  const bandMidi = (s, markers, tracks) => D.writeMidi(tracks, { bpm: s.bpm, meter: s.meter, title: s.name, markers });
  // the band listens back: where the choir holds chords the pad rests, where it sings the tune the melody steps aside,
  // and the answer only speaks in the choir's breaths
  // ---------- the arranger: one motif for everyone, breathing together, each part its own moment ----------
  const OFFBEAT = new Set(['house', 'garage', 'dub', 'dubtechno', 'trance', 'eurodance', 'minimal', 'techno', 'club']);
  // a toolbox, not a rulebook: every song draws a few ideas of its own
  const TOOLS = { pre: ['silence', 'swell', 'fill', 'none', 'none'], answer: ['motif', 'counter', 'silent', 'asis', 'asis'], moment: ['bass', 'chords', 'beat', 'melody', 'none', 'none'],
    bass: ['kick', 'melody', 'free', 'free'], breath: ['every8', 'sections', 'none', 'none'], accent: ['on', 'off', 'off'] };
  function pickTools(R, genre) {
    const pick = (a) => a[Math.floor(R() * a.length)], keys = Object.keys(TOOLS), on = new Set(); const n = 2 + (R() < 0.5 ? 1 : 0);
    while (on.size < n) on.add(pick(keys)); const t = {};
    for (const k of keys) { const opts = TOOLS[k].filter((x) => !(k === 'bass' && x === 'kick' && OFFBEAT.has(genre))); const live = opts.filter((x) => !['none', 'asis', 'free', 'off'].includes(x)); t[k] = on.has(k) ? pick(live) : ({ pre: 'none', answer: 'asis', moment: 'none', bass: 'free', breath: 'none', accent: 'off' })[k]; }
    return t;
  }
  const TOOL_TEXT = { pre: { silence: 'a breath of silence before the chorus', swell: 'a swell into the chorus', fill: 'a fill into the chorus' }, answer: { motif: 'the answer echoes the melody', counter: 'a countermelody', silent: 'no answer, more space' },
    moment: { bass: 'a moment for the bass', chords: 'a moment for the chords', beat: 'a moment for the beat alone', melody: 'a moment for the melody' }, bass: { kick: 'bass and kick as one', melody: 'the bass follows the melody' },
    breath: { every8: 'breathing every eight bars', sections: 'breathing between parts' }, accent: { on: 'chords lean on the melody' } };
  const toolsText = (t) => Object.keys(t).map((k) => (TOOL_TEXT[k] || {})[t[k]]).filter(Boolean);
  function arrange(tracks, s, genre, seed, tools) {
    const R = rng((seed ^ 0x2545f491) >>> 0), BT = D.barTicks(s), P = {}, T = tools || pickTools(R, genre); for (const tr of tracks) P[tr.part] = tr;
    const secs = []; let b0 = 0; for (const x of s.sections) { secs.push({ type: x.type, from: b0, to: b0 + x.bars }); b0 += x.bars; }
    const secAt = (t) => secs.find((x) => t >= x.from * BT && t < x.to * BT), isCh = (x) => x && (x.type === 'chorus' || x.type === 'drop');
    const mel = P.melody.notes, chordsAt = (t) => { const pcs = new Set(); for (const n of P.chords.notes) if (n.t <= t && n.t + n.d > t) pcs.add(n.p % 12); if (!pcs.size) for (const n of P.bass.notes) if (n.t <= t && n.t + n.d > t) pcs.add(n.p % 12); return pcs; };
    const snap = (p, pcs) => { if (!pcs.size) return p; for (let d = 0; d < 7; d++) { if (pcs.has(((p + d) % 12 + 12) % 12)) return p + d; if (pcs.has(((p - d) % 12 + 12) % 12)) return p - d; } return p; };
    const med = (a) => a.length ? a.map((n) => n.p).sort((x, y) => x - y)[a.length >> 1] : null, melodic = ['bass', 'chords', 'pad', 'melody', 'answer'];
    const ansCenter = med(P.answer.notes) || (med(mel) != null ? med(mel) - 12 : 60), ansVel = mel.length ? Math.round(mel.reduce((a, n) => a + n.v, 0) / mel.length) - 12 : 70;
    // the answer
    if (T.answer === 'silent') P.answer.notes = [];
    if (T.answer === 'motif' || T.answer === 'counter') {
      const keep = P.answer.notes.filter((a) => !mel.some((m) => m.t < a.t + a.d + 30 && m.t + m.d > a.t - 30));
      if (T.answer === 'motif') {
        const ch1 = secs.find(isCh), src = mel.filter((n) => !ch1 || (n.t >= ch1.from * BT && n.t < ch1.to * BT)), first = (src.length ? src : mel).slice().sort((a, b) => a.t - b.t);
        const motif = first.length ? first.filter((n) => n.t < first[0].t + BT).slice(0, 6).map((n) => ({ dt: n.t - first[0].t, d: Math.min(n.d, BT / 2), i: n.p - first[0].p })) : [];
        if (motif.length >= 2) { const span = motif[motif.length - 1].dt + motif[motif.length - 1].d, busy = (a, b) => mel.some((m) => m.t < b && m.t + m.d > a) || keep.some((x) => x.t < b && x.t + x.d > a);
          for (let b = 0; b < b0; b += 2) { const sx = secAt(b * BT); if (!sx || sx.type === 'intro' || sx.type === 'outro' || R() < 0.3) continue; if (!mel.some((m) => m.t >= (b - 2) * BT && m.t < b * BT + BT)) continue;
            for (const off of [BT, BT / 2, BT * 1.5]) { const t0 = b * BT + off; if (t0 + span > (b + 2) * BT || busy(t0 - 60, t0 + span + 60)) continue;
              const way = R() < 0.4 ? -1 : 1, base = snap(ansCenter + (R() < 0.35 ? (R() < 0.5 ? 2 : -2) : 0), chordsAt(t0));
              for (const m of motif) { const t = t0 + m.dt; keep.push({ t, d: m.d, v: Math.max(20, ansVel - (m.dt ? 4 : 0)), p: snap(base + way * m.i, chordsAt(t)) }); } break; } } }
      } else { // a countermelody: long notes moving against the melody
        let prev = ansCenter, lastMel = null;
        for (let t = 0; t < b0 * BT; t += BT / 2) { const ms = mel.filter((m) => m.t >= t && m.t < t + BT / 2); if (!ms.length) continue; const sx = secAt(t); if (!sx || sx.type === 'intro') continue;
          const mp = ms[0].p, dir = lastMel == null ? 0 : Math.sign(mp - lastMel); lastMel = mp; let q = snap(prev - dir * 2, chordsAt(t)); if (Math.abs(q - ansCenter) > 7) q = snap(ansCenter, chordsAt(t));
          if (keep.some((x) => x.t < t + BT / 2 && x.t + x.d > t)) continue; keep.push({ t, d: BT / 2 - 30, v: Math.max(20, ansVel - 8), p: q }); prev = q; } }
      P.answer.notes = keep.sort((a, b) => a.t - b.t);
    }
    // the bass
    const cnt = {}; for (const n of P.beat.notes) cnt[n.p] = (cnt[n.p] || 0) + 1; const lows = Object.keys(cnt).map(Number).sort((a, b) => a - b), kick = lows.find((p) => cnt[p] >= P.beat.notes.length * 0.1) || lows[0];
    const kicks = P.beat.notes.filter((n) => n.p === kick).map((n) => n.t), mons = mel.map((m) => m.t);
    if (T.bass !== 'free') for (const n of P.bass.notes) { if (!isCh(secAt(n.t))) continue; const tgt = (T.bass === 'kick' ? kicks : mons).find((x) => Math.abs(x - n.t) < (T.bass === 'kick' ? 70 : 120)); if (tgt != null && tgt !== n.t) { n.d = Math.max(40, n.d + n.t - tgt); n.t = tgt; } }
    if (T.accent === 'on') for (const n of P.chords.notes) { if (!isCh(secAt(n.t))) continue; n.v = Math.max(15, Math.min(127, n.v + (mel.some((m) => Math.abs(m.t - n.t) < 60) ? 12 : -8))); }
    // into the chorus
    if (T.pre !== 'none') secs.forEach((x, k) => { if (!isCh(x) || k === 0) return; const c0 = x.from * BT, gap = c0 - BT / 2, sw = c0 - 4 * BT;
      if (T.pre === 'silence') for (const tr of tracks) { tr.notes = tr.notes.filter((n) => !(n.t >= gap && n.t < c0)); if (melodic.includes(tr.part)) for (const n of tr.notes) if (n.t < gap && n.t + n.d > gap) n.d = gap - n.t; }
      if (T.pre === 'swell') for (const tr of tracks) for (const n of tr.notes) if (n.t >= sw && n.t < c0) n.v = Math.max(10, Math.min(127, Math.round(n.v * (0.7 + 0.38 * (n.t - sw) / (c0 - sw)))));
      if (T.pre === 'fill') { const inBar = P.beat.notes.filter((n) => n.t >= c0 - BT && n.t < c0 && n.p !== kick), c2 = {}; inBar.forEach((n) => c2[n.p] = (c2[n.p] || 0) + 1); const sn = Number(Object.keys(c2).sort((a, b) => c2[b] - c2[a])[0]);
        if (!isNaN(sn)) { P.beat.notes = P.beat.notes.filter((n) => !(n.t >= gap && n.t < c0 && n.p !== kick)); for (let k2 = 0; k2 < 8; k2++) P.beat.notes.push({ t: gap + k2 * BT / 16, d: 60, v: Math.min(127, 60 + k2 * 8), p: sn }); P.beat.notes.sort((a, b) => a.t - b.t); } }
      for (const tr of tracks) for (const n of tr.notes) if (n.t >= c0 && n.t < c0 + 60) n.v = Math.min(127, n.v + 8); });
    // breathing
    const ends = T.breath === 'every8' ? Array.from({ length: Math.floor(b0 / 8) }, (_, k) => (k + 1) * 8) : T.breath === 'sections' ? secs.slice(1).map((x) => x.from) : [];
    for (const b of ends) { const e = b * BT, br = e - BT / 4; if (T.pre === 'silence' && secs.some((x) => isCh(x) && x.from === b)) continue;
      for (const part of ['melody', 'answer', 'chords']) { const tr = P[part]; tr.notes = tr.notes.filter((n) => !(n.t >= br && n.t < e)); for (const n of tr.notes) if (n.t < br && n.t + n.d > br) n.d = Math.max(60, br - n.t); } }
    // a moment of its own
    if (T.moment !== 'none') { const brk = secs.find((x) => x.type === 'break' && x.to - x.from >= 4), v1 = secs.find((x) => x.type === 'verse' && x.to - x.from >= 4);
      const win = brk ? [brk.from * BT, (brk.from + Math.floor((brk.to - brk.from) / 2)) * BT] : v1 ? [(v1.to - 1) * BT, v1.to * BT] : null;
      if (win) { const only = T.moment === 'beat' ? null : T.moment; if (!only || P[only].notes.some((n) => n.t >= win[0] && n.t < win[1])) for (const p of melodic) if (p !== only) P[p].notes = P[p].notes.filter((n) => !(n.t >= win[0] && n.t < win[1])); } }
    tracks.tools = T; return tracks;
  }
  const CARRIES = new Set(['tune', 'unison', 'tutti', 'call', 'canon', 'finale']);
  function react(tracks, choir, BT) {
    const role = []; choir.markers.forEach((m, k) => { const b0 = Math.round(m.t / BT), b1 = k + 1 < choir.markers.length ? Math.round(choir.markers[k + 1].t / BT) : 1e6; for (let b = b0; b < Math.min(b1, b0 + 4096); b++) role[b] = choir.roles[k]; });
    const sing = new Set(); for (const n of choir.notes) for (let b = Math.floor(n.t / BT); b <= Math.floor((n.t + n.d - 1) / BT); b++) sing.add(b);
    const starts = choir.notes.map((n) => n.t).sort((a, b) => a - b), near = (t, w) => { let lo = 0, hi = starts.length; while (lo < hi) { const m = (lo + hi) >> 1; if (starts[m] < t - w) lo = m + 1; else hi = m; } return lo < starts.length && starts[lo] <= t + w; };
    for (const tr of tracks) { const bar = (n) => Math.floor(n.t / BT);
      if (tr.part === 'pad') tr.notes = tr.notes.filter((n) => !sing.has(bar(n)));
      if (tr.part === 'melody') tr.notes = tr.notes.filter((n) => !(sing.has(bar(n)) && CARRIES.has(role[bar(n)])));
      if (tr.part === 'answer') tr.notes = tr.notes.filter((n) => !sing.has(bar(n)) || !near(n.t, PPQ)); }
    return tracks;
  }
  // the same song again with the beat for another drum app; the choir stays as it was
  function rebeat(r, beat) { const s = r.song, BT = D.barTicks(s), markers = []; let bar = 0; const cnt = {};
    for (const sec of s.sections) { cnt[sec.type] = (cnt[sec.type] || 0) + 1; markers.push({ t: bar * BT, text: sec.type[0].toUpperCase() + sec.type.slice(1) + ' ' + cnt[sec.type] }); bar += sec.bars; }
    r.file = withChoir(noConductor(bandMidi(s, markers, react(arrange(bandTracks(s, beat), s, r.p.genre, r.p.seed, r.p.tools), r.choir, BT))), r.choir, 'Choir'); r.beat = beat; return r; }
  const BEATS = Object.keys(D.PLUGINS).filter((k) => { const p = D.PLUGINS[k]; return k !== 'plain' && (!p.parts || p.parts.includes('beat')); });
  function compose(o, onStep) {
    const history = o.history || [], n = o.sketches || 4, base = o.seed || (Math.floor(Math.random() * 1e9) + 1); let best = null, i = 0;
    return new Promise((resolve, reject) => { const step = () => { try {
      const p = plan(o.genre, o.hint, (base + i * 7919) >>> 0), s = build(p, Object.assign({}, o.hint, { beat: o.beat })), j = judge(s.A, s.choir, p, history);
      if (!best || j.score > best.j.score) best = { p, s, j }; i++; if (onStep) onStep(i, n);
      if (i < n) setTimeout(step, 20); else { const r = finish(best); r.beat = o.beat || 'gm'; resolve(r); } } catch (e) { reject(e); } }; setTimeout(step, 20); });
  }
  function finish(b) {
    const { p, s, j } = b, sg = s.s; let name = C.makeName(p.seed); for (let k = 1; k < 9; k++) { const w = name.toLowerCase().split(' ').filter((x) => x.length > 3); if (new Set(w).size === w.length) break; name = C.makeName(p.seed + k * 977); }
    const file = withChoir(noConductor(s.bytes), s.choir, 'Choir'), G = D.GENRES[p.genre], key = NOTE[sg.key.root] + ' ' + sg.key.scale, who = p.men && p.women ? 'men and women' : p.men ? 'men' : 'women';
    const BT = D.barTicks(sg); let bar = 0; const parts = sg.sections.map((x) => { const r = { t: bar * BT, text: x.type }; bar += x.bars; return r; });
    return { name, file, p, song: sg, choir: s.choir, A: s.A, judge: j, parts, seconds: Math.round(s.choir.seconds), title: G.name + ' · ' + key + ' · ' + Math.round(sg.bpm) + ' bpm',
      choices: [G.name, C.STYLES[p.style].name + ' choir, ' + who], fileName: ('DM_Anthem_' + name + '_' + G.name + '_' + NOTE[sg.key.root] + '_' + sg.key.scale + '_' + Math.round(sg.bpm) + 'bpm').replace(/[^\w]+/g, '_') + '.mid' };
  }
  // what a dropped file says, turned into a genre, and a key and tempo when it has them
  async function hear(file) { const h = await listen(file); if (h.key !== undefined || /\.midi?$/i.test(file.name)) { try { const M = C.parseMidi(await file.arrayBuffer()); h.bpm = 60000000 / M.tempos[0].us; } catch (e) { /* no tempo */ } } return h; }
  root.Anthem = { plan, compose, hear, fromText, rebeat, BEATS, GENRES, FEEL_GENRES };
})(typeof window !== 'undefined' ? window : globalThis);
