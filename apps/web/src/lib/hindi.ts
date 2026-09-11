// Filling the Hindi name in for the operator as they type the English one.
//
// The catalogue's house style is transliteration, not translation — "Royal
// Scroll" is "रॉयल स्क्रॉल", not "शाही खर्रा" — with a handful of trade words
// that genuinely have a Hindi name ("Ink" is "स्याही", never "इंक"), and
// numbers, units and abbreviations left exactly as typed. GLOSSARY is that
// vocabulary, taken from the names already in the catalogue rather than
// invented, so a new card reads like the six hundred beside it.
//
// Anything not in the glossary falls through to a phonetic pass, which is a
// starting point rather than an answer — the field stays editable, and typing
// in it stops the auto-fill from touching it again.

const GLOSSARY: Record<string, string> = {
  // Trade words with a real Hindi name
  ink: "स्याही", colour: "रंग", color: "रंग", peacock: "मोर",

  // Print and stationery vocabulary, as the catalogue already writes it
  offset: "ऑफ़सेट", screen: "स्क्रीन", digital: "डिजिटल", print: "प्रिंट",
  overprint: "ओवरप्रिंट", plate: "प्लेट", blanket: "ब्लैंकेट", roller: "रोलर",
  cloth: "क्लॉथ", wash: "वॉश", solvent: "सॉल्वेंट", emulsion: "इमल्शन",
  metallic: "मेटैलिक", stamping: "स्टैम्पिंग", variable: "वेरिएबल",
  foil: "फ़ॉइल", embossed: "एम्बॉस्ड", handmade: "हैंडमेड", laser: "लेज़र",
  cut: "कट", process: "प्रोसेस", fountain: "फ़ाउंटेन", solution: "सोल्यूशन",
  concentrate: "कंसंट्रेट", card: "कार्ड", cards: "कार्ड", wedding: "वेडिंग",
  envelope: "लिफ़ाफ़ा", lifafa: "लिफ़ाफ़ा", invite: "इनवाइट", invitation: "इनविटेशन",
  box: "बॉक्स", packet: "पैकेट", sheet: "शीट", roll: "रोल", paper: "पेपर",
  fold: "फ़ोल्ड", trifold: "ट्राइफ़ोल्ड", panel: "पैनल", pocket: "पॉकेट",
  insert: "इनसर्ट", tag: "टैग", ribbon: "रिबन", thread: "धागा",

  // Materials and finishes
  acrylic: "ऐक्रिलिक", flex: "फ़्लेक्स", backlit: "बैकलिट", vinyl: "विनाइल",
  velvet: "वेलवेट", shimmer: "शिमर", pearl: "पर्ल", matte: "मैट", gloss: "ग्लॉस",
  brushed: "ब्रश्ड", clear: "क्लियर", milky: "मिल्की", silk: "सिल्क",
  woven: "वोवन", fabric: "फ़ैब्रिक", bag: "बैग", kraft: "क्राफ़्ट",
  textured: "टेक्सचर्ड", laminate: "लैमिनेट", board: "बोर्ड", cotton: "कॉटन",

  // Colours
  gold: "गोल्ड", golden: "गोल्डन", silver: "सिल्वर", white: "व्हाइट",
  black: "ब्लैक", cyan: "सायन", magenta: "मैजेंटा", yellow: "येलो",
  bronze: "ब्रॉन्ज़", maroon: "मैरून", ivory: "आइवरी", rose: "रोज़",
  blush: "ब्लश", onyx: "ऑनिक्स", emerald: "एमराल्ड", marigold: "मैरीगोल्ड",

  // Occasion and community vocabulary
  shagun: "शगुन", sagai: "सगाई", mehendi: "मेहंदी", reception: "रिसेप्शन",
  nikah: "निकाह", mehr: "मेहर", bismillah: "बिस्मिल्लाह", crescent: "क्रीसेंट",
  ek: "एक", onkar: "ओंकार", khanda: "खंडा", anand: "आनंद", karaj: "कारज",
  sikh: "सिख", jain: "जैन", mangal: "मंगल", kalash: "कलश", navkar: "नवकार",
  ganesha: "गणेश", ganesh: "गणेश", swarna: "स्वर्ण", shubh: "शुभ",
  zari: "ज़री", rajwada: "राजवाड़ा", panache: "पनाश", ambience: "एम्बिएंस",
  heritage: "हेरिटेज", royal: "रॉयल", classic: "क्लासिक", vintage: "विंटेज",
  scroll: "स्क्रॉल", star: "स्टार", crown: "क्राउन", regal: "रीगल",

  // Indic words and names, where "d" and "t" are dental — आदिल, not आडिल.
  // English loanwords take the retroflex ड and ट (डिजिटल, कार्ड), which is what
  // the phonetic pass below assumes, because this catalogue is mostly English
  // product vocabulary. A word of Indian origin has to be listed here for the
  // machine to know the difference; it cannot hear it.
  aadil: "आदिल", adil: "आदिल", deepak: "दीपक", devendra: "देवेंद्र", dev: "देव",
  mohit: "मोहित", rohit: "रोहित", amit: "अमित", sumit: "सुमित", punit: "पुनित",
  ajit: "अजित", ranjit: "रणजीत", harjit: "हरजीत", samar: "समर", vikram: "विक्रम",
  anil: "अनिल", sunil: "सुनील", vinod: "विनोद", dinesh: "दिनेश", mahesh: "महेश",
  ramesh: "रमेश", suresh: "सुरेश", rajesh: "राजेश", naresh: "नरेश", mukesh: "मुकेश",
  aditya: "आदित्य", aditi: "अदिति", madhur: "मधुर", madhu: "मधु", sudha: "सुधा",
  radha: "राधा", indira: "इंदिरा", chandan: "चंदन", chandra: "चंद्र", sunder: "सुंदर",
  mandir: "मंदिर", moti: "मोती", sita: "सीता", gita: "गीता", geeta: "गीता",
  preeti: "प्रीति", priti: "प्रीति", smriti: "स्मृति", shanti: "शांति", kranti: "क्रांति",
  bharat: "भारत", vasant: "वसंत", basant: "बसंत", sangeet: "संगीत", vivah: "विवाह",
  vivaha: "विवाह", shaadi: "शादी", shadi: "शादी", baraat: "बारात", barat: "बारात",
  tilak: "तिलक", haldi: "हल्दी", sagan: "सगन", mandap: "मंडप",
  pandit: "पंडित", prasad: "प्रसाद", laddu: "लड्डू", mithai: "मिठाई", thali: "थाली",
  diya: "दीया", rangoli: "रंगोली", toran: "तोरण", kundan: "कुंदन", meenakari: "मीनाकारी",
  banarasi: "बनारसी", jaipuri: "जयपुरी", marwari: "मारवाड़ी", rajasthani: "राजस्थानी",
  sitara: "सितारा", chunri: "चुनरी", dupatta: "दुपट्टा", sindoor: "सिंदूर",
};

