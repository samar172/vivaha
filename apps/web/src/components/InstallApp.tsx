"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

// "Install this as an app."
//
// The hard part of this is not the card — it is that every platform offers a
// different door, and two of them offer none at all:
//
//   Chrome / Edge, Android and desktop  fire `beforeinstallprompt` and hand
//     over an event that can only be used from inside a user gesture. The event
//     is captured in the boot script in the root layout, because on a handset
//     it routinely fires before React has hydrated; here we only read it.
//   Safari on iOS                        fires nothing and has no programmatic
//     install. The only route is Share → Add to Home Screen, so the card says so.
//   Chrome / Edge / Firefox on iOS       cannot install at all. Apple allows it
//     only from Safari. Telling somebody to "tap Share" in Chrome on an iPhone
//     sends them looking for a button that will never work, so this says plainly
//     that the page has to be opened in Safari.
//   Firefox / Samsung Internet on Android  do not fire the event either, but do
//     have "Add to Home screen" in their own menu. Named, rather than left as
//     silence.
//
// And because any timed card can be missed or dismissed, the same thing is
// always reachable by hand — Install app in the office profile drawer, and on
// the shop's account screen. `InstallButton` is that door.

const KEY = "vivaha.install.dismissed";
const LATER_DAYS = 14;

type Choice = { until: number | "never" };

interface BipEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
interface InstallWindow extends Window { __vivInstall?: { evt: BipEvent | null; installed: boolean } }

const readChoice = (): Choice | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Choice) : null;
  } catch {
    return null;
  }
};
const writeChoice = (c: Choice) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private window */ } };

export const alreadyInstalled = () =>
  typeof window !== "undefined" &&
  (!!(window as InstallWindow).__vivInstall?.installed ||
    window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true);

/** Which door this browser actually has. iPadOS reports itself as a Mac, so
 *  touch points are the tell. */
type Door = "prompt" | "ios-safari" | "ios-other" | "menu";
function doorFor(hasEvent: boolean): Door {
  if (hasEvent) return "prompt";
  if (typeof navigator === "undefined") return "menu";
  const ua = navigator.userAgent;
  const apple = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (apple) return /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua) ? "ios-other" : "ios-safari";
  return "menu";
}

// Whether this browser is offering to install is not React state — it is the
// browser's own, parked on the window by the boot script and moved by events.
// Subscribed to rather than copied into state, so a card that mounted before
// Chrome was ready lights up the moment it is.
const subscribe = (fn: () => void) => {
  const mq = window.matchMedia?.("(display-mode: standalone)");
  window.addEventListener("viv:installable", fn);
  window.addEventListener("viv:installed", fn);
  mq?.addEventListener?.("change", fn);
  return () => {
    window.removeEventListener("viv:installable", fn);
    window.removeEventListener("viv:installed", fn);
    mq?.removeEventListener?.("change", fn);
  };
};
// The event object's identity is stable while it is live, and both snapshots
// are values the browser owns, so neither can loop.
const readEvt = () => (window as InstallWindow).__vivInstall?.evt ?? null;
const readInstalled = () => alreadyInstalled();

/** The install offer this browser has made, if any. */
export function useInstallOffer() {
  const evt = useSyncExternalStore(subscribe, readEvt, () => null);
  const installed = useSyncExternalStore(subscribe, readInstalled, () => false);
  const door = doorFor(!!evt);

  /** Returns true when the browser's own install dialog was opened, false when
   *  there is nothing to open and the caller should show instructions instead. */
  const prompt = useCallback(async () => {
    const w = window as InstallWindow;
    const e = w.__vivInstall?.evt;
    if (!e) return false;
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      // The event is single-use whatever the answer; tell the store it has gone.
      w.__vivInstall!.evt = null;
      window.dispatchEvent(new Event("viv:installable"));
      if (outcome !== "accepted") writeChoice({ until: Date.now() + LATER_DAYS * 864e5 });
      return true;
    } catch {
      return false;
    }
  }, []);

  return { door, installed, canPrompt: !!evt, prompt };
}

/** Kept for callers that only want the service worker; registration itself now
 *  happens in the root layout's boot script, on every page including /login. */
export function useServiceWorker() { /* registered before hydration — see app/layout.tsx */ }

