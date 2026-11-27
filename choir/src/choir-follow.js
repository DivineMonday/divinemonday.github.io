/* Divine Choir Machine, phase 2: the choir joins your orchestra.
   Reads an orchestra MIDI, hears its key, chords, melody and strength, and writes a choir part that
   sings along, answers or carries. Same keyboard zones, same single MIDI out. */
(function (root) {
  const C = root.Choir || (typeof require !== 'undefined' ? require('./choir-engine.js') : null);
  const PPQ = C.PPQ;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

  // ---------- read a MIDI file ----------
  function parse(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let i = 0;
    const u32 = () => ((b[i++] << 24) | (b[i++] << 16) | (b[i++] << 8) | b[i++]) >>> 0, u16 = () => (b[i++] << 8) | b[i++];
    const vlq = () => { let v = 0, c; do { c = b[i++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80 && i < b.length); return v; };
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'MThd') throw new Error('This is not a MIDI file.');
    i = 4; const hl = u32(), fmt = u16(), ntr = u16(), div = u16(); i = 8 + hl;
    if (div & 0x8000) throw new Error('This MIDI uses SMPTE time; save it with beats and bars.');
    const f = PPQ / div, notes = [], tempos = [], sigs = [], marks = [];
    for (let k = 0; k < ntr && i < b.length; k++) {
      while (i < b.length && String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]) !== 'MTrk') i++;
      if (i >= b.length) break; i += 4; const len = u32(), end = i + len; let t = 0, rs = 0; const open = {};
      while (i < end) {
        t += vlq(); let st = b[i];
        if (st & 0x80) i++; else st = rs;
        if (st === 0xff) { const ty = b[i++], l = vlq(), d = b.subarray(i, i + l); i += l;
          if (ty === 0x51 && l === 3) tempos.push({ t: Math.round(t * f), us: (d[0] << 16) | (d[1] << 8) | d[2] });
          if (ty === 0x58 && l >= 2) sigs.push({ t: Math.round(t * f), num: d[0], den: 1 << d[1] });
          if ((ty === 0x06 || ty === 0x01) && l > 0 && l < 80) { try { marks.push({ t: Math.round(t * f), text: decodeURIComponent(escape(String.fromCharCode.apply(null, d))) }); } catch (e) { marks.push({ t: Math.round(t * f), text: String.fromCharCode.apply(null, d) }); } }
          if (ty === 0x2f) break; continue; }
        if (st === 0xf0 || st === 0xf7) { i += vlq(); continue; }
        rs = st; const hi = st & 0xf0, ch = st & 15;
        if (hi === 0xc0 || hi === 0xd0) { i += 1; continue; }
        const d1 = b[i++], d2 = b[i++];
        if (hi === 0x90 && d2 > 0) { (open[ch * 128 + d1] = open[ch * 128 + d1] || []).push({ t, v: d2 }); }
        else if (hi === 0x80 || (hi === 0x90 && d2 === 0)) { const q = open[ch * 128 + d1]; if (q && q.length) { const o = q.shift(); if (t > o.t) notes.push({ t: Math.round(o.t * f), d: Math.max(1, Math.round((t - o.t) * f)), p: d1, v: o.v, ch, trk: k }); } }
      }
      i = end;
    }
    notes.sort((a, b2) => a.t - b2.t || a.p - b2.p); tempos.sort((a, b2) => a.t - b2.t);
    return { fmt, notes, marks, tempos: tempos.length ? tempos : [{ t: 0, us: 500000 }], sig: sigs.sort((a, b2) => a.t - b2.t)[0] || { num: 4, den: 4 } };
  }

  const KMAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88], KMIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const corr = (h, prof, r) => { let mh = 0, mp = 0; for (let k = 0; k < 12; k++) { mh += h[k]; mp += prof[k]; } mh /= 12; mp /= 12; let n = 0, a = 0, c = 0; for (let k = 0; k < 12; k++) { const x = h[(k + r) % 12] - mh, y = prof[k] - mp; n += x * y; a += x * x; c += y * y; } return n / Math.sqrt(a * c || 1); };

  // ---------- listen to the orchestra ----------
  function analyse(M) {
    const all = M.notes.filter((n) => n.ch !== 9);
    if (!all.length) throw new Error('No notes found in this MIDI (drums only?).');
    const barT = Math.round(M.sig.num * (4 / M.sig.den) * PPQ), endT = Math.max(...all.map((n) => n.t + n.d));
    const bars = Math.max(1, Math.ceil((endT - 10) / barT)), segT = M.segT || (M.sig.num % 2 === 0 && M.sig.num >= 4 ? barT / 2 : barT);
    const h = new Array(12).fill(0); for (const n of all) h[n.p % 12] += n.d * n.v;
    let best = { s: -9 }; for (let r = 0; r < 12; r++) { const a = corr(h, KMAJ, r), m = corr(h, KMIN, r); if (a > best.s) best = { s: a, tonic: r, minor: false }; if (m > best.s) best = { s: m, tonic: r, minor: true }; }
    const scale = (best.minor ? [0, 2, 3, 5, 7, 8, 10, 11] : [0, 2, 4, 5, 7, 9, 11]).map((x) => (x + best.tonic) % 12);
    // chords, one per half bar (or per bar in threes)
    const nSeg = Math.ceil(bars * barT / segT), segs = [];
    for (let s = 0; s < nSeg; s++) {
      const a = s * segT, z = a + segT, w = new Array(12).fill(0), bw = new Array(12).fill(0); let tot = 0, low = 999;
      for (const n of all) { const o = Math.min(z, n.t + n.d) - Math.max(a, n.t); if (o <= 0) continue; const x = o * n.v; w[n.p % 12] += x; tot += x; if (n.p < low) low = n.p; }
      for (const n of all) { const o = Math.min(z, n.t + n.d) - Math.max(a, n.t); if (o > 0 && n.p <= low + 7) bw[n.p % 12] += o * n.v; }
      if (tot < segT * 20) { segs.push(null); continue; }
      let pick = null;
      for (let r = 0; r < 12; r++) for (const [q, iv, pen] of [['', [0, 4, 7], 0], ['m', [0, 3, 7], 0], ['dim', [0, 3, 6], 0.15]]) {
        const pcs = iv.map((x) => (x + r) % 12); let sc = 0; for (let k = 0; k < 12; k++) sc += pcs.includes(k) ? w[k] : -0.35 * w[k];
        sc = sc / tot + 0.5 * bw[r] / (tot || 1) + (pcs.every((p) => scale.includes(p)) ? 0.12 : 0) - pen;
        if (!pick || sc > pick.sc) pick = { sc, root: r, q, pcs };
      }
      segs.push(pick);
    }
    // the tune: the highest line, at most one note per slot
    const bpm0 = 60000000 / M.tempos[0].us, slot = bpm0 > 100 ? PPQ : PPQ / 2, mel = [];
    const hiNotes = all.filter((n) => n.p >= 55);
    for (let a = 0; a < bars * barT; a += slot) {
      const st = hiNotes.filter((n) => n.t >= a && n.t < a + slot && n.d >= slot / 3);
      let n = st.length ? st.reduce((x, y) => (y.p > x.p ? y : x)) : null;
      if (!n) { const prev = mel[mel.length - 1]; if (prev && prev.src.t + prev.src.d > a + slot / 2) { prev.d += slot; continue; } continue; }
      const prev = mel[mel.length - 1]; if (prev && prev.p === n.p && prev.t + prev.d >= a - 2 && n.t > prev.src.t + prev.src.d - 10) { mel.push({ t: a, d: slot, p: n.p, v: n.v, src: n }); continue; }
      if (prev && prev.t + prev.d > a) prev.d = a - prev.t;
      mel.push({ t: a, d: Math.min(slot, n.t + n.d - a) > 0 ? slot : slot, p: n.p, v: n.v, src: n });
    }
    for (let k = 0; k + 1 < mel.length; k++) { const a = mel[k], b2 = mel[k + 1]; const realEnd = a.src.t + a.src.d; a.d = Math.max(slot / 2, Math.min(b2.t - a.t, Math.max(a.d, realEnd - a.t))); }
    // strength per bar
    const dens = [], vel = []; for (let k = 0; k < bars; k++) { const on = all.filter((n) => n.t >= k * barT && n.t < (k + 1) * barT); dens.push(on.length); vel.push(on.length ? on.reduce((s, n) => s + n.v, 0) / on.length : 0); }
    const md = Math.max(1, ...dens), dyn = dens.map((d, k) => (d ? clamp(0.25 + 0.45 * (vel[k] / 127) + 0.35 * (d / md), 0.2, 1) : 0));
    const melCover = []; for (let k = 0; k < bars; k++) { let c = 0; for (const n of mel) { const o = Math.min((k + 1) * barT, n.t + n.d) - Math.max(k * barT, n.t); if (o > 0) c += o; } melCover.push(c / barT); }
    return { barT, bars, segT, segs, mel, slot, dyn, dens: dens.map((d) => d / md), melCover, tonic: best.tonic, minor: best.minor, scale, endT };
  }

  function rangesFor(Z, men, women) {
    if (men && women) return [['S', Z.womenLo - 3, Z.womenHi], ['A', Z.menHi + 3, Z.womenLo + 5], ['T', Z.menLo + 8, Z.womenLo - 4], ['B', Z.menLo, Z.menHi + 4]];
    if (women) return [['S', Z.womenLo + 3, Z.womenHi], ['A', Z.womenLo, Z.womenHi - 5]];
    return [['T', Z.menLo + 5, Z.menHi], ['B', Z.menLo, Z.menHi - 5]];
  }
  // the best way to sing a chord: little movement, root in the bass, all tones present, no crossing
  function voice(ch, rg, prev, maxTop) {
    const cand = rg.map(([, lo, hi], k) => { const c = []; const top = k === 0 && maxTop != null ? Math.min(hi, maxTop) : hi; for (let p = lo; p <= top; p++) if (ch.pcs.includes(p % 12)) c.push(p); return c.length ? c : [clamp(lo, lo, top)]; });
    let best = null; const cur = [];
    const go = (k) => {
      if (k === rg.length) {
        let sc = 0; for (let j = 0; j < cur.length; j++) { const pv = prev && prev[j]; sc += pv ? Math.abs(cur[j] - pv) * 1.2 : 0; if (j && cur[j] >= cur[j - 1]) sc += 50; if (j && j < cur.length - 1 && cur[j - 1] - cur[j] > 12) sc += 8; }
        const pcs = new Set(cur.map((p) => p % 12)); for (const p of ch.pcs) if (!pcs.has(p)) sc += p === ch.pcs[1] ? 14 : 6;
        if (rg[rg.length - 1][0] === 'B' || rg.length === 2) { if (cur[cur.length - 1] % 12 !== ch.root) sc += 9; }
        if (!best || sc < best.sc) best = { sc, v: cur.slice() }; return;
      }
      for (const p of cand[k]) { if (k && p >= cur[k - 1]) continue; cur[k] = p; go(k + 1); } if (k && !best && cand[k].length) { cur[k] = cand[k][0]; go(k + 1); }
    };
    go(0); return best ? best.v : rg.map(([, lo, hi]) => (lo + hi) >> 1);
  }
  const intoRange = (p, lo, hi, near) => { let x = p; while (x < lo) x += 12; while (x > hi) x -= 12; if (near != null) { if (x - 12 >= lo && Math.abs(x - 12 - near) < Math.abs(x - near)) x -= 12; if (x + 12 <= hi && Math.abs(x + 12 - near) < Math.abs(x - near)) x += 12; } return clamp(x, lo, hi); };
  const snapTo = (p, pcs) => { for (let d = 0; d < 7; d++) { if (pcs.includes(((p + d) % 12 + 12) % 12)) return p + d; if (pcs.includes(((p - d) % 12 + 12) % 12)) return p - d; } return p; };

  // ---------- the choir joins: it hears the story of the orchestra and tells its own along with it ----------
  const ROLE_TEXT = { rest: 'the orchestra alone', pad: 'held chords', padHigh: 'women hold, high and soft', padLow: 'men hold, low and dark', tune: 'the choir sings the tune', unison: 'the tune in octaves', answer: 'the choir answers', canon: 'canon, the men follow', call: 'a leader calls, the choir answers', stabs: 'rhythm on the chords', drone: 'men drone, women chant', tutti: 'everyone, full voice', finale: 'finale, the last chord held' };
  const POOLS = {
    film: ['padHigh', 'padLow', 'unison', 'answer', 'pad', 'tune', 'padHigh'],
    gospel: ['call', 'stabs', 'pad', 'call', 'tune'],
    baroque: ['tune', 'pad', 'answer', 'canon', 'stabs'],
    polyphony: ['canon', 'pad', 'answer', 'padHigh', 'tune'],
    gregorian: ['unison', 'drone', 'answer', 'unison', 'padLow']
  };
  const MODES = { story: 'Story' };

  function follow(bytes, o) {
    o = o || {}; const Z = Object.assign({}, C.ZONES, o.zones || {}), style = POOLS[o.style] ? o.style : 'film';
    let men = o.men !== false, women = o.women !== false; if (!men && !women) men = women = true; const both = men && women;
    const M = parse(bytes), A = analyse(M), R = rng(o.seed || 7), pick = (a) => a[Math.floor(R() * a.length)], chance = (p) => R() < p;
    const barT = A.barT, bars = A.bars, out = [];
    const add = (t, d, p, v, vc, lead) => { t = Math.round(t); d = Math.round(d); if (d > 40 && t < A.endT) out.push({ t, d: Math.min(d, A.endT + barT - t), p, v: clamp(v, 0.08, 1), voice: vc, lead: !!lead }); };
    const chAt = (t) => A.segs[Math.floor(t / A.segT)];
    const color = (ch) => { if (!ch) return ch; const pcs = ch.pcs.slice(), r = ch.root;
      if (style === 'gospel') { if (ch.q === '' && r === (A.tonic + 7) % 12) pcs.push((r + 10) % 12); else if (ch.q === 'm') pcs.push((r + 10) % 12); else if (ch.q === '') pcs.push((r + 2) % 12); }
      if (style === 'film' && ch.q !== 'dim' && chance(0.3)) pcs.push((r + 2) % 12);
      return { root: r, q: ch.q, pcs }; };

    // ----- the sections of the orchestra: its own markers, or blocks of bars -----
    let secs = [];
    const mk = []; for (const m of M.marks.slice().sort((a, b) => a.t - b.t)) { const bar = Math.round(m.t / barT), text = m.text.replace(/\s+/g, ' ').trim(); if (!text || bar >= bars - 1) continue; const last = mk[mk.length - 1]; if (last && (last.bar === bar || last.text === text)) continue; mk.push({ bar, text }); }
    if (mk.length >= 2) { if (mk[0].bar > 0) mk.unshift({ bar: 0, text: 'Opening' }); mk.forEach((m, k) => secs.push({ from: m.bar, to: k + 1 < mk.length ? mk[k + 1].bar : bars, label: m.text })); }
    else { const L = bars >= 48 ? 8 : 4; for (let b = 0; b < bars; b += L) secs.push({ from: b, to: Math.min(bars, b + L), label: 'Bars ' + (b + 1) + ' to ' + Math.min(bars, b + L) }); }
    secs = secs.filter((s) => s.to > s.from); for (let k = secs.length - 1; k > 0; k--) if (secs[k].to - secs[k].from < 2) { secs[k - 1].to = secs[k].to; secs.splice(k, 1); }
    if (secs.length > 1 && secs[0].to - secs[0].from < 3) { secs[1].from = 0; secs.shift(); }
    // a long section is two chapters
    const split = []; for (const s of secs) { if (s.to - s.from >= 20) { const h = s.from + Math.round((s.to - s.from) / 8) * 4; split.push({ from: s.from, to: h, label: s.label }, { from: h, to: s.to, label: s.label + ', later' }); } else split.push(s); } secs = split;
    for (const s of secs) { const d = A.dyn.slice(s.from, s.to), c = A.melCover.slice(s.from, s.to); s.dyn = d.reduce((a, x) => a + x, 0) / d.length || 0; s.cover = c.reduce((a, x) => a + x, 0) / c.length || 0;
      const sg = A.segs.slice(Math.floor(s.from * barT / A.segT), Math.ceil(s.to * barT / A.segT)).filter(Boolean); s.minor = sg.length ? sg.filter((x) => x.q !== '').length / sg.length > 0.55 : false; }

    // ----- the story: silence first, a climax where the orchestra is strongest, a held last chord -----
    const n = secs.length, roles = new Array(n).fill(null);
    let cl = n - 1; if (n >= 3) { let best = -1; for (let k = Math.floor(n * 0.4); k < n - 1; k++) { const sc = secs[k].dyn + 0.25 * k / (n - 1); if (sc > best) { best = sc; cl = k; } }
      if (secs[n - 2].label === secs[n - 1].label.replace(', later', '')) cl = n - 2; }
    roles[n - 1] = 'finale';
    if (cl < n - 1) { const all = secs.reduce((a, s) => a + s.to - s.from, 0), cap = Math.max(16, all * 0.16); let used = 0;
      for (let k = n - 2; k >= cl; k--) { const L = secs[k].to - secs[k].from; if (k !== cl && used + L > cap) { cl = k + 1; break; } roles[k] = 'tutti'; used += L; } }
    if (n >= 4) roles[0] = 'rest'; else if (!roles[0]) roles[0] = both ? 'padHigh' : 'pad';
    let rested = n < 4;
    for (let k = 1; k < n; k++) { if (roles[k]) continue;
      const s = secs[k], c = POOLS[style].slice();
      if (s.minor) c.push(both ? 'padLow' : 'pad', both ? 'padLow' : 'pad', style === 'gospel' ? 'pad' : 'unison');
      if (s.dyn < 0.45) c.push('padHigh', 'pad'); if (s.cover < 0.35) c.push('answer', 'answer');
      if (k === cl - 1) c.push(style === 'gospel' ? 'stabs' : 'tune', 'tune');
      const fresh = c.filter((x) => x !== roles[k - 1] && x !== roles[k - 2]); let r = pick(fresh.length ? fresh : c.filter((x) => x !== roles[k - 1])) || 'pad';
      if (!rested && n >= 6 && k >= 3 && k < cl - 1 && roles[k - 1] !== 'rest' && chance(0.3)) { r = 'rest'; rested = true; }
      roles[k] = r; }
    if (n >= 4) {
      secs.forEach((s, k) => { if (k < cl && /^\d+\. /.test(s.label)) roles[k] = 'rest'; });
      const want = o.silence == null ? 0.3 : o.silence, total = secs.reduce((a, s) => a + s.to - s.from, 0);
      const quiet = () => secs.reduce((a, s, k) => a + (roles[k] === 'rest' ? s.to - s.from : 0), 0) / total;
      const cand = secs.map((s, k) => k).filter((k) => k > 0 && k < cl - 1 && roles[k] !== 'rest').sort((a, b) => (/minuet|scherzo|waltz|march|trio|da capo/i.test(secs[b].label) - /minuet|scherzo|waltz|march|trio|da capo/i.test(secs[a].label)) || secs[a].dyn - secs[b].dyn);
      for (const k of cand) { if (quiet() >= want) break; if (roles[k - 1] === 'rest' || roles[k + 1] === 'rest') continue; roles[k] = 'rest'; }
    }
    // a song is not a symphony: the choir knows verse from chorus
    // a song is not a symphony: the band owns the verses, the choir saves itself for the chorus, the break and the end
    const half = new Array(n).fill(false);
    if (o.song) {
      const type = (s) => (s.label.toLowerCase().match(/intro|verse|prechorus|chorus|build|drop|break|bridge|outro|fill/) || ['verse'])[0];
      const isCh = (s) => ['chorus', 'drop'].includes(type(s));
      const chIdx = secs.map((s, k) => (isCh(s) ? k : -1)).filter((k) => k >= 0), lastCh = chIdx[chIdx.length - 1], firstCh = chIdx[0];
      const lastBuild = secs.map((s, k) => (['prechorus', 'build'].includes(type(s)) && k < lastCh ? k : -1)).filter((k) => k >= 0).pop();
      secs.forEach((s, k) => { const t = type(s);
        if (t === 'intro' || t === 'fill' || t === 'verse') roles[k] = 'rest';
        else if (t === 'prechorus' || t === 'build') roles[k] = k === lastBuild ? (style === 'gospel' ? 'stabs' : 'unison') : 'rest';
        else if (isCh(s)) { roles[k] = k === firstCh || (secs[k - 1] && isCh(secs[k - 1]) && k - 1 === firstCh) ? (style === 'gospel' ? 'stabs' : 'tune') : 'tutti'; if (k === firstCh) half[k] = true; }
        else if (t === 'break' || t === 'bridge') roles[k] = pick(style === 'gregorian' ? ['drone', 'unison'] : style === 'gospel' ? ['call', 'padHigh'] : ['padHigh', 'unison', 'canon']);
        else if (t === 'outro') roles[k] = 'finale'; });
      if (!roles.includes('finale')) roles[n - 1] = 'finale';
      // never more than about 45 percent of the song
      const total = secs.reduce((a, s) => a + s.to - s.from, 0), used = () => secs.reduce((a, s, k) => a + (roles[k] === 'rest' ? 0 : (s.to - s.from) * (half[k] ? 0.5 : 1)), 0);
      const order = secs.map((s, k) => k).filter((k) => roles[k] !== 'rest' && roles[k] !== 'finale').sort((a, b) => (['prechorus', 'build'].includes(type(secs[b])) - ['prechorus', 'build'].includes(type(secs[a]))) || (isCh(secs[a]) - isCh(secs[b])) || (b === lastCh) - (a === lastCh));
      for (const k of order) { if (used() <= total * 0.45) break; if (k === lastCh) continue; if (isCh(secs[k]) && !half[k]) half[k] = true; else roles[k] = 'rest'; }
    }
    const fit = (r) => { if (both) return r; if (men) return { padHigh: 'pad', padLow: 'pad', canon: 'tune', drone: 'unison' }[r] || r; return { padLow: 'pad', drone: 'unison', canon: 'tune' }[r] || r; };
    secs.forEach((s, k) => { s.role = fit(roles[k]); s.start = s.from; if (['pad', 'padHigh', 'padLow', 'unison', 'tune'].includes(s.role) && s.to - s.from >= 12 && k > 0 && chance(0.35)) s.start = s.from + Math.floor((s.to - s.from) / 8) * 4; });
    if (o.song) secs.forEach((s, k) => { s.start = half[k] && s.to - s.from >= 4 ? s.from + Math.max(2, Math.floor((s.to - s.from) / 4) * 2) : s.from; });

    // ----- the voices -----
    const rgFull = rangesFor(Z, men, women), rgMen = rangesFor(Z, true, false), rgWom = rangesFor(Z, false, true);
    const phraseOf = (t, from) => Math.floor((t - from * barT) / (4 * barT));
    const blocksIn = (from, to) => { const r = []; for (let s = Math.floor(from * barT / A.segT); s < Math.ceil(to * barT / A.segT); s++) { const ch = A.segs[s]; if (!ch) continue; const t = s * A.segT, last = r[r.length - 1];
      if (last && last.ch.root === ch.root && last.ch.q === ch.q && last.t + last.d === t && phraseOf(t, from) === phraseOf(last.t, from)) last.d += A.segT; else r.push({ t, d: A.segT, ch: color(ch) }); } return r; };
    // held chords: a note that stays in the next chord is held, not sung again; a breath only where the phrase ends
    const pad = (from, to, rg, mul, capFn, hold) => {
      const bl = blocksIn(from, to); let prev = null; const cur = rg.map(() => null);
      const flush = (k) => { const c = cur[k]; if (c) add(c.t, c.e - c.t, c.p, c.v, rg[k][0]); cur[k] = null; };
      for (const b of bl) {
        const cap = capFn ? capFn(b) : null, r2 = rg.map(([nm, lo, hi], k) => [nm, lo, k === 0 && cap != null ? Math.max(lo, Math.min(hi, cap)) : hi]);
        const v = voice(b.ch, r2, prev); prev = v; const ph = phraseOf(b.t, from), endP = (from + (ph + 1) * 4) * barT, e = b.t + b.d, brk = hold ? false : e >= Math.min(endP, to * barT);
        v.forEach((p, k) => { const c = cur[k]; const dy = (A.dyn[Math.floor(b.t / barT)] || 0.3) * mul;
          if (c && c.p === p && c.e === b.t && c.ph === ph) { c.e = e; c.v = Math.max(c.v, dy); } else { flush(k); cur[k] = { t: b.t, e, p, v: dy, ph }; }
          if (brk) { cur[k].e -= 110; flush(k); } });
      }
      rg.forEach((_, k) => flush(k));
    };
    // the tune of the orchestra, simplified to what a choir can sing
    const bpmAt = (t) => { let us = M.tempos[0].us; for (const tp of M.tempos) { if (tp.t > t) break; us = tp.us; } return 60000000 / us; };
    const unitAt = (t) => { const b = bpmAt(t); return b < 72 ? PPQ / 2 : b < 110 ? PPQ : 2 * PPQ; };
    const tuneIn = (from, to) => { const r = [], unit = unitAt(from * barT); for (let t = from * barT; t < to * barT; t += unit) { const m = A.mel.find((x) => x.t <= t && x.t + x.d > t); if (!m) continue; const l = r[r.length - 1];
      if (l && l.p === m.p && l.t + l.d === t && m.t < t) l.d += unit; else r.push({ t, d: unit, p: m.p }); } return r; };
    const place = (tn, lo, hi, from) => { let near = null; return tn.map((x) => { const p = intoRange(x.p, lo, hi, near); near = p; const ph = phraseOf(x.t, from), endP = (from + (ph + 1) * 4) * barT; return { t: x.t, d: x.t + x.d >= endP - 10 ? Math.max(60, endP - x.t - 110) : x.d - 15, p }; }); };
    const sing = (tn, vc, v, lead) => { for (const x of tn) add(x.t, x.d, x.p, (A.dyn[Math.floor(x.t / barT)] || 0.4) * v, vc, lead); };
    const stabsOn = (from, to, rg, mul) => { let prev = null; for (const b of blocksIn(from, to)) { const D = b.d / PPQ; let rh = D >= 3.5 ? pick([[1.5, 1.5, 1], [0.5, 1, 0.5, 2], [1, 1, 2], [1.5, 0.5, 2]]) : D >= 1.5 ? pick([[0.75, 0.75, 0.5], [1.5, 0.5], [1, 1], [0.5, 1, 0.5]]) : [D];
      const tot = rh.reduce((a, x) => a + x, 0); rh = rh.map((x) => x * b.d / tot); const v = voice(b.ch, rg, prev); prev = v; let t = b.t;
      rh.forEach((du, k) => { v.forEach((p, j) => add(t, du * 0.8, p, (A.dyn[Math.floor(t / barT)] || 0.5) * mul + (k === 0 ? 0.08 : 0), rg[j][0], j === 0)); t += du; }); } };

    for (let k = 0; k < n; k++) {
      const s = secs[k], from = s.start, to = s.to, role = s.role;
      const topLow = (tn) => (b) => { const inB = tn.filter((x) => x.t < b.t + b.d && x.t + x.d > b.t); return inB.length ? Math.min(...inB.map((x) => x.p)) - 3 : null; };
      if (role === 'rest') continue;
      if (role === 'pad') pad(from, to, rgFull, 0.72);
      else if (role === 'padHigh') pad(from, to, rgWom, 0.6);
      else if (role === 'padLow') pad(from, to, rgMen, 0.68);
      else if (role === 'tune' || role === 'tutti') { const top = rgFull[0], tn = place(tuneIn(from, to), top[1], top[2], from); sing(tn, top[0], role === 'tutti' ? 1 : 0.85, true); if (rgFull.length > 1) pad(from, to, rgFull.slice(1), role === 'tutti' ? 0.9 : 0.72, topLow(tn)); }
      else if (role === 'unison') { const raw = tuneIn(from, to); if (women) sing(place(raw, men ? Z.womenLo - 3 : rgWom[0][1], men ? Z.womenHi - 2 : rgWom[0][2], from), 'S', 0.8, true); if (men) sing(place(raw, Z.menLo + 5, Z.menHi + (women ? 4 : 0), from), 'T', 0.8, !women); }
      else if (role === 'drone') { const tn = place(tuneIn(from, to), men ? Z.womenLo - 3 : rgWom[0][1], men ? Z.womenHi - 2 : rgWom[0][2], from); if (women) sing(tn, 'S', 0.75, true); const dp = Z.menLo + ((A.tonic - Z.menLo) % 12 + 12) % 12;
        for (let b = from; b < to; b += 4) { const e = Math.min(to, b + 4); add(b * barT, (e - b) * barT - 110, dp, (A.dyn[b] || 0.4) * 0.6, 'B'); if (dp + 7 <= Z.menHi) add(b * barT, (e - b) * barT - 110, dp + 7, (A.dyn[b] || 0.4) * 0.5, 'T'); } }
      else if (role === 'canon') { const top = rgWom[0], tn = place(tuneIn(from, to), top[1], top[2], from); sing(tn, 'S', 0.8, true); const T = rgMen[0]; let prevF = null;
        for (const x of tn) { const t = x.t + barT; if (t + 60 >= to * barT) continue; const ch = chAt(t); let p = intoRange(x.p - 24, T[1], T[2], prevF); if (ch) p = clamp(snapTo(p, ch.pcs), T[1], T[2]); prevF = p; add(t, Math.min(x.d, to * barT - t - 110), p, (A.dyn[Math.floor(t / barT)] || 0.4) * 0.72, 'T', true); }
        pad(from, to, [rgMen[1]], 0.55); }
      else if (role === 'answer') {
        const gaps = []; for (let b = from + 1; b < to; b++) if ((A.melCover[b] < 0.3 || A.dens[b] < 0.3) && A.segs[Math.floor(b * barT / A.segT)]) gaps.push(b);
        const at = gaps.length >= Math.max(1, (to - from) / 8) ? gaps : []; if (!at.length) for (let b = from + 3; b < to; b += 4) at.push(b);
        let turn = chance(0.5) ? 'women' : 'men';
        for (const b of at) { const g = both ? turn : men ? 'men' : 'women'; turn = turn === 'men' ? 'women' : 'men'; const rg = g === 'men' ? rgMen : rgWom;
          let src = b - 1; while (src > from && A.melCover[src] < 0.3) src--; const off = (b - src) * barT; let near = null; const tops = [];
          for (const x of tuneIn(src, src + 1)) { const t = x.t + off; const ch = chAt(t); if (!ch) continue; const p = clamp(snapTo(intoRange(x.p, rg[0][1], rg[0][2], near), ch.pcs), rg[0][1], rg[0][2]); near = p; tops.push(p); add(t, Math.min(x.d - 15, (b + 1) * barT - t - 110), p, (A.dyn[src] || 0.5) * 0.85, rg[0][0], true); }
          pad(b, b + 1, [rg[1]], 0.6, tops.length ? () => Math.min(...tops) - 3 : null); } }
      else if (role === 'call') {
        for (let b = from; b < to; b += 4) { const e = Math.min(to, b + 4), mid = Math.min(e, b + 2), g = both ? (((b - from) / 4) % 2 ? 'men' : 'women') : men ? 'men' : 'women', L = g === 'men' ? rgMen[0] : rgWom[0];
          sing(place(tuneIn(b, mid), L[1], L[2], b), L[0], 0.9, true); if (e > mid) stabsOn(mid, e, rgFull, 0.85); } }
      else if (role === 'stabs') stabsOn(from, to, rgFull, 0.85);
      else if (role === 'finale') { const hold = Math.max(from, to - 2); if (hold > from) { const top = rgFull[0], tn = place(tuneIn(from, hold), top[1], top[2], from); sing(tn, top[0], 1, true); if (rgFull.length > 1) pad(from, hold, rgFull.slice(1), 0.9, topLow(tn)); }
        let last = null; for (let sgi = Math.ceil(to * barT / A.segT) - 1; sgi >= 0 && !last; sgi--) last = A.segs[sgi];
        if (last) { const v = voice(color(last), rgFull, null); const t0 = hold * barT, d0 = Math.max(barT, A.endT - t0 + barT / 2); v.forEach((p, j) => add(t0, d0, p, Math.max(0.75, A.dyn[hold] || 0.7), rgFull[j][0], j === 0)); } }
    }
    // the last pass: the choir listens to what the orchestra really plays and moves away from a half-step rub
    const orch = M.notes.filter((x) => x.ch !== 9), SL = PPQ / 2, grid = new Map();
    for (const x of orch) for (let t = Math.ceil(x.t / SL) * SL; t < x.t + x.d; t += SL) { let g = grid.get(t); if (!g) grid.set(t, (g = new Array(12).fill(0))); g[x.p % 12] += x.d >= PPQ ? 2 : 1; }
    const lim = {}; for (const rg of [rgFull, rgMen, rgWom]) for (const [nm, lo, hi] of rg) { const l = lim[nm]; lim[nm] = l ? [Math.min(l[0], lo), Math.max(l[1], hi)] : [lo, hi]; }
    const rubOf = (p, n) => { let r = 0, c = 0; for (let t = Math.ceil(n.t / SL) * SL; t < n.t + n.d; t += SL) { const g = grid.get(t); if (!g) continue; c++; const pc = ((p % 12) + 12) % 12; r += (g[(pc + 1) % 12] + g[(pc + 11) % 12]) / Math.max(1, g[pc] + 1); } return c ? r / c : 0; };
    for (const x of out) { const r0 = rubOf(x.p, x); if (r0 < 0.5) continue; const L = lim[x.voice] || [Z.menLo, Z.womenHi]; let best = x.p, bs = r0;
      for (const d of [1, -1, 2, -2, 3, -3]) { const q = x.p + d; if (q < L[0] || q > L[1] || (!women && q > Z.menHi) || (!men && q < Z.womenLo)) continue; const sc = rubOf(q, x) + Math.abs(d) * 0.08; if (sc < bs) { bs = sc; best = q; } }
      x.p = best; }
    for (const x of out) { const m = A.mel.filter((y) => y.t < x.t + x.d && y.t + y.d > x.t); if (!m.length || x.lead) continue;
      if (!m.some((y) => { const d = Math.abs(y.p - x.p); return d > 0 && d <= 2; })) continue; const L = lim[x.voice] || [Z.menLo, Z.womenHi];
      if (x.p - 12 >= L[0] && (women || x.p - 12 <= Z.menHi) && (men || x.p - 12 >= Z.womenLo)) x.p -= 12; else { const y = m[0].p; let q = y; while (q > L[1]) q -= 12; while (q < L[0]) q += 12; if (q <= L[1]) x.p = q; } }
    return finish(out, M, A, secs, Z, men, women, style, o);
  }

  function finish(notes, M, A, secs, Z, men, women, style, o) {
    for (const n of notes) n.vel = clamp(Math.round(22 + 100 * n.v + (n.lead ? 6 : 0)), 14, 124);
    notes.sort((a, b) => a.p - b.p || a.t - b.t);
    const merged = []; for (const n of notes) { const m = merged.length && merged[merged.length - 1]; if (m && m.p === n.p && n.t < m.t + m.d) { m.d = Math.max(m.d, n.t + n.d - m.t); m.vel = Math.max(m.vel, n.vel); continue; } merged.push(Object.assign({}, n)); }
    merged.sort((a, b) => a.t - b.t || a.p - b.p);
    const H = rng((o.seed || 7) * 13 + 5), hi = (a, b) => a + Math.floor(H() * (b - a + 1)), lean = {};
    for (const n of merged) { if (n.t > 0) { if (lean[n.voice] == null) lean[n.voice] = hi(-10, 10) + (n.voice === 'B' ? 5 : 0); const e = n.t + n.d; n.t = Math.max(0, n.t + lean[n.voice] + hi(-8, 8) - (n.lead ? 6 : 0)); n.d = Math.max(40, e + hi(-20, 10) - n.t); } n.vel = clamp(n.vel + hi(-6, 6), 10, 126); }
    merged.sort((a, b) => a.t - b.t || a.p - b.p);
    const byP = {}; for (const n of merged) { const q = byP[n.p]; if (q && q.t + q.d > n.t - 20) q.d = Math.max(30, n.t - 20 - q.t); byP[n.p] = n; }
    let poly = 0, cur = 0; const ev = []; for (const n of merged) ev.push([n.t, 1], [n.t + n.d, -1]); ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); for (const [, d] of ev) { cur += d; poly = Math.max(poly, cur); }
    const barT = A.barT, strip = [], markers = [], cc = [];
    for (const s of secs) {
      const inS = merged.filter((x) => x.t >= s.from * barT - 30 && x.t < s.to * barT);
      const mIn = men && inS.some((x) => x.voice === 'T' || x.voice === 'B'), wIn = women && inS.some((x) => x.voice === 'S' || x.voice === 'A');
      strip.push({ label: s.label, start: s.from * barT / PPQ, beats: (s.to - s.from) * barT / PPQ, men: mIn, women: wIn, role: ROLE_TEXT[s.role] });
      markers.push({ t: s.from * barT, text: s.label + ' · ' + (o.song && s.role === 'rest' ? 'the band alone' : ROLE_TEXT[s.role]) + (s.start > s.from ? ', from bar ' + (s.start + 1) : '') });
      // the swell: one arch per four bars, never pumping bar by bar
      const mul = s.role === 'rest' ? 0 : s.role === 'tutti' || s.role === 'finale' ? 1 : s.role === 'padHigh' ? 0.6 : 0.8;
      for (let t = s.from * barT; t < s.to * barT; t += PPQ / 2) { const ph = 4 * barT, x = ((t - s.start * barT) % ph + ph) % ph / ph, arch = Math.sin(Math.PI * Math.min(1, x * 0.8 + 0.1));
        const fin = s.role === 'finale' ? (t - s.from * barT) / ((s.to - s.from) * barT) * 0.25 : 0;
        cc.push({ t, v: clamp(Math.round(mul ? 28 + 90 * (s.dyn * mul) * (0.6 + 0.4 * arch) + 40 * fin : 20), 10, 124) }); }
    }
    let secsT = 0, lt = 0, us = M.tempos[0].us; for (const tp of M.tempos) { if (tp.t > A.endT) break; secsT += (tp.t - lt) / PPQ * us / 1e6; lt = tp.t; us = tp.us; } secsT += (A.endT - lt) / PPQ * us / 1e6;
    const bpm = 60000000 / M.tempos[0].us, key = NOTE[A.tonic] + ' ' + (A.minor ? 'minor' : 'major'), sty = (C.STYLES[style] || { name: 'Film' }).name;
    return { notes: merged.map((n) => ({ t: n.t, d: n.d, p: n.p, v: n.vel, voice: n.voice })), cc, markers, beats: A.bars * barT / PPQ, meter: M.sig.num, meterDen: M.sig.den, tempos: M.tempos, key, bpm, seconds: Math.round(secsT), strip,
      playMode: poly <= 1 ? 'legato' : 'keys', maxPoly: poly, zones: Z, desc: sty + ' choir with your orchestra · ' + key + ' · ' + A.bars + ' bars', fileTag: sty + 'WithOrchestra', mode: 'story', bars: A.bars, roles: secs.map((s) => s.role) };
  }
  C.follow = follow; C.FOLLOW_MODES = MODES; C.parseMidi = parse; C.analyseMidi = (bytes) => analyse(parse(bytes));
})(typeof window !== 'undefined' ? window : globalThis);