// Left alone: anything that is not plainly a word — 510, 3mm, 605×745, ACP,
// CTP, GSM. Transliterating those helps nobody.
const KEEP_AS_IS = /^[^A-Za-z]*$|^\d|^(acp|ctp|gsm|uv|pvc|mm|cm|ft|kg|ltr|nos|pcs|hd|led)$/i;

// Two letters that make one sound, longest first.
const DIGRAPHS: [string, string][] = [
  ["sch", "श"], ["tch", "च"],
  ["sh", "श"], ["ch", "च"], ["th", "थ"], ["ph", "फ़"], ["kh", "ख"], ["gh", "घ"],
  ["bh", "भ"], ["dh", "ध"], ["jh", "झ"], ["ck", "क"], ["qu", "क्व"], ["wh", "व"],
  ["kn", "न"], ["ps", "स"],
];

const CONSONANTS: Record<string, string> = {
  b: "ब", c: "क", d: "ड", f: "फ़", g: "ग", h: "ह", j: "ज", k: "क", l: "ल",
  m: "म", n: "न", p: "प", q: "क", r: "र", s: "स", t: "ट", v: "व", w: "व",
  x: "क्स", y: "य", z: "ज़",
};

// Vowel sounds, as the independent letter and as the matra that hangs off a
// consonant. Longest spellings first so "ee" beats "e".
const VOWELS: [string, string, string][] = [
  ["aa", "आ", "ा"], ["ai", "ऐ", "ै"], ["au", "औ", "ौ"], ["ee", "ई", "ी"],
  ["ea", "ी", "ी"], ["oo", "ऊ", "ू"], ["ou", "आउ", "ाउ"], ["oa", "ो", "ो"],
  ["ay", "े", "े"], ["ey", "े", "े"], ["ie", "ी", "ी"], ["oi", "ॉय", "ॉय"],
  ["iu", "इय", "िय"], ["a", "अ", "ा"], ["e", "ए", "े"], ["i", "इ", "ि"], ["o", "ओ", "ो"], ["u", "उ", "ु"],
];