function Steps({ door, hindi }: { door: Door; hindi: boolean }) {
  const t = (en: string, hi: string) => (hindi ? hi : en);
  if (door === "ios-safari") return <p className={hindi ? "hi" : ""}>{t(
    "Tap Share at the bottom of Safari, then “Add to Home Screen”. It opens full screen, without the address bar.",
    "नीचे Safari में Share (⇧) दबाएँ, फिर “Add to Home Screen” चुनें। ऐप पूरी स्क्रीन पर खुलेगा।",
  )}</p>;
  if (door === "ios-other") return <p className={hindi ? "hi" : ""}>{t(
    "On an iPhone only Safari can add an app to the home screen. Open this same page in Safari, tap Share, then “Add to Home Screen”.",
    "iPhone पर ऐप सिर्फ़ Safari से जुड़ सकता है। यही पेज Safari में खोलें, Share (⇧) दबाएँ, फिर “Add to Home Screen” चुनें।",
  )}</p>;
  return <p className={hindi ? "hi" : ""}>{t(
    "Open your browser’s menu (⋮ at the top right) and choose “Install app”, or “Add to Home screen”. It then opens full screen, without the address bar.",
    "ब्राउज़र का मेन्यू (ऊपर दाईं ओर ⋮) खोलें और “Install app” या “Add to Home screen” चुनें। ऐप पूरी स्क्रीन पर खुलेगा।",
  )}</p>;
}

/** The card that appears on its own, shortly after somebody signs in. */
export function InstallApp({ hindi = false, delayMs = 2500 }: { hindi?: boolean; delayMs?: number; manifest?: string }) {
  const { door, installed, canPrompt, prompt } = useInstallOffer();
  const [show, setShow] = useState(false);
  const [steps, setSteps] = useState(false);
  const t = useCallback((en: string, hi: string) => (hindi ? hi : en), [hindi]);

  useEffect(() => {
    // Already an app on this device — the render guard below handles it.
    if (installed) return;
    const c = readChoice();
    if (c && (c.until === "never" || Date.now() < c.until)) return;
    // Every browser now gets the card: the ones that can prompt, and the ones
    // that can only be told where their own menu is. Silence was the bug.
    const timer = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, installed, canPrompt]);

  if (!show || installed) return null;

  const later = () => { writeChoice({ until: Date.now() + LATER_DAYS * 864e5 }); setShow(false); };
  const never = () => { writeChoice({ until: "never" }); setShow(false); };
  const install = async () => {
    if (await prompt()) { setShow(false); return; }
    // Nothing to open — show this browser's own route instead of doing nothing.
    setSteps(true);
  };

  return (
    <div className="ins" role="dialog" aria-modal="false" aria-label={t("Install the app", "ऐप इंस्टॉल करें")}>
      <div className="insb">
        <div className="insi" aria-hidden="true">VC</div>
        <div className="inst">
          <h4 className={hindi ? "hi" : ""}>{t("Install Vivaha on this device", "इस डिवाइस पर Vivaha इंस्टॉल करें")}</h4>
          {canPrompt && !steps
            ? <p className={hindi ? "hi" : ""}>{t(
              "Opens from your home screen or desktop, full screen and without the address bar. Works the same as here.",
              "होम स्क्रीन से सीधा खुलेगा — पूरी स्क्रीन, बिना एड्रेस बार। काम वैसा ही रहेगा।",
            )}</p>
            : <Steps door={door} hindi={hindi} />}
          <div className="insa">
            {canPrompt && !steps && <button className="b b-p b-s" onClick={install}>{t("Install", "इंस्टॉल करें")}</button>}
            <button className="b b-o b-s" onClick={later}>{t("Later", "बाद में")}</button>
            <button className="b b-g b-s" onClick={never}>{t("Don’t ask again", "दोबारा न पूछें")}</button>
          </div>
        </div>
        <button className="insx" onClick={later} aria-label={t("Close", "बंद करें")}>×</button>
      </div>
    </div>
  );
}

/** The permanent door. A timed card can be missed or waved away; this is how
 *  somebody installs the app a fortnight later, when they finally want it. */
export function InstallButton({ hindi = false, className = "b b-o", label }: { hindi?: boolean; className?: string; label?: string }) {
  const { door, installed, canPrompt, prompt } = useInstallOffer();
  const [steps, setSteps] = useState(false);
  const t = (en: string, hi: string) => (hindi ? hi : en);

  if (installed) return <div className={"sm" + (hindi ? " hi" : "")}>{t("Installed on this device.", "इस डिवाइस पर इंस्टॉल है।")}</div>;

  const go = async () => { if (!(await prompt())) setSteps(true); };

  return <>
    <button className={className + (hindi ? " hi" : "")} onClick={go}>
      {label ?? t("Install app", "ऐप इंस्टॉल करें")}
    </button>
    {(steps || !canPrompt) && <div className="inss"><Steps door={door} hindi={hindi} /></div>}
  </>;
}
