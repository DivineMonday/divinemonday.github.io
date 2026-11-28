/* Divine Choir Machine engine.
   Composes for a two-group sample choir on one keyboard (like Soundiron Olympus Micro):
   the low keys are the men, the high keys the women, the keys in between sing with both.
   Rules come from choir practice and music theory: ranges, breathing, stepwise lines,
   no parallel fifths or octaves where the style forbids them, suspensions that resolve down,
   vowels that follow height and strength. One MIDI file, notes plus a swell curve (CC1) and markers. */
(function (root) {
  'use strict';
  const PPQ = 480;
  const rng = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const mk = (r) => ({ f: r, pick: (a) => a[Math.floor(r() * a.length)], chance: (p) => r() < p, int: (a, b) => a + Math.floor(r() * (b - a + 1)),
    w: (o) => { const ks = Object.keys(o).filter((k) => o[k] > 0), tot = ks.reduce((s, k) => s + o[k], 0); let x = r() * tot; for (const k of ks) { x -= o[k]; if (x <= 0) return k; } return ks[ks.length - 1]; } });
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  const MODES = { ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10] };
  const MODE_NAMES = { ionian: 'major', dorian: 'Dorian', phrygian: 'Phrygian', lydian: 'Lydian', mixolydian: 'Mixolydian', aeolian: 'minor' };
  const NOTE = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  // Studio One and Kontakt name middle C (60) C3
  const noteName = (p) => NOTE[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 2);

  const STYLES = {
    gregorian: { name: 'Gregorian', nuances: { unison: 'Unison', drone: 'With a drone', antiphon: 'Antiphon: men and women take turns' }, spirits: ['chant', 'hildegard'] },
    polyphony: { name: 'Renaissance', nuances: { woven: 'Woven voices', canon: 'Canon', pure: 'Pure and still' }, spirits: ['palestrina', 'monteverdi'] },
    baroque: { name: 'Baroque', nuances: { chorale: 'Chorale', festive: 'Festive', fugue: 'Fugue' }, spirits: ['bach', 'handel', 'mozart'] },
    film: { name: 'Film', nuances: { epic: 'Epic', haunting: 'Haunting', minimal: 'Minimal', trailer: 'Trailer' }, spirits: ['faure', 'part', 'whitacre', 'orff'] },
    gospel: { name: 'Gospel', nuances: { spiritual: 'Spiritual', ballad: 'Ballad', shout: 'Shout' }, spirits: ['gospel'] }
  };
  const SPIRITS = {
    chant: { name: 'The monks', engine: 'chant', modes: ['dorian', 'phrygian', 'mixolydian', 'aeolian'], bpm: [66, 80], harm: 'modal' },
    hildegard: { name: 'Hildegard von Bingen', engine: 'chant', wide: true, modes: ['dorian', 'mixolydian', 'aeolian'], bpm: [60, 72], harm: 'modal' },
    palestrina: { name: 'Palestrina', engine: 'poly', modes: ['ionian', 'dorian', 'aeolian', 'mixolydian'], bpm: [60, 72], rate: 2, harm: 'modal', rules: true },
    monteverdi: { name: 'Monteverdi', engine: 'contrast', modes: ['dorian', 'ionian', 'aeolian'], bpm: [66, 84], rate: 2, harm: 'modal', rules: true },
    bach: { name: 'Bach', engine: 'chorale', modes: ['ionian', 'aeolian'], bpm: [60, 76], rate: 1, harm: 'func', rules: true },
    handel: { name: 'Handel', engine: 'block', modes: ['ionian', 'aeolian'], bpm: [84, 104], rate: 2, harm: 'func', rules: true },
    mozart: { name: 'Mozart', engine: 'melody', modes: ['ionian', 'aeolian'], bpm: [76, 96], rate: 4, harm: 'func', rules: true },
    faure: { name: 'Fauré', engine: 'melody', modes: ['ionian', 'aeolian', 'lydian'], bpm: [56, 70], rate: 4, harm: 'faure', soft: true },
    part: { name: 'Arvo Pärt', engine: 'tint', modes: ['aeolian', 'ionian', 'dorian'], bpm: [52, 66] },
    whitacre: { name: 'Eric Whitacre', engine: 'cluster', modes: ['ionian', 'lydian', 'aeolian'], bpm: [46, 60], rate: 8, harm: 'cluster' },
    orff: { name: 'Carl Orff', engine: 'ostinato', modes: ['aeolian', 'phrygian'], bpm: [110, 138], harm: 'ostinato' },
    gospel: { name: 'Gospel choir', engine: 'gospel', modes: ['ionian', 'mixolydian', 'ionian', 'aeolian'], bpm: [74, 100], rate: 2, harm: 'gospel' }
  };
  // a nuance that is a technique decides the engine; the others only colour it
  const NUANCE_ENGINE = { unison: 'chant', drone: 'chant', antiphon: 'chant', canon: 'canon', fugue: 'fugue', chorale: 'chorale', festive: 'block', minimal: 'tint' };
  const FORMS = {
    hymn: { name: 'Hymn', secs: [['Verse 1', 'A', 2, 0.55], ['Verse 2', 'A', 2, 0.65], ['Verse 3', 'A', 2, 0.8], ['Amen', 'coda', 1, 0.5]] },
    motet: { name: 'Motet', secs: [['Opening', 'A', 2, 0.5], ['Middle', 'B', 2, 0.65], ['Return', 'A', 2, 0.72], ['Close', 'coda', 1, 0.6]] },
    chorale: { name: 'Chorale', secs: [['Phrases 1 and 2', 'A', 2, 0.6], ['Phrases 3 and 4', 'A', 2, 0.65], ['Phrases 5 and 6', 'B', 2, 0.72], ['Last phrase', 'coda', 1, 0.6]] },
    kyrie: { name: 'Kyrie', secs: [['Kyrie', 'A', 2, 0.6], ['Christe', 'B', 2, 0.5], ['Kyrie', 'A', 2, 0.78], ['Eleison', 'coda', 1, 0.5]] },
    agnus: { name: 'Agnus Dei', secs: [['Agnus Dei I', 'A', 2, 0.45], ['Agnus Dei II', 'A', 2, 0.6], ['Dona nobis pacem', 'B', 2, 0.78], ['Pacem', 'coda', 1, 0.4]] },
    requiem: { name: 'Requiem', secs: [['Introit', 'A', 2, 0.35], ['Rising', 'B', 2, 0.6], ['Lacrimosa', 'climax', 2, 0.92], ['Rest', 'coda', 2, 0.3]] },
    aria: { name: 'Aria with choir', secs: [['Choir', 'A', 1, 0.45], ['Aria', 'solo', 2, 0.55], ['Chorus', 'B', 2, 0.8], ['Aria', 'solo', 2, 0.6], ['Chorus', 'B', 2, 0.86], ['Coda', 'coda', 1, 0.5]] },
    anthem: { name: 'Anthem', secs: [['Verse', 'A', 2, 0.6], ['Verse', 'A', 2, 0.7], ['Build', 'B', 2, 0.8], ['Anthem', 'climax', 2, 1], ['Final', 'coda', 1, 0.85]] },
    lullaby: { name: 'Lullaby', meter: 3, secs: [['Hush', 'A', 2, 0.35], ['Hush', 'A', 2, 0.4], ['Middle', 'B', 1, 0.45], ['Sleep', 'coda', 2, 0.25]] }
  };
  const ROLES = {
    pray: { name: 'Pray', modes: ['dorian', 'ionian', 'mixolydian'], tempo: 1, dyn: 0.85 },
    mourn: { name: 'Mourn', modes: ['aeolian', 'phrygian', 'dorian'], tempo: 0.86, dyn: 0.75 },
    celebrate: { name: 'Celebrate', modes: ['ionian', 'mixolydian', 'lydian'], tempo: 1.12, dyn: 1.1 },
    threaten: { name: 'Threaten', modes: ['phrygian', 'aeolian'], tempo: 1, dyn: 1.1 },
    comfort: { name: 'Comfort', modes: ['ionian', 'lydian', 'aeolian'], tempo: 0.9, dyn: 0.75 }
  };
  const TEXTURES = { together: 'Together', callresponse: 'Call and response', echo: 'Echo', menlead: 'Men lead', womenlead: 'Women lead', middle: 'The middle leads' };
  const SOLOS = { none: 'No solo', women: 'Women solo, men hum OO underneath', men: 'Men solo, women hum OO above' };
  // the keyboard of the plugin: men below, both in the middle, women above (Olympus Micro: C1 to D#2, E2 to G#3, A3 to C5)
  const ZONES = { menLo: 36, menHi: 51, womenLo: 69, womenHi: 84 };

  // names from the five word wheels of the Divine Monday name oracle (the same wheels as the Studios and the lyric oracle)
  const NW = {"W1":["Silent","Velvet","Cosmic","Hollow","Distant","Quiet","Secret","Hidden","Gentle","Tender","Dusty","Misty","Foggy","Hazy","Smoky","Dreamy","Sleepy","Lonely","Ancient","Faded","Fragile","Frozen","Silky","Satin","Woolen","Feathered","Mossy","Sandy","Salty","Sunken","Drowned","Buried","Forgotten","Haunted","Sacred","Holy","Divine","Pagan","Mystic","Mythic","Lunar","Solar","Stellar","Astral","Celestial","Orbital","Nocturnal","Twilight","Moonlit","Starlit","Candlelit","Lamplit","Shadowed","Veiled","Masked","Muted","Whispered","Soft","Warm","Cold","Cool","Icy","Frosty","Humid","Tropical","Arctic","Polar","Desert","Coastal","Oceanic","Tidal","Rainy","Stormy","Windy","Cloudy","Sunny","Shady","Dim","Pale","Hazed","Ghostly","Spectral","Phantom","Elusive","Endless","Infinite","Eternal","Timeless","Ageless","Vintage","Antique","Rustic","Wooden","Paper","Canvas","Leather","Linen","Cotton","Porcelain","Marble","Granite","Stone","Concrete","Rusted","Tarnished","Weathered","Worn","Broken","Cracked","Shattered","Scattered","Tangled","Woven","Knotted","Folded","Crumpled","Polished","Lacquered","Gilded","Plated","Enameled","Frosted","Clouded","Blurred","Grainy","Noisy","Static","Analog","Vinyl","Tape","Hollowed","Echoing","Resonant","Sonic","Tonal","Modal","Harmonic","Melodic","Lyrical","Poetic","Romantic","Wistful","Nostalgic","Melancholy","Somber","Solemn","Serene","Tranquil","Placid","Calm","Still","Peaceful","Mellow","Lazy","Idle","Hypnotic","Floating","Weightless","Airy","Ethereal","Bodiless","Formless","Shapeless","Nameless","Faceless","Wordless","Soundless","Restless","Sleepless","Homeless","Careless","Fearless","Reckless","Lawless","Boundless","Bottomless","Starless","Sunless","Moonless","Tideless","Windless","Painless","Gracious","Graceful","Elegant","Noble","Royal","Regal","Imperial","Majestic","Grand","Humble","Modest","Simple","Pure","Clean","Clear","Bright","Luminous","Radiant","Glowing","Shining","Gleaming","Glimmering","Shimmering","Sparkling","Twinkling","Flickering","Fading","Waning","Waxing","Rising","Setting","Falling","Drifting","Wandering","Lost","Found","Chosen","Blessed","Cursed","Wicked","Gothic","Baroque","Rococo","Victorian","Futurist","Retro","Modern","Atomic","Quantum","Digital","Virtual","Synthetic","Plastic","Chrome","Mirrored","Liquid","Molten","Smoldering","Ashen","Charred","Gossamer","Lucid","Sunlit","Ornate","Velveteen","Opaline","Wintry","Dreamlike"],"W2":["Kinetic","Fluid","Linear","Rapid","Swift","Quick","Fast","Slow","Steady","Stable","Shaky","Wobbly","Jittery","Nervous","Frantic","Manic","Hyper","Electric","Magnetic","Dynamic","Pulsing","Throbbing","Thumping","Pounding","Rolling","Spinning","Turning","Twisting","Swirling","Whirling","Looping","Cycling","Rotating","Orbiting","Bouncing","Jumping","Leaping","Skipping","Hopping","Dancing","Swinging","Swaying","Rocking","Shaking","Rattling","Stomping","Marching","Running","Racing","Rushing","Chasing","Hunting","Climbing","Soaring","Flying","Gliding","Sliding","Slipping","Rippling","Flowing","Streaming","Pouring","Flooding","Surging","Crashing","Breaking","Bursting","Exploding","Erupting","Igniting","Burning","Blazing","Flaming","Firing","Charging","Driving","Pushing","Pulling","Lifting","Dropping","Sinking","Diving","Plunging","Tumbling","Spiraling","Ascending","Descending","Accelerating","Bending","Stretching","Expanding","Shrinking","Unfolding","Opening","Closing","Breathing","Beating","Ticking","Clicking","Snapping","Popping","Cracking","Buzzing","Humming","Droning","Ringing","Chiming","Clanging","Booming","Roaring","Howling","Screaming","Shouting","Calling","Singing","Chanting","Grooving","Funky","Jazzy","Bluesy","Soulful","Punchy","Snappy","Crisp","Tight","Loose","Sloppy","Lean","Heavy","Light","Dense","Sparse","Thick","Thin","Wide","Narrow","Deep","Shallow","High","Low","Loud","Raw","Rough","Smooth","Sharp","Blunt","Hard","Tough","Solid","Brittle","Elastic","Rubber","Bouncy","Agile","Nimble","Lithe","Fleet","Brisk","Lively","Vivid","Vibrant","Wild","Feral","Savage","Fierce","Bold","Brave","Daring","Furious","Angry","Hungry","Thirsty","Greedy","Eager","Hasty","Urgent","Pressing","Relentless","Tireless","Unstoppable","Overdriven","Distorted","Saturated","Compressed","Amplified","Boosted","Pumped","Juiced","Wired","Charged","Loaded","Primed","Locked","Synced","Phased","Shifted","Displaced","Detuned","Pitched","Bent","Warped","Skewed","Tilted","Angled","Crooked","Zigzag","Jagged","Staggered","Stuttered","Stammered","Glitched","Fractured","Splintered","Shredded","Chopped","Sliced","Diced","Cut","Spliced","Mixed","Blended","Fused","Merged","Bonded","Linked","Chained","Coupled","Paired","Doubled","Tripled","Layered","Stacked","Piled","Packed","Crowded","Swarming","Teeming","Bustling","Hustling","Busy","Awake","Alert","Alive","Living","Pulsating","Radiating","Vibrating","Oscillating","Resonating","Modulating","Alternating","Repeating","Recurring","Returning","Reversing","Inverted","Flipped","Rotated","Translated","Scaled","Stretched","Quantized","Shuffled","Syncopated","Offbeat","Upbeat","Downbeat","Backbeat","Polyrhythmic","Strutting","Swaggering","Prowling","Stalking","Creeping","Crawling","Lurking","Sneaking","Rambling","Roaming","Roving","Travelling","Journeying","Voyaging","Sailing","Cruising","Coasting","Freewheeling","Barreling","Hurtling","Careening","Rocketing","Launching","Blasting","Thundering","Rumbling","Grinding","Churning","Pumping","Hammering","Drilling"],"W3":["Crimson","Scarlet","Ruby","Cherry","Rose","Coral","Salmon","Peach","Apricot","Amber","Honey","Golden","Gold","Saffron","Mustard","Lemon","Lime","Olive","Moss","Jade","Emerald","Mint","Sage","Forest","Pine","Teal","Cyan","Aqua","Turquoise","Azure","Cobalt","Sapphire","Navy","Indigo","Ultramarine","Violet","Purple","Lilac","Lavender","Mauve","Plum","Orchid","Magenta","Fuchsia","Pink","Blush","Ivory","Cream","Pearl","Silver","Platinum","Steel","Iron","Copper","Bronze","Brass","Rust","Ochre","Umber","Sienna","Sepia","Tan","Beige","Khaki","Taupe","Ash","Smoke","Charcoal","Graphite","Onyx","Obsidian","Ebony","Jet","Ink","Black","White","Grey","Gray","Snow","Chalk","Bone","Milk","Neon","Ultraviolet","Infrared","Fluorescent","Pastel","Matte","Glossy","Metallic","Iridescent","Opal","Prism","Spectrum","Rainbow","Holographic","Sunset","Sunrise","Dusk","Dawn","Midnight","Noon","Evening","Morning","Autumn","Winter","Summer","Spring","Harvest","Ember","Flame","Fire","Ice","Frost","Storm","Thunder","Lightning","Rain","Cloud","Mist","Fog","Haze","Shadow","Dark","Hot","Burnt","Smoked","Toasted","Roasted","Baked","Sunburnt","Rosewood","Mahogany","Walnut","Cedar","Oak","Birch","Bamboo","Coffee","Cocoa","Chocolate","Caramel","Vanilla","Cinnamon","Ginger","Pepper","Paprika","Tangerine","Orange","Citrus","Grape","Berry","Wine","Burgundy","Claret","Maroon","Garnet","Topaz","Citrine","Quartz","Diamond","Crystal","Glass","Amethyst","Tourmaline","Malachite","Lapis","Celadon","Vermilion","Carmine","Cadmium","Cinnabar","Woad","Henna","Kohl","Tar","Oil","Petrol","Velour","Suede","Denim","Tweed","Silk","Lace","Gauze","Acid","Toxic","Radioactive","Nuclear","Plasma","Laser","Tropic","Jungle","Savanna","Tundra","Ocean","Sea","River","Lake","Harbor","Island","Coastline","Canyon","Valley","Mountain","Alpine","Glacier","Volcanic","Lava","Magma","Sulfur","Mercury","Nickel","Zinc","Tin","Lead","Titanium","Uranium","Moonstone","Sunstone","Bloodstone","Firestone","Starstone","Skyline","Highland","Lowland","Northern","Southern","Eastern","Western","Inner","Outer","Upper","Lower","First","Last","Second","Third","Final","Early","Late","Lucky","Dear","Sweet","Bitter","Sour","Spicy","Free","Lone","Twin","Double","Single","Half","Full","Empty","Open","Closed"],"W4":["Echo","Grid","Mirror","Window","Door","Gate","Bridge","Tower","Wall","Arch","Dome","Pillar","Column","Stair","Ladder","Corridor","Hallway","Tunnel","Cave","Chamber","Vault","Cellar","Attic","Balcony","Terrace","Garden","Courtyard","Plaza","Square","Circle","Spiral","Helix","Cube","Sphere","Cone","Pyramid","Lens","Frame","Panel","Tile","Brick","Block","Beam","Wire","Cable","Chain","Rope","Thread","Ribbon","Strip","Band","Ring","Loop","Knot","Web","Net","Mesh","Lattice","Matrix","Array","Pattern","Mosaic","Collage","Fresco","Portrait","Sketch","Outline","Silhouette","Contour","Profile","Shape","Figure","Form","Body","Shell","Husk","Seed","Root","Branch","Leaf","Petal","Stem","Thorn","Vine","Tree","Field","Meadow","Hill","Peak","Ridge","Cliff","Shore","Beach","Dune","Reef","Wave","Tide","Current","Stream","Creek","Brook","Pond","Lagoon","Bay","Gulf","Strait","Channel","Canal","Harbour","Pier","Dock","Lighthouse","Beacon","Lantern","Candle","Torch","Flare","Spark","Star","Comet","Meteor","Planet","Moon","Sun","Galaxy","Nebula","Orbit","Satellite","Rocket","Station","Engine","Motor","Turbine","Piston","Gear","Wheel","Lever","Pulley","Hinge","Valve","Pipe","Tube","Hose","Pump","Tank","Barrel","Drum","Bell","Gong","Cymbal","Horn","Flute","Harp","Lyre","Organ","Piano","Violin","Cello","Guitar","Banjo","Bass","Synth","Sampler","Sequencer","Oscillator","Filter","Mixer","Speaker","Amplifier","Radio","Antenna","Receiver","Transmitter","Dial","Switch","Button","Knob","Fader","Slider","Meter","Gauge","Clock","Watch","Compass","Map","Atlas","Globe","Chart","Diagram","Blueprint","Model","Sculpture","Statue","Monument","Temple","Shrine","Altar","Chapel","Cathedral","Palace","Castle","Fortress","Citadel","Market","Bazaar","Arcade","Gallery","Museum","Library","Archive","Theater","Cinema","Studio","Stage","Arena","Stadium","Circus","Carnival","Parade","Motel","Hotel","Diner","Cafe","Bar","Club","Lounge","Ballroom","Disco","Garage","Warehouse","Factory","Foundry","Workshop","Mill","Farm","Ranch","Prairie","Oasis","Mirage","Horizon","Highway","Avenue","Boulevard","Street","Alley","Lane","Road","Path","Trail","Track","Rail","Railway","Platform","Terminal","Airport","Runway","Hangar","Cockpit","Cabin","Capsule","Pod","Module","Unit","Cell","Atom","Molecule","Fossil","Relic","Totem","Mask","Crown","Throne","Sword","Shield","Arrow","Anchor","Sail","Mast","Hull","Raft","Canoe","Ship","Boat","Ferry","Submarine","Train","Tram","Bus","Taxi","Bicycle","Skateboard","Kite","Balloon","Feather","Wing","Claw","Fang","Tail","Eye","Hand","Heart","Vein"],"W5":["Drift","Phase","Flux","Pulse","Signal","Frequency","Wavelength","Amplitude","Resonance","Harmony","Melody","Rhythm","Tempo","Groove","Swing","Shuffle","Cadence","Chord","Scale","Mode","Key","Tone","Timbre","Noise","Silence","Feedback","Delay","Reverb","Chorus","Flanger","Tremolo","Vibrato","Sustain","Decay","Release","Attack","Envelope","Gain","Drive","Fuzz","Overtone","Undertone","Fundamental","Interval","Octave","Unison","Dissonance","Tension","Balance","Symmetry","Gravity","Momentum","Inertia","Velocity","Motion","Friction","Pressure","Density","Entropy","Energy","Power","Force","Charge","Voltage","Circuit","Logic","Code","Algorithm","Protocol","Sequence","Series","Cycle","Iteration","Recursion","Fractal","Chaos","Order","System","Network","Structure","Process","Function","Variable","Constant","Equation","Formula","Theorem","Paradox","Theory","Hypothesis","Dimension","Plane","Vector","Axis","Angle","Curve","Arc","Line","Point","Vertex","Node","Edge","Border","Boundary","Limit","Threshold","Margin","Distance","Depth","Height","Width","Length","Volume","Mass","Weight","Measure","Ratio","Proportion","Fraction","Digit","Number","Zero","Infinity","Origin","Genesis","Exodus","Omen","Oracle","Prophecy","Destiny","Fate","Fortune","Chance","Luck","Hazard","Risk","Promise","Oath","Vow","Pact","Treaty","Accord","Truce","Rebellion","Revolution","Evolution","Mutation","Transition","Transformation","Metamorphosis","Rebirth","Renaissance","Revival","Awakening","Dream","Vision","Illusion","Memory","Reverie","Nostalgia","Longing","Desire","Passion","Devotion","Rapture","Bliss","Euphoria","Trance","Hypnosis","Meditation","Prayer","Ritual","Ceremony","Mystery","Riddle","Enigma","Cipher","Glyph","Rune","Symbol","Sign","Token","Whisper","Rumor","Story","Legend","Myth","Fable","Saga","Chronicle","Anthem","Hymn","Ballad","Lullaby","Serenade","Requiem","Elegy","Ode","Sonnet","Verse","Refrain","Motif","Theme","Variation","Fugue","Canon","Prelude","Interlude","Overture","Finale","Encore","Coda","Epilogue","Prologue","Chapter","Episode","Moment","Instant","Season","Era","Epoch","Age","Century","Decade","Hour","Minute","Daybreak","Nightfall","Eclipse","Solstice","Equinox","Zenith","Apex","Summit","Abyss","Void","Vacuum","Ether","Aura","Halo","Spirit","Soul","Ghost","Shade","Specter","Presence","Absence","Departure","Arrival","Return","Escape","Exile","Journey","Voyage","Odyssey","Quest","Mission","Expedition","Pilgrimage","Passage","Crossing","Migration","Flight","Fall","Rise","Ascent","Descent","Collapse","Surrender","Victory","Glory","Honor","Grace","Mercy","Freedom","Liberty","Justice","Wisdom","Truth","Faith","Hope","Love","Joy","Fear","Rage","Grief","Sorrow","Comfort","Shelter","Refuge","Haven","Sanctuary","Paradise","Utopia","Nowhere","Elsewhere","Somewhere","Anywhere"],"PREP":["Through","Under","Beyond","Into","On","Across","Inside","Above","Below","Behind","Over","Beneath","Within","After","Before","Past","Toward","Around","Along","Against","Among","Beside","Upon","Amid"]};
  const makeName = (seed) => { const R = mk(rng(seed ^ 0x5bd1e995)), A = NW.W1.concat(NW.W2), M = NW.W3, N = NW.W4.concat(NW.W5), q = R.f();
    let n = q < 0.4 ? R.pick(A) + ' ' + R.pick(N) : q < 0.55 ? R.pick(M) + ' ' + R.pick(N) : R.pick(A) + ' ' + R.pick(M) + ' ' + R.pick(N);
    const t = R.f(); if (t < 0.16) n = R.pick(NW.PREP) + ' the ' + n; else if (t < 0.3) n = (R.f() < 0.5 ? 'The' : /^[AEIOU]/.test(n) ? 'An' : 'A') + ' ' + n; return n; };

  // ---------- harmony ----------
  function Key(tonic, mode) {
    const sc = MODES[mode], pcs = sc.map((x) => (tonic + x) % 12);
    const deg = (d) => ((d % 7) + 7) % 7;
    const quality = (d) => { const a = sc[deg(d)], b = sc[deg(d + 2)] + (deg(d + 2) < deg(d) ? 12 : 0), c = sc[deg(d + 4)] + (deg(d + 4) < deg(d) ? 12 : 0); const t = (b - a + 12) % 12, f = (c - a + 12) % 12; return t === 3 && f === 6 ? 'dim' : t === 4 && f === 8 ? 'aug' : t === 4 ? 'maj' : 'min'; };
    const chord = (c) => { // pitch classes of a chord {d, ext, raise}
      let out = [0, 2, 4].map((k) => pcs[deg(c.d + k)]);
      if (c.raise) out[1] = (out[1] + 1) % 12; // the raised leading note in a minor dominant
      if (c.ext === 'add2') out.push(pcs[deg(c.d + 1)]);
      if (c.ext === '7') out.push(pcs[deg(c.d + 6)]);
      if (c.ext === 'sus') out = [out[0], pcs[deg(c.d + 3)], out[2]];
      return out;
    };
    const inScale = (p) => pcs.includes(((p % 12) + 12) % 12);
    const step = (p, dir) => { let q = p + dir; while (!inScale(q)) q += dir; return q; };
    const snap = (p) => { if (inScale(p)) return p; return inScale(p - 1) ? p - 1 : p + 1; };
    return { tonic, mode, sc, pcs, deg, quality, chord, inScale, step, snap };
  }
  const minorish = (mode) => ['aeolian', 'dorian', 'phrygian'].includes(mode);

  function phraseChords(R, K, harm, nBeats, rate, kind, cadence, first) {
    // a chord every `rate` beats; the last chord carries the cadence
    const n = Math.max(2, Math.round(nBeats / rate)), out = [];
    const ok = (d) => K.quality(d) !== 'dim' && K.quality(d) !== 'aug';
    if (harm === 'gospel') { // church progressions with sevenths and added notes; the Amen at the end
      const loops = [[0, 3, 0, 4], [0, 5, 1, 4], [0, 3, 5, 4], [3, 0, 1, 4], [0, 2, 3, 4]], loop = R.pick(loops);
      for (let i = 0; i < n; i++) { let d = loop[i % loop.length]; if (i === n - 1) d = cadence === 'half' ? 4 : 0; else if (i === n - 2 && cadence === 'plagal') d = 3; else if (i === n - 2 && cadence !== 'half') d = 4;
        const c = { d: ok(d) ? d : 0 }; c.ext = d === 4 ? '7' : d === 1 || d === 5 ? '7' : R.chance(0.6) ? 'add2' : null; if (minorish(K.mode) && d === 4) c.raise = true; out.push(c); }
    } else if (harm === 'ostinato') { const loop = minorish(K.mode) ? [0, 5, 6, 0] : [0, 3, 4, 0]; for (let i = 0; i < n; i++) out.push({ d: loop[i % 4] }); }
    else if (harm === 'cluster') { const pool = [0, 3, 5, 4, 1].filter(ok); for (let i = 0; i < n; i++) out.push({ d: i === 0 && first ? 0 : i === n - 1 ? 0 : R.pick(pool), ext: R.chance(0.7) ? 'add2' : 'sus' }); }
    else if (harm === 'func' || harm === 'faure') {
      const minor = minorish(K.mode), T = [0, 5, 2].filter(ok), S = [3, 1].filter(ok), D = [4];
      let fn = 'T', d = kind === 'B' ? R.pick([5, 3]) : 0;
      for (let i = 0; i < n; i++) {
        const last = i === n - 1, pen = i === n - 2;
        if (last) d = cadence === 'half' ? 4 : 0;
        else if (pen) d = cadence === 'half' ? R.pick(S.concat([0])) : cadence === 'plagal' ? 3 : 4;
        else if (i > 0) { fn = fn === 'T' ? R.pick(['T', 'S', 'S', 'D']) : fn === 'S' ? R.pick(['D', 'D', 'T']) : 'T'; d = R.pick(fn === 'T' ? T : fn === 'S' ? S : D); if (out.length && out[out.length - 1].d === d) d = R.pick(fn === 'T' ? T : S); }
        const c = { d };
        if (minor && d === 4) c.raise = true;
        if (harm === 'faure' && !last && R.chance(0.35)) c.ext = R.pick(['add2', '7']);
        if (harm === 'func' && pen && d === 4 && R.chance(0.4)) c.ext = '7';
        out.push(c);
      }
    } else { // modal: roots move by fourth, fifth or third; cadences of the church modes
      const cad = { aeolian: [6, 0], dorian: [6, 0], phrygian: [1, 0], mixolydian: [6, 0], ionian: [4, 0], lydian: [1, 0] }[K.mode] || [4, 0];
      let d = kind === 'B' ? R.pick([3, 5, 2].filter(ok)) : 0;
      for (let i = 0; i < n; i++) {
        if (i === n - 1) d = cadence === 'half' ? cad[0] : 0;
        else if (i === n - 2 && cadence !== 'half') d = cad[0];
        else if (i > 0) { let tries = 0; do { d = K.deg(d + R.pick([3, 4, -2, 2, 5, 1])); tries++; } while ((!ok(d) || (out.length && out[out.length - 1].d === d)) && tries < 20); }
        out.push({ d: ok(d) ? d : 0 });
      }
    }
    const base = nBeats / n; return out.map((c, i) => Object.assign(c, { beats: i === n - 1 ? nBeats - base * (n - 1) : base }));
  }

  // ---------- voicing: every voice in its range, smooth lines, no forbidden parallels ----------
  function rangesFor(Z, who) {
    if (who === 'men') return { T: [Z.menLo + 5, Z.menHi], B: [Z.menLo, Z.menHi - 5] };
    if (who === 'women') return { S: [Z.womenLo + 3, Z.womenHi], A: [Z.womenLo, Z.womenHi - 5] };
    return { B: [Z.menLo, Z.menHi + 4], T: [Z.menLo + 8, Z.womenLo - 4], A: [Z.menHi + 3, Z.womenLo + 5], S: [Z.womenLo - 3, Z.womenHi] };
  }
  function voiceChords(chords, K, ranges, rules, prev, target) {
    const order = ['B', 'T', 'A', 'S'].filter((v) => ranges[v]);
    const res = [];
    for (let ci = 0; ci < chords.length; ci++) {
      const pcs = K.chord(chords[ci]), root = pcs[0];
      const cand = {};
      for (const v of order) { cand[v] = []; for (let p = ranges[v][0]; p <= ranges[v][1]; p++) if (pcs.includes(p % 12)) cand[v].push(p); }
      let best = null, bestS = 1e9;
      const pick = {};
      const rec = (i) => {
        if (i === order.length) {
          const vs = order.map((v) => pick[v]);
          let s = 0; const got = new Set(vs.map((p) => p % 12));
          if (!got.has(root)) s += 60; if (!got.has(pcs[1])) s += 40; if (order.length >= 3 && pcs.length > 3 && !got.has(pcs[3])) s += 4;
          if (pick[order[0]] % 12 !== root) s += order.length >= 3 ? 14 : 6; // root in the lowest voice
          if (order.length === 4 && vs.filter((p) => p % 12 === pcs[1]).length > 1) s += 8; // do not double the third
          for (let k = 0; k < order.length; k++) {
            const v = order[k], p = pick[v];
            if (prev && prev[v] != null) { const m = Math.abs(p - prev[v]); s += m * (v === 'B' ? 0.4 : v === 'S' ? 0.7 : 1); if (m > 7) s += (m - 7) * (v === 'B' ? 1 : 5); if (m === 6) s += 12; }
            if (k > 0 && v !== 'T' && pick[order[k - 1]] && p - pick[order[k - 1]] > 12) s += 25;
          }
          if (target && target[ci] != null && pick.S != null) s += Math.abs(pick.S - target[ci]) * 0.8;
          if (target && target[ci] != null && pick.S == null && pick.T != null && !ranges.B) s += Math.abs(pick.T - (target[ci] - 24)) * 0.4;
          if (rules && prev) for (let a = 0; a < order.length; a++) for (let b = a + 1; b < order.length; b++) {
            const va = order[a], vb = order[b]; if (prev[va] == null || prev[vb] == null) continue;
            const i1 = (prev[vb] - prev[va]) % 12, i2 = (pick[vb] - pick[va]) % 12, ma = pick[va] - prev[va], mb = pick[vb] - prev[vb];
            if ((i1 === 7 || i1 === 0) && i1 === i2 && ma !== 0 && Math.sign(ma) === Math.sign(mb)) s += 80; // parallel fifths and octaves
          }
          if (s < bestS) { bestS = s; best = Object.assign({}, pick); }
          return;
        }
        const v = order[i], lo = i ? pick[order[i - 1]] : -1;
        for (const p of cand[v]) { if (p <= lo) continue; pick[v] = p; rec(i + 1); }
        delete pick[v];
      };
      rec(0);
      if (!best) { best = {}; let lo = 0; for (const v of order) { const c = cand[v].find((p) => p > lo) || ranges[v][0]; best[v] = c; lo = c; } }
      res.push(best); prev = best;
    }
    return res;
  }

  // ---------- the composition ----------
  function compose(o) {
    o = Object.assign({ style: 'baroque', nuance: '', spirit: '', form: 'hymn', role: 'pray', men: true, women: true, texture: 'together', solo: 'none', vowel: 'auto', seconds: 0, seed: 1, zones: ZONES }, o || {});
    const R = mk(rng(o.seed)), Z = Object.assign({}, ZONES, o.zones || {});
    const ST = STYLES[o.style] || STYLES.baroque; const nuance = ST.nuances[o.nuance] ? o.nuance : Object.keys(ST.nuances)[0];
    const spiritKey = ST.spirits.includes(o.spirit) ? o.spirit : ST.spirits[0], SP = SPIRITS[spiritKey];
    let engine = NUANCE_ENGINE[nuance] || SP.engine; if (o.style === 'gregorian') engine = 'chant';
    const FM = FORMS[o.form] || FORMS.hymn, RO = ROLES[o.role] || ROLES.pray;
    const who = o.men && o.women ? 'both' : o.men ? 'men' : o.women ? 'women' : 'both';
    let modes = SP.modes.filter((m) => RO.modes.includes(m)); if (!modes.length) modes = SP.modes;
    const mode = R.pick(modes), K = Key(R.pick([2, 4, 5, 7, 9, 0]), mode);
    const meter = FM.meter || 4, rules = !!SP.rules && engine !== 'chant';
    const trailer = nuance === 'trailer', haunting = nuance === 'haunting', epic = nuance === 'epic', pure = nuance === 'pure';
    let bpm = Math.round((SP.bpm[0] + R.f() * (SP.bpm[1] - SP.bpm[0])) * RO.tempo * (pure || haunting ? 0.9 : 1) * (nuance === 'ballad' ? 0.8 : nuance === 'shout' ? 1.3 : 1));
    const phraseBars = engine === 'chorale' ? 2 : engine === 'chant' ? 0 : FM.name === 'Lullaby' ? 4 : 4;
    const dynMul = RO.dyn * (SP.soft || haunting ? 0.78 : 1) * (epic ? 1.15 : 1);

    // phrases per section, stretched or shrunk to the asked length
    let mult = 1, out = null;
    for (let tries = 0; tries < 6; tries++) {
      out = build(mult);
      if (!o.seconds) break;
      const sec = out.beats * 60 / bpm, want = o.seconds;
      if (Math.abs(sec - want) / want < 0.02) break;
      const nb = out.beats * 60 / want, lo = SP.bpm[0] * 0.78, hi = SP.bpm[1] * 1.25;
      if (nb >= lo && nb <= hi) { bpm = Math.round(nb * 10) / 10; break; }
      mult *= want / sec; bpm = clamp(bpm, lo, hi);
    }
    out.bpm = bpm; out.seconds = Math.round(out.beats * 60 / bpm);
    return out;

    function build(mult) {
      const R2 = mk(rng(o.seed * 7 + 3));
      const notes = [], markers = [], cc = [], plan = [];
      let beat = 0;
      const secs = FM.secs.map(([label, kind, ph, dyn], i) => ({ label, kind, phrases: Math.max(1, Math.round(ph * mult)), dyn: clamp(trailer ? 0.25 + 0.75 * i / (FM.secs.length - 1) : dyn * dynMul, 0.15, 1) }));
      const nPh = secs.reduce((s, x) => s + x.phrases, 0); let phIdx = 0;
      secs.forEach((sec, si) => {
        const secStart = beat; const before = notes.length;
        for (let k = 0; k < sec.phrases; k++) {
          const last = k === sec.phrases - 1, finalPhrase = si === secs.length - 1 && last;
          const ctx = { si, sec, k, last, finalPhrase, idx: phIdx++, nPh, first: si === 0 && k === 0 };
          const mask = phraseMask(ctx);
          const len = engine === 'chant' ? chantPhrase(beat, ctx, mask) : partPhrase(beat, ctx, mask);
          plan.push({ start: beat, beats: len, dyn: sec.dyn, mask });
          // the swell: rise to two thirds of the phrase, fall to the breath
          for (let b = 0; b < len; b += 0.5) { const x = b / len, arch = Math.sin(Math.PI * Math.min(1, x * 0.75 + 0.12)); cc.push({ t: Math.round((beat + b) * PPQ), v: clamp(Math.round(24 + 100 * sec.dyn * (0.55 + 0.45 * arch)), 1, 127) }); }
          beat += len;
        }
        const sn = notes.slice(before);
        const mv = sn.some((n) => ['B', 'T'].includes(n.voice)), wv = sn.some((n) => ['S', 'A'].includes(n.voice));
        sec.men = mv && who !== 'women'; sec.women = wv && who !== 'men'; sec.start = secStart; sec.beats = beat - secStart;
        markers.push({ t: Math.round(secStart * PPQ), text: sec.label + ' · ' + (sec.men && sec.women ? 'Men and women' : sec.men ? 'Men' : 'Women') });
      });
      return finish(notes, cc, markers, secs, beat, plan);

      // who sings this phrase
      function phraseMask(ctx) {
        let men = who !== 'women', women = who !== 'men';
        if (who === 'both' && !ctx.finalPhrase) {
          if (o.texture === 'callresponse' || o.texture === 'echo') { if (ctx.idx % 2 === 0) women = false; else men = false; }
          if (o.nuance === 'antiphon') { if (ctx.idx % 2 === 0) women = false; else men = false; }
        }
        if (trailer && who === 'both' && ctx.si === 0) women = false; // the trailer starts low and alone
        return { men, women };
      }
      function add(p, t, d, v, voice, lead) { if (d <= 0.05) return; notes.push({ p: Math.round(p), t: Math.round(t * PPQ), d: Math.round(d * PPQ), v: clamp(v, 0.05, 1), voice, lead: !!lead }); }

      // ---------- chant: one free line, a drone, or two groups taking turns ----------
      function chantPhrase(b0, ctx, mask) {
        const wide = SP.wide, fin = K.tonic, recite = K.mode === 'phrygian' ? 5 : 4; // reciting tone: the fifth degree, the sixth in Phrygian
        // where the line sits: everyone in the middle, or one group in its own keys
        let lo, hi;
        if (mask.men && mask.women && nuance !== 'drone') { lo = Z.menHi + 1; hi = Z.womenLo - 1; }
        else if (mask.men && !mask.women) { lo = Z.menLo + 3; hi = Z.menHi; }
        else { lo = Z.womenLo; hi = Z.womenHi - 2; }
        if (nuance === 'drone' && mask.men && mask.women) { lo = Z.womenLo; hi = Z.womenHi - 2; }
        let f0 = lo + ((fin - lo) % 12 + 12) % 12; if (f0 + 9 > hi && f0 - 12 >= lo - 2) f0 -= 12;
        const sd = (s) => { let p = f0, k = 0; const dir = Math.sign(s); while (k !== s) { p = K.step(p, dir || 1); k += dir; } return p; };
        const top = wide ? 9 : 6, line = [];
        // intonation, recitation, flex, cadence on the final (or on the reciting tone halfway)
        const startS = R2.pick([0, -1, 0, 2]); line.push(startS); for (let s = startS + 1; s <= recite; s += R2.pick([1, 1, 2])) line.push(Math.min(s, recite));
        if (line[line.length - 1] !== recite) line.push(recite);
        const rec = R2.int(2, wide ? 3 : 5); for (let i = 0; i < rec; i++) line.push(R2.chance(0.2) ? recite + 1 : recite);
        const peak = Math.min(top, recite + R2.int(1, wide ? 4 : 2)); for (let s = recite + 1; s <= peak; s++) line.push(s);
        const end = ctx.last || ctx.finalPhrase ? 0 : R2.pick([0, 2, recite]); for (let s = line[line.length - 1] - 1; s >= end; s--) { line.push(s); if (wide && R2.chance(0.3)) { line.push(s + 1); line.push(s); } }
        let b = b0; const unit = 0.5;
        line.forEach((s, i) => {
          const lastN = i === line.length - 1, p = clamp(sd(s), lo, hi);
          const d = lastN ? (ctx.finalPhrase ? 4 : 2) : (i === 0 || s === peak) ? unit * 2 : R2.pick([unit, unit, unit * 2]);
          add(p, b, lastN ? d - 0.5 : d, 0.6 + 0.2 * Math.sin(Math.PI * i / line.length), 'S', true);
          b += d;
        });
        b += 0.5; // breath
        if (nuance === 'drone' && (mask.men || who === 'both')) { const dp = Z.menLo + ((fin - Z.menLo) % 12 + 12) % 12; add(dp, b0, b - b0 - 0.5, 0.55, 'B'); if (dp + 7 <= Z.menHi) add(dp + 7, b0, b - b0 - 0.5, 0.45, 'T'); }
        return Math.ceil((b - b0) * 2) / 2;
      }

      // ---------- everything with harmony ----------
      function partPhrase(b0, ctx, mask) {
        const bars = engine === 'tint' ? 4 : phraseBars, nBeats = bars * meter;
        const rate = engine === 'chorale' ? 1 : engine === 'cluster' || haunting ? 8 : SP.rate || 2;
        const cadence = ctx.finalPhrase || ctx.last ? (ctx.sec.kind === 'B' && !ctx.finalPhrase ? 'half' : 'full') : R2.pick(['half', 'full', 'half', ctx.sec.kind === 'coda' ? 'plagal' : 'full']);
        const harm = engine === 'cluster' ? 'cluster' : engine === 'ostinato' ? 'ostinato' : SP.harm || 'func';
        const chords = engine === 'tint' ? [{ d: 0, beats: nBeats }] : phraseChords(R2, K, harm, nBeats, Math.min(rate, nBeats), ctx.sec.kind, cadence, ctx.first);
        const grp = mask.men && mask.women ? 'both' : mask.men ? 'men' : 'women';
        const ranges = rangesFor(Z, grp);
        const lead = grp === 'men' ? 'T' : grp === 'women' ? 'S' : o.texture === 'menlead' ? 'T' : o.texture === 'middle' ? 'A' : 'S';
        const soloSec = ctx.sec.kind === 'solo' || (o.solo !== 'none' && ctx.sec.kind !== 'B' && ctx.sec.kind !== 'climax');
        const solo = soloSec && grp === 'both' ? (o.solo === 'men' ? 'men' : 'women') : null;
        const climax = ctx.sec.kind === 'climax' ? 4 : ctx.sec.kind === 'B' ? 2 : 0;
        const nt = chords.length, mid = ranges.S ? (ranges.S[0] + ranges.S[1]) / 2 : 0;
        const target = ranges.S ? chords.map((c, i) => Math.round(mid - 2 + climax + 6 * Math.sin(Math.PI * Math.min(1, (i + 0.5) / nt * 0.8 + 0.1)) - (i === nt - 1 ? 3 : 0))) : chords.map(() => null);
        const V = voiceChords(chords, K, ranges, rules, partPhrase.prev && partPhrase.prevGrp === grp ? partPhrase.prev : null, target);
        partPhrase.prev = V[V.length - 1]; partPhrase.prevGrp = grp;
        const order = Object.keys(ranges); const starts = []; let acc = b0; chords.forEach((c) => { starts.push(acc); acc += c.beats; });
        const end = b0 + nBeats, breath = 0.5;
        const vel = (i, v, isLead) => 0.55 + (isLead ? 0.12 : 0) + 0.12 * Math.sin(Math.PI * (i + 0.5) / nt) + (v === 'B' ? 0.03 : 0);
        const offAt = (i) => starts[i] + chords[i].beats >= end - 0.001 ? chords[i].beats - breath : chords[i].beats;

        if (engine === 'tint') { // Pärt: one group sings a stepwise melody, the other only the notes of the tonic triad
          const mv = solo === 'men' || lead === 'T' ? 'men' : 'women';
          const mr = mv === 'men' ? (grp === 'both' ? [Z.menLo + 6, Z.menHi + 6] : ranges.T) : (grp === 'both' ? [Z.womenLo, Z.womenHi - 4] : ranges.S);
          let p = mr[0] + ((K.tonic - mr[0]) % 12 + 12) % 12; if (p + 5 > mr[1]) p -= 12;
          const n = 3 + (ctx.idx % 4), dir = ctx.idx % 2 ? -1 : 1, seq = [p]; let q = p;
          for (let i = 1; i < n; i++) { q = K.step(q, dir); seq.push(q); } for (let i = 0; i < n - 1; i++) { q = K.step(q, -dir); seq.push(q); }
          const d = nBeats / seq.length, triad = K.chord({ d: 0 });
          seq.forEach((m, i) => {
            const last = i === seq.length - 1, len = last ? d - breath : d;
            const mm = clamp(m, mr[0], mr[1]); add(mm, b0 + i * d, len, 0.5 + 0.15 * Math.sin(Math.PI * i / seq.length), mv === 'men' ? 'T' : 'S', true);
            if (grp !== 'both' && !(grp === 'women' && mv === 'women') && !(grp === 'men' && mv === 'men')) return;
            let t = mm + (mv === 'women' ? -1 : 1); while (!triad.includes(((t % 12) + 12) % 12)) t += mv === 'women' ? -1 : 1; // the nearest triad note below (or above for men)
            if (grp === 'both') { if (mv === 'women') { while (t > Z.womenLo - 1) t -= 12; } else { while (t < Z.menHi + 1) t += 12; } }
            else { t = mv === 'women' ? (t < ranges.A[0] ? t + 12 : t) : (t > ranges.T[1] ? t - 12 : t); }
            add(t, b0 + i * d, len, 0.42, mv === 'women' ? 'A' : 'S');
          });
          return nBeats;
        }
        if (engine === 'ostinato') { // Orff: a hammered rhythm in octaves, chords on the downbeats at the big moments
          const pats = [[1, 0.5, 0.5, 1, 1], [0.5, 0.5, 1, 0.5, 0.5, 1], [1.5, 0.5, 1, 1], [1, 1, 0.5, 0.5, 1]], pat = pats[ctx.si % pats.length];
          chords.forEach((c, i) => {
            const pcs = K.chord(c); let b = starts[i]; const off = offAt(i); let k = 0;
            for (const du of (meter === 3 ? [1, 1, 1] : pat)) { if (b - starts[i] >= off - 0.01) break; const len = Math.min(du, off - (b - starts[i]));
              const pc = pcs[k % 2 === 0 ? 0 : (k % 4 === 1 ? 2 : 1)]; const acc2 = k === 0 ? 0.18 : 0;
              if (mask.men) { const lo = grp === 'both' ? Z.menLo + 6 : ranges.T[0] - 5; let q = lo + ((pc - lo) % 12 + 12) % 12; if (grp !== 'both' && q > ranges.T[1]) q -= 12; add(q, b, len * 0.92, 0.72 + acc2, 'T', true); }
              if (mask.women) { const lo = grp === 'both' ? Z.womenLo : ranges.S[0] - 3; let q = lo + ((pc - lo) % 12 + 12) % 12; if (q > Z.womenHi) q -= 12; if (q < Z.womenLo) q += 12; add(q, b, len * 0.92, 0.72 + acc2, 'S', true); }
              b += len; k++; }
            if (ctx.sec.kind === 'climax' || ctx.finalPhrase) for (const v of order) if (v !== 'S' && v !== 'T') add(V[i][v], starts[i], off, 0.7, v);
          });
          return nBeats;
        }
        const rhythmOf = (D) => D >= 4 ? R2.pick([[4], [2, 2], [2, 1, 1], [3, 1], [1, 1, 2]]) : D >= 3 ? R2.pick([[3], [2, 1], [1, 1, 1]]) : D >= 2 ? R2.pick([[2], [1, 1], [1.5, 0.5]]) : R2.pick([[1], [0.5, 0.5], [1]]);
        const melodic = (v, ornate, isLead, from, to) => { // a singing line: chord tone on the beat, steps toward the next one
          for (let i = from || 0; i < (to == null ? nt : to); i++) {
            const off = offAt(i), p0 = V[i][v], p1 = i + 1 < nt ? V[i + 1][v] : p0;
            let rh = rhythmOf(off); if (!ornate) rh = [off]; const tot = rh.reduce((a, x) => a + x, 0); rh = rh.map((x) => x * off / tot);
            let p = p0, b = starts[i];
            const rg = ranges[v] || [0, 127];
            rh.forEach((du, k) => { if (k > 0) { const dir = Math.sign(p1 - p) || (R2.chance(0.5) ? 1 : -1); let q = K.step(p, dir); if (q < rg[0] || q > rg[1]) q = K.step(p, -dir); p = q; } add(p, b, du, vel(i, v, isLead), v, isLead); b += du; });
          }
        };
        const sustained = (v, soft, from, to) => { // long notes; a note that stays the same is held, not repeated
          const top = to == null ? nt : to; let i = from || 0; while (i < top) { let j = i; while (j + 1 < top && V[j + 1][v] === V[i][v]) j++; const dur = starts[j] + offAt(j) - starts[i]; add(V[i][v], starts[i], dur, vel(i, v) - (soft ? 0.18 : 0), v); i = j + 1; }
        };
        const blockRh = (D) => engine === 'block' ? (D >= 2 ? R2.pick([[1.5, 0.5], [1, 1], [0.75, 0.25, 1], [2]]) : [D]) : [D];
        const block = (v) => { // everyone on the same rhythm; the chorale adds passing notes between chord tones a third apart
          for (let i = 0; i < nt; i++) {
            const off = offAt(i), p0 = V[i][v], p1 = i + 1 < nt ? V[i + 1][v] : null; let rh = blockRh(off); const tot = rh.reduce((a, x) => a + x, 0); rh = rh.map((x) => x * off / tot);
            if (engine === 'chorale' && p1 != null && Math.abs(p1 - p0) >= 3 && Math.abs(p1 - p0) <= 4 && off >= 1 && v !== 'S' && R2.chance(0.45)) { add(p0, starts[i], off / 2, vel(i, v), v); add(K.step(p0, Math.sign(p1 - p0)), starts[i] + off / 2, off / 2, vel(i, v) - 0.05, v); continue; }
            let b = starts[i]; rh.forEach((du) => { add(p0, b, du, vel(i, v, v === lead) + (b === starts[i] ? 0.05 : 0), v, v === lead); b += du; });
          }
        };
        const poly = (v, entry) => { // independent lines: passing notes, suspensions that resolve down, staggered entries
          for (let i = 0; i < nt; i++) {
            if (starts[i] < entry - 0.001) continue;
            const off = offAt(i), p0 = V[i][v], p1 = i + 1 < nt ? V[i + 1][v] : null, prevP = i > 0 ? V[i - 1][v] : null;
            if (!pure && v !== 'B' && prevP != null && prevP - p0 >= 1 && prevP - p0 <= 2 && off >= 2 && starts[i] - 0.001 > entry && R2.chance(0.4)) { add(prevP, starts[i], off / 2, vel(i, v) + 0.05, v); add(p0, starts[i] + off / 2, off / 2, vel(i, v) - 0.05, v); continue; }
            if (!pure && p1 != null && Math.abs(p1 - p0) >= 3 && Math.abs(p1 - p0) <= 4 && off >= 2 && R2.chance(0.45)) { add(p0, starts[i], off / 2, vel(i, v), v); add(K.step(p0, Math.sign(p1 - p0)), starts[i] + off / 2, off / 2, vel(i, v) - 0.05, v); continue; }
            add(p0, starts[i], off, vel(i, v), v);
          }
        };
        const clusterV = () => { // Whitacre: notes a second apart that open slowly, entering from the bottom up
          chords.forEach((c, i) => {
            const pcs = K.chord(c), off = offAt(i), all = [];
            for (const v of order) { const base = V[i][v]; all.push([v, base]); const extra = pcs.find((pc) => ((base + 1) % 12 === pc || (base + 2) % 12 === pc)); if (extra != null && v !== 'B') { const q = base + ((extra - base) % 12 + 12) % 12; if (q <= (ranges[v] || [0, 127])[1]) all.push([v, q]); } }
            all.sort((a, b) => a[1] - b[1]).forEach(([v, p], k) => { const delay = i === 0 ? k * 0.5 : 0; add(p, starts[i] + delay, off - delay, vel(i, v) - 0.05, v); });
          });
        };
        if (engine === 'cluster') { clusterV(); return nBeats; }
        if (engine === 'gospel') { // a leader calls, the choir answers with rhythm; the ballad hums, the shout never stops
          const ballad = nuance === 'ballad', shout = nuance === 'shout', half = b0 + nBeats / 2;
          const lv = grp === 'men' ? 'T' : grp === 'women' ? 'S' : ctx.idx % 3 === 1 ? 'T' : 'S';
          const callTo = shout || ctx.finalPhrase ? 0 : Math.max(1, starts.findIndex((st) => st >= half - 0.001));
          if (callTo > 0) { melodic(lv, true, true, 0, callTo); const f = notes.find((n) => n.voice === lv && n.lead && n.t === Math.round(b0 * PPQ)); if (f && R2.chance(0.7)) { notes.push(Object.assign({}, f, { p: f.p - 1, d: Math.round(PPQ / 4) })); f.t += Math.round(PPQ / 4); f.d -= Math.round(PPQ / 4); }
            if (ballad || R2.chance(0.4)) for (const v of order) if (v !== lv) sustained(v, true, 0, callTo); }
          const pats = (D) => D >= 3.5 ? R2.pick([[1.5, 1.5, 1], [0.5, 1, 0.5, 2], [1, 0.5, 1, 1.5], [1.5, 0.5, 2]]) : D >= 1.5 ? R2.pick([[0.75, 0.75, 0.5], [1.5, 0.5], [0.5, 1, 0.5], [1, 1]]) : [D];
          for (let i = callTo; i < nt; i++) { const off = offAt(i), lastC = i === nt - 1; let rh = ballad && !ctx.finalPhrase ? [off] : lastC ? [off] : pats(off); const tot = rh.reduce((a, x) => a + x, 0); rh = rh.map((x) => x * off / tot);
            for (const v of order) { let b = starts[i]; rh.forEach((du, k) => { add(V[i][v], b, k === rh.length - 1 ? du : du * 0.82, vel(i, v, v === lv) + (k === 0 ? 0.08 : 0) + (shout ? 0.1 : 0), v, v === lv); b += du; }); } }
          if (ctx.finalPhrase && ranges.S) { const top = V[nt - 1].S, pcs = K.chord(chords[nt - 1]); let up = top + 1; while (!pcs.includes(up % 12)) up++; if (up <= ranges.S[1]) add(up, starts[nt - 1] + 0.5, offAt(nt - 1) - 0.5, 0.95, 'S', true); }
          return nBeats;
        }
        if (solo) { // one group sings free and ornamented, the other hums the chords softly
          const sv = solo === 'men' ? 'T' : 'S', hum = solo === 'men' ? ['A', 'S'] : ['T', 'B'];
          melodic(sv, true, true); hum.forEach((v) => sustained(v, true)); return nBeats;
        }
        if (engine === 'canon' && grp === 'both') { // the women lead, the men follow a bar later, an octave or two down
          melodic('S', true, true);
          const lead2 = notes.filter((n) => n.voice === 'S' && n.t >= b0 * PPQ && n.t < end * PPQ).map((n) => Object.assign({}, n));
          let prevF = null; for (const n of lead2) { const nb = n.t / PPQ + meter; if (nb >= end - 0.25) continue; let p = n.p - 24; while (p < ranges.T[0]) p += 12; while (p > ranges.T[1]) p -= 12; if (prevF != null) { if (p - prevF > 7 && p - 12 >= ranges.T[0]) p -= 12; else if (prevF - p > 7 && p + 12 <= ranges.T[1]) p += 12; }
            const ci = Math.max(0, starts.findIndex((s, i) => nb >= s && nb < s + chords[i].beats)); const pcs = K.chord(chords[ci]);
            if ((nb - b0) % 1 < 0.01 && !pcs.includes(p % 12)) { let q = p; for (let k = 1; k < 3; k++) { if (pcs.includes((p - k + 120) % 12)) { q = p - k; break; } if (pcs.includes((p + k) % 12)) { q = p + k; break; } } p = q; }
            if (prevF != null && Math.abs(p - prevF) > 12) { const q = p + (p > prevF ? -12 : 12); if (q >= ranges.T[0] - 2 && q <= ranges.T[1]) p = q; }
            add(p, nb, Math.min(n.d / PPQ, end - 0.5 - nb), n.v - 0.05, 'T', true); prevF = p; }
          sustained('B', true); return nBeats;
        }
        if (engine === 'poly' || engine === 'fugue' || engine === 'contrast' && ctx.sec.kind !== 'climax' && ctx.k % 2 === 0) {
          const ent = {}; const stag = engine === 'fugue' ? 2 * meter : meter;
          const seq = engine === 'fugue' ? ['T', 'A', 'B', 'S'] : ['S', 'A', 'T', 'B'];
          seq.filter((v) => order.includes(v)).forEach((v, k) => { ent[v] = ctx.first || (engine === 'fugue' && ctx.k === 0) ? b0 + k * stag : b0; });
          for (const v of order) if (ent[v] < end - meter) poly(v, Math.min(ent[v], end - meter)); else poly(v, end - meter);
          return nBeats;
        }
        if (engine === 'chorale' || engine === 'block' || engine === 'contrast') { for (const v of order) block(v); return nBeats; }
        // melody on top (Mozart, Fauré, epic, haunting): the lead sings, the others sustain
        melodic(lead, true, true);
        if (epic && grp === 'both' && lead === 'S') { const ln = notes.filter((n) => n.voice === 'S' && n.lead && n.t >= b0 * PPQ).map((n) => Object.assign({}, n)); for (const n of ln) { let p = n.p - 12; while (p > ranges.T[1]) p -= 12; while (p < ranges.T[0]) p += 12; notes.push(Object.assign(n, { p, voice: 'T' })); } }
        for (const v of order) if (v !== lead && !(epic && v === 'T' && lead === 'S' && grp === 'both')) sustained(v, o.texture !== 'together' && grp === 'both');
        return nBeats;
      }
    }

    function finish(notes, cc, markers, secs, beats, plan) {
      // velocity: the section's strength, the phrase arch, the lead a little louder
      for (const n of notes) { const pl = plan.find((x) => n.t >= x.start * PPQ && n.t < (x.start + x.beats) * PPQ) || plan[plan.length - 1]; n.vel = clamp(Math.round(18 + 105 * pl.dyn * n.v + (n.lead ? 6 : 0)), 12, 124); }
      // one key, one sound: the same pitch in two voices becomes one note
      notes.sort((a, b) => a.p - b.p || a.t - b.t);
      const merged = []; for (const n of notes) { const m = merged.length && merged[merged.length - 1]; if (m && m.p === n.p && n.t < m.t + m.d) { m.d = Math.max(m.d, n.t + n.d - m.t); m.vel = Math.max(m.vel, n.vel); m.lead = m.lead || n.lead; continue; } merged.push(Object.assign({}, n)); }
      merged.sort((a, b) => a.t - b.t || a.p - b.p);
      // a repeated key needs a tiny gap or the sampler swallows it
      const byP = {}; for (const n of merged) { const q = byP[n.p]; if (q && q.t + q.d > n.t - 20) q.d = Math.max(30, n.t - 20 - q.t); byP[n.p] = n; }
      // legato: if only one note sounds at a time, the notes overlap a little inside a phrase so the plugin glides
      let poly = 1; const ev = []; for (const n of merged) { ev.push([n.t, 1], [n.t + n.d, -1]); } ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); let cur = 0; for (const [, d] of ev) { cur += d; poly = Math.max(poly, cur); }
      const legato = poly <= 1;
      if (legato) for (let i = 0; i + 1 < merged.length; i++) { const a = merged[i], b = merged[i + 1]; const gap = b.t - (a.t + a.d); if (gap >= 0 && gap < PPQ / 4 && a.p !== b.p) a.d = b.t - a.t + 30; }
      // human: every voice has its own small lean (basses a hair late, the lead a hair early), every note a little scatter,
      // and no two notes the same strength; legato keeps its glide, a repeated key keeps its gap
      const H = mk(rng(o.seed * 13 + 5)), lean = {}, sh = (n) => { const k = n.voice || 'x'; if (lean[k] == null) lean[k] = H.int(-12, 12) + (/^B|men/i.test(k) ? 6 : 0); return lean[k] + H.int(-10, 10) - (n.lead ? 8 : 0); };
      const moves = merged.map((n) => (n.t === 0 ? 0 : sh(n)));
      if (legato) { for (let i = 0; i < merged.length; i++) { const a = merged[i], end = a.t + a.d, nx = merged[i + 1]; a.t = Math.max(0, a.t + moves[i]); const ov = nx && end > nx.t; a.d = Math.max(40, (ov ? nx.t + moves[i + 1] + 30 : end + H.int(-15, 10)) - a.t); } }
      else { for (let i = 0; i < merged.length; i++) { const a = merged[i], end = a.t + a.d; a.t = Math.max(0, a.t + moves[i]); a.d = Math.max(40, end + H.int(-25, 15) - a.t); } merged.sort((a, b) => a.t - b.t || a.p - b.p); const byP2 = {}; for (const n of merged) { const q = byP2[n.p]; if (q && q.t + q.d > n.t - 20) q.d = Math.max(30, n.t - 20 - q.t); byP2[n.p] = n; } }
      for (const n of merged) n.vel = clamp(n.vel + H.int(-6, 6) + ((n.t % (PPQ * meter)) < 40 ? 4 : 0), 10, 126);
      const strip = secs.map((s) => ({ label: s.label, start: s.start, beats: s.beats, men: s.men, women: s.women }));
      const desc = SP.name + ' · ' + ST.nuances[nuance] + ' · ' + FM.name + ' · ' + NOTE[K.tonic] + ' ' + MODE_NAMES[K.mode];
      return { notes: merged.map((n) => ({ t: n.t, d: n.d, p: n.p, v: n.vel, voice: n.voice })), cc, markers, beats, meter, key: NOTE[K.tonic] + ' ' + MODE_NAMES[K.mode], mode: K.mode, tonic: K.tonic, style: o.style, nuance, spirit: spiritKey, engine, form: o.form, role: o.role, who, strip, playMode: legato ? 'legato' : 'keys', maxPoly: poly, desc, zones: Z, rules };
    }
  }

  // ---------- MIDI: one track, format 0 ----------
  function toMidi(res, name) {
    const vlq = (n) => { const b = [n & 0x7f]; while ((n >>= 7)) b.unshift((n & 0x7f) | 0x80); return b; };
    const str = (s) => Array.from(unescape(encodeURIComponent(s))).map((c) => c.charCodeAt(0));
    const ev = [];
    const meta = (t, type, data) => ev.push({ t, o: 0, b: [0xff, type].concat(vlq(data.length), data) });
    meta(0, 0x03, str(name || 'Divine Choir')); meta(0, 0x02, str('Divine Monday'));
    for (const tp of (res.tempos || [{ t: 0, us: Math.round(60000000 / res.bpm) }])) { const us = tp.us; meta(tp.t, 0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]); }
    meta(0, 0x58, [res.meter, Math.round(Math.log2(res.meterDen || 4)), 24, 8]);
    for (const m of res.markers) meta(m.t, 0x06, str(m.text));
    let lastCc = -1; for (const c of res.cc) { if (c.v === lastCc) continue; ev.push({ t: c.t, o: 1, b: [0xb0, 1, c.v] }); lastCc = c.v; }
    for (const n of res.notes) { ev.push({ t: n.t, o: 3, b: [0x90, n.p, n.v] }); ev.push({ t: n.t + n.d, o: 2, b: [0x80, n.p, 0] }); }
    ev.sort((a, b) => a.t - b.t || a.o - b.o);
    const trk = []; let last = 0; for (const e of ev) { trk.push(...vlq(e.t - last), ...e.b); last = e.t; } trk.push(0, 0xff, 0x2f, 0);
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 255, PPQ & 255];
    const tl = trk.length; return new Uint8Array(head.concat([0x4d, 0x54, 0x72, 0x6b, (tl >>> 24) & 255, (tl >>> 16) & 255, (tl >>> 8) & 255, tl & 255], trk));
  }

  // ---------- the machine decides: a style and who sings in, a whole piece out ----------
  function auto(style, men, women, seed) {
    const R = mk(rng((seed ^ 0x9e3779b9) >>> 0)), both = men && women;
    const P = {
      gregorian: () => ({ nuance: both ? R.pick(['unison', 'drone', 'antiphon', 'antiphon']) : R.pick(['unison', 'drone']), spirit: women && !men ? 'hildegard' : R.pick(['chant', 'chant', 'hildegard']), form: R.pick(['kyrie', 'agnus', 'hymn', 'requiem']), role: R.pick(['pray', 'mourn', 'pray', 'comfort']) }),
      polyphony: () => ({ nuance: both ? R.pick(['woven', 'canon', 'pure', 'woven']) : R.pick(['woven', 'pure']), spirit: R.pick(['palestrina', 'palestrina', 'monteverdi']), form: R.pick(['motet', 'kyrie', 'agnus', 'hymn']), role: R.pick(['pray', 'comfort', 'mourn', 'celebrate']) }),
      baroque: () => { const nu = R.pick(['chorale', 'festive', 'fugue']); return { nuance: nu, spirit: nu === 'chorale' ? R.pick(['bach', 'bach', 'mozart']) : nu === 'festive' ? R.pick(['handel', 'handel', 'mozart']) : R.pick(['bach', 'handel']), form: nu === 'chorale' ? R.pick(['chorale', 'hymn', 'requiem']) : nu === 'festive' ? R.pick(['anthem', 'hymn', 'aria']) : R.pick(['kyrie', 'motet']), role: nu === 'festive' ? 'celebrate' : R.pick(['pray', 'mourn', 'comfort', 'celebrate']) }; },
      film: () => { const nu = R.pick(['epic', 'haunting', 'minimal', 'trailer', 'epic', 'haunting']); return { nuance: nu, spirit: nu === 'minimal' ? 'part' : nu === 'trailer' ? R.pick(['orff', 'whitacre']) : nu === 'epic' ? R.pick(['whitacre', 'faure', 'orff']) : R.pick(['faure', 'whitacre', 'part']), form: nu === 'trailer' || nu === 'epic' ? R.pick(['anthem', 'requiem', 'motet']) : R.pick(['requiem', 'lullaby', 'agnus', 'motet', 'aria']), role: nu === 'trailer' ? 'threaten' : nu === 'haunting' ? R.pick(['mourn', 'threaten', 'comfort']) : R.pick(['celebrate', 'mourn', 'pray', 'comfort']) }; },
      gospel: () => { const nu = R.pick(['spiritual', 'ballad', 'shout']); return { nuance: nu, spirit: 'gospel', form: nu === 'ballad' ? R.pick(['hymn', 'aria', 'lullaby']) : R.pick(['anthem', 'hymn', 'aria']), role: nu === 'ballad' ? R.pick(['comfort', 'pray']) : 'celebrate' }; }
    };
    const st = STYLES[style] ? style : 'baroque', o = P[st]();
    o.style = st; o.men = men; o.women = women; o.vowel = 'auto'; o.seed = Math.floor(R.f() * 1e9) + 1;
    o.texture = both ? R.pick(['together', 'together', 'callresponse', 'echo', 'menlead', 'womenlead', 'middle']) : 'together';
    if (st === 'gospel' || st === 'gregorian') o.texture = 'together';
    o.solo = o.form === 'aria' ? (both ? R.pick(['women', 'men']) : 'none') : both && R.chance(0.1) && st !== 'gregorian' ? R.pick(['women', 'men']) : 'none';
    return o;
  }

  // ---------- a random choir: every choice made for you ----------
  function surprise(seed) {
    const R = mk(rng(seed ^ 0x2545f491));
    const style = R.pick(Object.keys(STYLES)), ST = STYLES[style];
    const nuance = R.pick(Object.keys(ST.nuances)), spirit = R.pick(ST.spirits);
    const form = R.pick(style === 'baroque' ? ['chorale', 'hymn', 'anthem', 'kyrie', 'aria'] : style === 'gregorian' ? ['kyrie', 'agnus', 'hymn', 'requiem'] : Object.keys(FORMS));
    const both = R.chance(0.75), men = both || R.chance(0.5);
    return { style, nuance, spirit, form, role: R.pick(Object.keys(ROLES)), men, women: both || !men, texture: R.pick(Object.keys(TEXTURES)), solo: form === 'aria' ? R.pick(['women', 'men']) : R.chance(0.15) ? R.pick(['women', 'men']) : 'none', vowel: 'auto', seed: Math.floor(R.f() * 1e9) + 1 };
  }

  const API = { PPQ, STYLES, SPIRITS, FORMS, ROLES, TEXTURES, SOLOS, ZONES, compose, auto, toMidi, surprise, makeName, noteName, Key, voiceChords };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.Choir = API;
})(typeof window !== 'undefined' ? window : globalThis);