const HALANT = "्";
const ANUSVARA = "ं";

const isConsonantStart = (w: string, i: number) =>
  i < w.length && !VOWELS.some((v) => w.startsWith(v[0], i)) && (CONSONANTS[w[i]] !== undefined || DIGRAPHS.some((d) => w.startsWith(d[0], i)));

function translitWord(word: string): string {
  // Doubled letters are one sound in Hindi — "butter" is बटर, not बट्टर.
  const w = word.toLowerCase().replace(/([bcdfgklmnprstvz])\1/g, "$1");
  let out = "";
  let i = 0;
  let lastWasConsonant = false;

  while (i < w.length) {
    // "y" wedged between consonants is doing the job of an "i" — crystal.
    if (w[i] === "y" && lastWasConsonant && isConsonantStart(w, i + 1)) {
      out += "ि"; i += 1; lastWasConsonant = false; continue;
    }
    // A trailing "y" is the long "ee" sound — fly, jaipuri, gully.
    if (w[i] === "y" && i === w.length - 1 && lastWasConsonant) {
      out += "ी"; i += 1; lastWasConsonant = false; continue;
    }

    // "er" and a trailing "us" are swallowed sounds: butter is बटर, lotus लोटस.
    if (lastWasConsonant && (w.startsWith("er", i) || w.startsWith("ur", i)) && !isConsonantStart(w, i + 2) === false) {
      out += "र"; i += 2; lastWasConsonant = true; continue;
    }
    if (lastWasConsonant && w.startsWith("us", i) && i + 2 === w.length) {
      out += "स"; i += 2; lastWasConsonant = true; continue;
    }

    const v = VOWELS.find((x) => w.startsWith(x[0], i));
    if (v) {
      const atEnd = i + v[0].length === w.length;
      // A trailing "e" is usually silent: rose, plate, deluxe.
      if (atEnd && v[0] === "e" && lastWasConsonant) { i += 1; lastWasConsonant = false; continue; }
      // Short "a" mid-word after a consonant is the inherent vowel — it gets no
      // matra at all. Writing "ा" for it is what turns चंदन into चान्डान. At the
      // end of a word it is pronounced, though: सितारा, राजवाड़ा.
      if (v[0] === "a" && lastWasConsonant && !atEnd) { i += 1; lastWasConsonant = false; continue; }
      // A word ending in "i" is the long ई: जैपुरी, बनारसी, ज़री.
      if (v[0] === "i" && lastWasConsonant && atEnd) { out += "ी"; i += 1; lastWasConsonant = false; continue; }
      out += lastWasConsonant ? v[2] : v[1];
      i += v[0].length;
      lastWasConsonant = false;
      continue;
    }

    // "n" or "m" closing a syllable before another consonant is a nasal mark,
    // not a full letter: chandan, mandap, sampark.
    if ((w[i] === "n" || w[i] === "m") && !lastWasConsonant && out && isConsonantStart(w, i + 1)) {
      out += ANUSVARA; i += 1; lastWasConsonant = false; continue;
    }

    const d = DIGRAPHS.find((x) => w.startsWith(x[0], i));
    const letter = d ? d[1] : CONSONANTS[w[i]];
    if (letter) {
      // Consonant meeting consonant binds with a halant, so "scroll" comes out
      // as the cluster स्क्रॉल rather than सकरॉल.
      if (lastWasConsonant) out += HALANT;
      out += letter;
      i += d ? d[0].length : 1;
      lastWasConsonant = true;
      continue;
    }
    out += w[i];
    i += 1;
    lastWasConsonant = false;
  }
  return out;
}

/** One word: the catalogue's own Hindi where it has one, else a phonetic guess. */
export function hindiWord(word: string): string {
  if (!word) return word;
  if (KEEP_AS_IS.test(word)) return word;
  const hyphen = word.split("-");
  if (hyphen.length > 1) return hyphen.map(hindiWord).join("-");
  const key = word.toLowerCase().replace(/[^a-z]/g, "");
  return GLOSSARY[key] ?? translitWord(word);
}

/** A whole item name, word by word, keeping the separators as typed. */
export function toHindi(name: string): string {
  if (!name.trim()) return "";
  return name.split(/(\s+|—|–)/).map((t) => (/^\s+$|^[—–]$/.test(t) ? t : hindiWord(t))).join("");
}
