/* Divine Choir Machine, phase 2: the choir joins your orchestra.
   Reads an orchestra MIDI, hears its key, chords, melody and strength, and writes a choir part that
   sings along, answers or carries. Same keyboard zones, same single MIDI out. */
(function (root) {
  const C = root.Choir || (typeof require !== 'undefined' ? require('./choir-engine.js') : null);
  const PPQ = C.PPQ;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const MODES = { sing: 'Sing along', answer: 'Answer', carry: 'Carry' };

  // ---------- read a MIDI file ----------
  function parse(bytes) {
    const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes); let i = 0;
    const u32 = () => ((b[i++] << 24) | (b[i++] << 16) | (b[i++] << 8) | b[i++]) >>> 0, u16 = () => (b[i++] << 8) | b[i++];
    const vlq = () => { let v = 0, c; do { c = b[i++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80 && i < b.length); return v; };
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) !== 'MThd') throw new Error('This is not a MIDI file.');
    i = 4; const hl = u32(), fmt = u16(), ntr = u16(), div = u16(); i = 8 + hl;
    if (div & 0x8000) throw new Error('This MIDI uses SMPTE time; save it with beats and bars.');
    const f = PPQ / div, notes = [], tempos = [], sigs = [];
    for (let k = 0; k < ntr && i < b.length; k++) {
      while (i < b.length && String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]) !== 'MTrk') i++;
      if (i >= b.length) break; i += 4; const len = u32(), end = i + len; let t = 0, rs = 0; const open = {};
      while (i < end) {
        t += vlq(); let st = b[i];
        if (st & 0x80) i++; else st = rs;
        if (st === 0xff) { const ty = b[i++], l = vlq(), d = b.subarray(i, i + l); i += l;
          if (ty === 0x51 && l === 3) tempos.push({ t: Math.round(t * f), us: (d[0] << 16) | (d[1] << 8) | d[2] });
          if (ty === 0x58 && l >= 2) sigs.push({ t: Math.round(t * f), num: d[0], den: 1 << d[1] });
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
    return { fmt, notes, tempos: tempos.length ? tempos : [{ t: 0, us: 500000 }], sig: sigs.sort((a, b2) => a.t - b2.t)[0] || { num: 4, den: 4 } };
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

  // ---------- the choir joins ----------
  function follow(bytes, o) {
    o = o || {}; const Z = Object.assign({}, C.ZONES, o.zones || {}), mode = MODES[o.mode] ? o.mode : 'carry';
    let men = o.men !== false, women = o.women !== false; if (!men && !women) men = women = true;
    const M = parse(bytes); if (o.segT) M.segT = o.segT; const A = analyse(M), R = rng(o.seed || 7), ri = (a, b) => a + Math.floor(R() * (b - a + 1));
    const phraseBars = A.bars > 40 ? 4 : 2, out = [];
    const add = (t, d, p, v, vc, lead) => { if (d > 30) out.push({ t: Math.round(t), d: Math.round(d), p, v, voice: vc, lead: !!lead }); };
    const segAt = (t) => A.segs[Math.floor(t / A.segT)];
    const breathEnd = (t, end) => { const pb = phraseBars * A.barT, nb = (Math.floor(t / pb) + 1) * pb; return end > nb - 60 ? nb - 90 : end; };
    // which group sings in which bar
    const both = men && women; let groups = [];
    const rgFull = rangesFor(Z, men, women), rgMen = rangesFor(Z, true, false), rgWom = rangesFor(Z, false, true);
    // chord blocks: same chord joined, split at breaths
    const blocks = (fromBar, toBar) => { const r = []; for (let s = Math.floor(fromBar * A.barT / A.segT); s < Math.ceil(toBar * A.barT / A.segT); s++) { const ch = A.segs[s]; if (!ch) continue; const t = s * A.segT, last = r[r.length - 1], pb = phraseBars * A.barT;
      if (last && last.ch.root === ch.root && last.ch.q === ch.q && last.t + last.d === t && Math.floor(t / pb) === Math.floor(last.t / pb)) last.d += A.segT; else r.push({ t, d: A.segT, ch }); } return r; };
    const sing = (blk, rg, top) => { let prev = null; for (const b of blk) { const v = voice(b.ch, rg, prev, top ? top(b) : null); prev = v; v.forEach((p, k) => add(b.t, breathEnd(b.t, b.t + b.d) - b.t - 20, p, (A.dyn[Math.floor(b.t / A.barT)] || 0.4) * (k === 0 ? 0.95 : 0.85), rg[k][0])); } };

    if (mode === 'carry') {
      sing(blocks(0, A.bars), rgFull);
      groups = Array.from({ length: A.bars }, () => ({ men, women }));
    } else if (mode === 'sing') {
      const topR = rgFull[0]; let near = (topR[1] + topR[2]) >> 1; const melIn = [];
      for (const n of A.mel) { const p = intoRange(n.p, topR[1], topR[2], near); near = p; melIn.push({ t: n.t, d: n.d, p }); }
      for (const n of melIn) add(n.t, breathEnd(n.t, n.t + n.d) - n.t - 10, n.p, A.dyn[Math.floor(n.t / A.barT)] || 0.5, topR[0], true);
      const lower = rgFull.slice(1);
      // under the tune the others hold the chord; where the tune rests, everyone sings the chord
      const blk = blocks(0, A.bars); let prev = null;
      for (const b of blk) {
        const inBlk = melIn.filter((n) => n.t < b.t + b.d && n.t + n.d > b.t), lowMel = inBlk.length ? Math.min(...inBlk.map((n) => n.p)) : null;
        const rg = inBlk.length ? lower : rgFull; if (!rg.length) continue;
        const capped = rg.map(([nm, lo, hi]) => [nm, lo, lowMel != null ? Math.max(lo, Math.min(hi, lowMel - 3)) : hi]);
        const v = voice(b.ch, capped, prev && prev.length === capped.length ? prev : null); prev = v;
        v.forEach((p, k) => add(b.t, breathEnd(b.t, b.t + b.d) - b.t - 20, p, (A.dyn[Math.floor(b.t / A.barT)] || 0.4) * 0.8, capped[k][0]));
      }
      groups = Array.from({ length: A.bars }, () => ({ men, women }));
    } else {
      // answer: the choir sings where the orchestra breathes, echoing the tune it just heard
      const quiet = A.melCover.map((c, k) => c < 0.3 || A.dens[k] < 0.3);
      let slots = []; for (let k = 1; k < A.bars; k++) if (quiet[k] && A.segs[Math.floor(k * A.barT / A.segT)]) slots.push(k);
      if (slots.length < Math.max(2, A.bars / 12)) { slots = []; for (let k = 3; k < A.bars; k += 4) slots.push(k); if (A.bars < 4) slots.push(A.bars - 1); }
      groups = Array.from({ length: A.bars }, () => ({ men: false, women: false }));
      let turn = R() < 0.5 ? 'women' : 'men';
      for (const k of slots) {
        const who = both ? turn : men ? 'men' : 'women'; turn = turn === 'men' ? 'women' : 'men';
        const rg = who === 'men' ? rgMen : rgWom; groups[k][who] = true;
        let src = k - 1; while (src > 0 && A.melCover[src] < 0.3) src--;
        const echo = A.mel.filter((n) => n.t >= src * A.barT && n.t < (src + 1) * A.barT);
        const off = (k - src) * A.barT, topR = rg[0]; let near = (topR[1] + topR[2]) >> 1, tops = [];
        for (const n of echo) { const t = n.t + off; const ch = segAt(t); if (!ch) continue; const p = snapTo(intoRange(n.p, topR[1], topR[2], near), ch.pcs); const q = clamp(p, topR[1], topR[2]); near = q; tops.push(q);
          add(t, Math.min(n.d, (k + 1) * A.barT - t - 40), q, (A.dyn[src] || 0.5) * 0.9, topR[0], true); }
        const blk = blocks(k, k + 1); let prev = null; const low = tops.length ? Math.min(...tops) : null;
        for (const b of blk) { const rr = [[rg[1][0], rg[1][1], low != null ? Math.max(rg[1][1], Math.min(rg[1][2], low - 3)) : rg[1][2]]]; const v = voice(b.ch, rr, prev); prev = v;
          if (!tops.length) { const vt = voice(b.ch, rg, null); vt.forEach((p, j) => add(b.t, b.d - 40, p, (A.dyn[src] || 0.5) * 0.8, rg[j][0])); } else add(b.t, b.d - 40, v[0], (A.dyn[src] || 0.5) * 0.75, rr[0][0]); }
      }
    }
    return finish(out, M, A, mode, groups, Z, men, women, o);
  }

  function finish(notes, M, A, mode, groups, Z, men, women, o) {
    for (const n of notes) n.vel = clamp(Math.round(22 + 100 * n.v + (n.lead ? 6 : 0)), 14, 124);
    notes.sort((a, b) => a.p - b.p || a.t - b.t);
    const merged = []; for (const n of notes) { const m = merged.length && merged[merged.length - 1]; if (m && m.p === n.p && n.t < m.t + m.d) { m.d = Math.max(m.d, n.t + n.d - m.t); m.vel = Math.max(m.vel, n.vel); continue; } merged.push(Object.assign({}, n)); }
    merged.sort((a, b) => a.t - b.t || a.p - b.p);
    const H = rng((o.seed || 7) * 13 + 5), hi = (a, b) => a + Math.floor(H() * (b - a + 1)), lean = {};
    for (const n of merged) { if (n.t > 0) { if (lean[n.voice] == null) lean[n.voice] = hi(-10, 10) + (n.voice === 'B' ? 5 : 0); const e = n.t + n.d; n.t = Math.max(0, n.t + lean[n.voice] + hi(-8, 8) - (n.lead ? 6 : 0)); n.d = Math.max(40, e + hi(-20, 10) - n.t); } n.vel = clamp(n.vel + hi(-6, 6), 10, 126); }
    merged.sort((a, b) => a.t - b.t || a.p - b.p);
    const byP = {}; for (const n of merged) { const q = byP[n.p]; if (q && q.t + q.d > n.t - 20) q.d = Math.max(30, n.t - 20 - q.t); byP[n.p] = n; }
    let poly = 0, cur = 0; const ev = []; for (const n of merged) ev.push([n.t, 1], [n.t + n.d, -1]); ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); for (const [, d] of ev) { cur += d; poly = Math.max(poly, cur); }
    // sections of four bars: who sings and on which vowel
    const secBars = A.bars > 48 ? 8 : 4, strip = [], markers = [];
    for (let s = 0; s < A.bars; s += secBars) {
      const e = Math.min(A.bars, s + secBars), inS = merged.filter((n) => n.t >= s * A.barT && n.t < e * A.barT);
      const dy = Math.max(0, ...A.dyn.slice(s, e)), short = inS.filter((n) => n.lead).some((n) => n.d < PPQ / 2);
      const mIn = inS.some((n) => n.p <= Z.menHi || (n.voice === 'T' || n.voice === 'B')), wIn = inS.some((n) => n.p >= Z.womenLo || n.voice === 'S' || n.voice === 'A');
      const pickV = (high) => (o.vowel === 'oo' ? 'OO' : o.vowel === 'ah' ? 'AH' : (dy >= 0.68 || high) && !short ? 'AH' : 'OO');
      const wHigh = inS.filter((n) => n.p >= Z.womenLo).some((n) => n.p >= Z.womenLo + 9);
      const sec = { label: 'Bar ' + (s + 1), start: s * A.barT / PPQ, beats: (e - s) * A.barT / PPQ, men: men && mIn ? pickV(false) : '', women: women && wIn ? pickV(wHigh) : '' };
      strip.push(sec); const parts = [sec.men && 'Men ' + sec.men, sec.women && 'Women ' + sec.women].filter(Boolean);
      markers.push({ t: s * A.barT, text: sec.label + (parts.length ? ' · ' + parts.join(' · ') : ' · rest') });
    }
    const cc = []; for (let t = 0; t < A.bars * A.barT; t += PPQ / 2) { const k = Math.floor(t / A.barT), a = A.dyn[k] || 0, b = A.dyn[k + 1] == null ? a : A.dyn[k + 1], f = (t % A.barT) / A.barT; cc.push({ t, v: clamp(Math.round(30 + 90 * (a + (b - a) * f)), 20, 124) }); }
    let secs = 0, lt = 0, us = M.tempos[0].us; for (const tp of M.tempos) { if (tp.t > A.endT) break; secs += (tp.t - lt) / PPQ * us / 1e6; lt = tp.t; us = tp.us; } secs += (A.endT - lt) / PPQ * us / 1e6;
    const bpm = 60000000 / M.tempos[0].us, key = NOTE[A.tonic] + ' ' + (A.minor ? 'minor' : 'major');
    return { notes: merged.map((n) => ({ t: n.t, d: n.d, p: n.p, v: n.vel, voice: n.voice })), cc, markers, beats: A.bars * A.barT / PPQ, meter: M.sig.num, meterDen: M.sig.den, tempos: M.tempos, key, bpm, seconds: Math.round(secs), strip,
      playMode: poly <= 1 ? 'legato' : 'keys', maxPoly: poly, zones: Z, desc: MODES[mode] + ' with your orchestra · ' + key + ' · ' + A.bars + ' bars', fileTag: MODES[mode].replace(/\s+/g, ''), mode, bars: A.bars, chords: A.segs };
  }

  C.follow = follow; C.FOLLOW_MODES = MODES; C.parseMidi = parse;
})(typeof window !== 'undefined' ? window : globalThis);
