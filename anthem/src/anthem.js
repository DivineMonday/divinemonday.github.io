/* Divine Anthem: one button, a whole track with band, beat and choir.
   The Music Studio engine writes the song, the Choir Machine sings with it; the machine sketches several, keeps the best,
   and remembers what it gave you. The ear and the judge are shared with Divine Opus. */
(function (root) {
  const D = root.DMM, C = root.Choir, PPQ = D.PPQ;
  const FEELINGS = { heroic: { name: 'Heroic' }, tender: { name: 'Tender' }, mysterious: { name: 'Mysterious' }, joyful: { name: 'Joyful' }, melancholy: { name: 'Melancholy' }, stormy: { name: 'Stormy' }, dreamy: { name: 'Dreamy' }, solemn: { name: 'Solemn' } };
  const Y = { FEELINGS }, FEELS = Object.keys(FEELINGS);
  const MAJ = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'], MIN = MAJ.map((x) => x.toLowerCase());
/*SHARED*/
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
    return { genre: g, style, men, women, seed, era: g, chain: [{ form: 'song' }] };
  }
  function build(p, hint) {
    const s = D.newSong(p.genre, { seed: p.seed }); hint = hint || {};
    if (hint.key) { const m = /^([A-Ga-g][#b]?)$/.exec(hint.key); if (m) { const minor = hint.key === hint.key.toLowerCase(), i = MAJ.findIndex((x) => x.toLowerCase() === hint.key.toLowerCase()); if (i >= 0) { s.key = { root: i, scale: minor ? 'minor' : 'major' }; s.keyAuto = false; } } }
    const G = D.GENRES[p.genre]; if (hint.bpm && G.bpm) { let b = hint.bpm; while (b < G.bpm[0]) b *= 2; while (b > G.bpm[1]) b /= 2; if (b >= G.bpm[0] && b <= G.bpm[1]) { s.bpm = Math.round(b); s.bpmAuto = false; } }
    const BT = D.barTicks(s), markers = []; let bar = 0; const cnt = {};
    for (const sec of s.sections) { cnt[sec.type] = (cnt[sec.type] || 0) + 1; markers.push({ t: bar * BT, text: sec.type[0].toUpperCase() + sec.type.slice(1) + ' ' + cnt[sec.type] }); bar += sec.bars; }
    const tracks = bandTracks(s, hint.beat), first = bandMidi(s, markers, tracks);
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
    r.file = withChoir(noConductor(bandMidi(s, markers, react(bandTracks(s, beat), r.choir, BT))), r.choir, 'Choir'); r.beat = beat; return r; }
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
