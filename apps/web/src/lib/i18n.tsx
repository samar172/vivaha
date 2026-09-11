"use client";
import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";

// The portal was written in Hindi, inline, because its readers are retailers on
// a godown floor in Bikaner. That was the right default and it stays the
// default. This adds English beside it rather than replacing anything: one
// dictionary, one hook, and the Hindi that was already in the markup becomes
// the Hindi column of the dictionary.
//
// Deliberately not a translation framework. The portal is a few dozen strings;
// a library would be more machinery than the thing it manages.
export type Lang = "hi" | "en";

const DICT: Record<string, [string, string]> = {
  // key:            [ Hindi,                      English ]
  home: ["होम", "Home"],
  shop: ["दुकान", "Shop"],
  cart: ["कार्ट", "Cart"],
  orders: ["ऑर्डर", "Orders"],
  account: ["खाता", "Account"],
  kit: ["किट", "Kit"],
  profile: ["प्रोफ़ाइल", "Profile"],
  signOut: ["साइन आउट", "Sign out"],
  cartEmpty: ["कार्ट खाली है", "Your cart is empty"],
  book: ["बुक करें", "Book"],
  bookAvailable: ["उपलब्ध बुक करें", "Book what is available"],
  notifyMe: ["स्टॉक आने पर बताएं", "Tell me when it is back"],
  total: ["कुल", "Total"],
  available: ["उपलब्ध", "available"],
  needed: ["चाहिए", "needed"],
  seeAlternatives: ["ये विकल्प देखें", "See these alternatives"],
  noAlternatives: ["इस समय कोई विकल्प उपलब्ध नहीं", "No alternatives just now"],
  view: ["देखें", "View"],
  add: ["जोड़ें", "Add"],
  remove: ["हटाएं", "Remove"],
  addedToCart: ["कार्ट में जोड़े गए", "added to cart"],
  minQty: ["कम से कम", "At least"],
  scanCard: ["कार्ड स्कैन करें", "Scan a card"],
  language: ["भाषा", "Language"],
};

interface Ctx { lang: Lang; setLang: (l: Lang) => void; t: (key: keyof typeof DICT | string) => string }
const C = createContext<Ctx | null>(null);

const KEY = "vivaha.portal.lang";

// The choice lives in localStorage, which is outside React. Reading it through
// useSyncExternalStore keeps the server render and the first client render in
// agreement — the server has no storage, so it renders the Hindi default and
// the client corrects on hydration without a mismatch.
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
const readStored = (): Lang => {
  try { const v = localStorage.getItem(KEY); return v === "en" ? "en" : "hi"; } catch { return "hi"; }
};
let snapshot: Lang | null = null;
const getSnapshot = (): Lang => (snapshot ??= readStored());
const getServerSnapshot = (): Lang => "hi";
const writeStored = (l: Lang) => {
  snapshot = l;
  try { localStorage.setItem(KEY, l); } catch { /* private window */ }
  listeners.forEach((fn) => fn());
};

export function LangProvider({ children }: { children: ReactNode }) {
  // Hindi is the default; a reader who switches keeps their choice on this device.
  const lang = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setLang = useCallback((l: Lang) => writeStored(l), []);
  const t = useCallback((key: string) => {
    const row = DICT[key];
    if (!row) return key;
    return lang === "en" ? row[1] : row[0];
  }, [lang]);
  return <C.Provider value={{ lang, setLang, t }}>{children}</C.Provider>;
}

export function useLang() {
  const c = useContext(C);
  // Usable outside the portal without blowing up — the ERP is English-only.
  if (!c) return { lang: "hi" as Lang, setLang: () => {}, t: (k: string) => DICT[k]?.[0] ?? k };
  return c;
}

// An item carries both names. Hindi readers get nameHi when it is filled in,
// and fall back to the English name when it is not, so an item added before
// the Hindi field existed still reads properly.
export function itemName(it: { name: string; nameHi?: string | null }, lang: Lang): string {
  if (lang === "en") return it.name;
  return it.nameHi?.trim() || it.name;
}
