// The messages an operator is actually stopped by, in both languages.
//
// Not every string in the ERP — several hundred labels and notes stay English,
// which is what the office reads them in. These are the refusals and warnings:
// the ones that appear at the moment somebody is trying to get work done, where
// reading them in the wrong language costs real time on a godown floor.
//
// Each is a function rather than a template string so the numbers land inside
// the sentence properly in both languages, where word order differs.

export interface Bilingual { en: string; hi: string }

const inr = (n: number) => n.toLocaleString("en-IN");

export const M = {
  // ── Stock ────────────────────────────────────────────────────────────────
  onlyAvailable: (available: number, sku: string): Bilingual => ({
    en: `Only ${inr(available)} of ${sku} available — reduce the quantity`,
    hi: `${sku} के सिर्फ़ ${inr(available)} उपलब्ध हैं — मात्रा कम करें`,
  }),
  onlyAvailableShort: (available: number): Bilingual => ({
    en: `Only ${inr(available)} available`,
    hi: `सिर्फ़ ${inr(available)} उपलब्ध`,
  }),
  belowMoq: (sku: string, moq: number): Bilingual => ({
    en: `${sku} has a minimum order of ${inr(moq)}`,
    hi: `${sku} की कम से कम ऑर्डर मात्रा ${inr(moq)} है`,
  }),
  stockMoved: (sku: string, shortBy: number): Bilingual => ({
    en: `Stock moved while the order was being keyed — ${sku} is short by ${inr(shortBy)}`,
    hi: `ऑर्डर लिखते समय स्टॉक बदल गया — ${sku} में ${inr(shortBy)} की कमी है`,
  }),
  stockMovedRecheck: (sku: string): Bilingual => ({
    en: `Stock moved while the order was being keyed — re-check ${sku}`,
    hi: `ऑर्डर लिखते समय स्टॉक बदल गया — ${sku} दोबारा देखें`,
  }),

  // ── Orders ───────────────────────────────────────────────────────────────
  addAnItem: (): Bilingual => ({
    en: "Add at least one item",
    hi: "कम से कम एक आइटम जोड़ें",
  }),
  oneLinePerOrder: (): Bilingual => ({
    en: "An order covers one business line — raise a separate order for the other line",
    hi: "एक ऑर्डर में एक ही बिज़नेस लाइन आती है — दूसरी लाइन के लिए अलग ऑर्डर बनाएं",
  }),
  jobWorkNotStock: (lineName: string): Bilingual => ({
    en: `${lineName} is produced to order — raise it from Jobs, not as a stock order`,
    hi: `${lineName} ऑर्डर पर बनता है — इसे जॉब वर्क से बनाएं, स्टॉक ऑर्डर से नहीं`,
  }),
  firmBlocked: (name: string, reason: string): Bilingual => ({
    en: `${name} is blocked — ${reason}`,
    hi: `${name} रोका गया है — ${reason}`,
  }),

  // ── Credit ───────────────────────────────────────────────────────────────
  creditReasonNeeded: (): Bilingual => ({
    en: "This firm is past its credit gate — a reason is required to book anyway",
    hi: "यह फ़र्म अपनी क्रेडिट सीमा पार कर चुकी है — फिर भी बुक करने के लिए कारण देना होगा",
  }),
  creditBlocked: (name: string, role: string): Bilingual => ({
    en: `${name} is over its credit limit and gated BLOCK. Your role (${role}) cannot override it — an Accounts Manager or Super Admin must raise this order.`,
    hi: `${name} क्रेडिट सीमा पार कर चुकी है और BLOCK पर है। आपकी भूमिका (${role}) इसे नहीं हटा सकती — यह ऑर्डर अकाउंट्स मैनेजर या सुपर एडमिन ही बना सकते हैं।`,
  }),
  belowMarginFloor: (rate: number, floor: number): Bilingual => ({
    en: `₹${inr(rate)} is below the margin floor of ₹${inr(floor)} — your role cannot override it`,
    hi: `₹${inr(rate)} मार्जिन की न्यूनतम सीमा ₹${inr(floor)} से कम है — आपकी भूमिका इसे नहीं बदल सकती`,
  }),

  // ── Pricing ──────────────────────────────────────────────────────────────
  fixedPriceList: (lineName: string): Bilingual => ({
    en: `${lineName} is sold from a fixed price list — per-firm pricing is not used on this line. Change the slab rates on the item instead.`,
    hi: `${lineName} तय प्राइस लिस्ट पर बिकता है — इस लाइन में फ़र्म-वार रेट नहीं चलते। इसके बजाय आइटम की स्लैब दरें बदलें।`,
  }),
  enterRate: (): Bilingual => ({ en: "Enter the agreed rate", hi: "तय रेट लिखें" }),
  enterDiscount: (): Bilingual => ({ en: "Enter the agreed discount", hi: "तय छूट लिखें" }),

  // ── Photographs ──────────────────────────────────────────────────────────
  samePhoto: (): Bilingual => ({
    en: "That is the same photograph as one already on this item",
    hi: "यह तस्वीर इस आइटम पर पहले से लगी हुई है",
  }),
  noPhoto: (): Bilingual => ({
    en: "This item has no photograph — it is showing generated artwork",
    hi: "इस आइटम की कोई तस्वीर नहीं है — बनाई गई आर्टवर्क दिख रही है",
  }),
  tooManyPages: (): Bilingual => ({
    en: "Twelve pages is already more than any card has — remove one first",
    hi: "बारह पेज किसी भी कार्ड से ज़्यादा हैं — पहले एक हटाएं",
  }),
  notAnImage: (): Bilingual => ({
    en: "That does not look like an image file",
    hi: "यह तस्वीर की फ़ाइल नहीं लगती",
  }),
  imageTooBig: (mb: string, limitMb: number): Bilingual => ({
    en: `That image is ${mb} MB — the limit is ${limitMb} MB`,
    hi: `यह तस्वीर ${mb} MB की है — सीमा ${limitMb} MB है`,
  }),

  // ── Invoices ─────────────────────────────────────────────────────────────
  seriesInUse: (lineName: string, prefix: string, fy: string): Bilingual => ({
    en: `${lineName} has already billed on ${prefix}/${fy} — the starting number cannot move once a series is in use. It applies to the next financial year.`,
    hi: `${lineName} पहले ही ${prefix}/${fy} पर बिल बना चुकी है — सीरीज़ शुरू होने के बाद शुरुआती नंबर नहीं बदलता। यह अगले वित्त वर्ष पर लागू होगा।`,
  }),

  // ── Not found ────────────────────────────────────────────────────────────
  itemNotFound: (): Bilingual => ({ en: "Item not found", hi: "आइटम नहीं मिला" }),
  firmNotFound: (): Bilingual => ({ en: "Firm not found", hi: "फ़र्म नहीं मिली" }),
} as const;

export type PanelLang = "en" | "hi";
export const pick = (m: Bilingual, lang: PanelLang) => (lang === "hi" ? m.hi : m.en);
