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
