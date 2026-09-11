"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// "Install this as an app" — the card that appears once, shortly after a person
// signs in on a browser.
//
// Two things had to be got right, because both are how these prompts usually go
// wrong in the field:
//
//  * Chrome and Edge fire `beforeinstallprompt` and hand over an event that can
//    only be used from inside a user gesture. So the event is captured and held,
//    and `prompt()` is called from the button's own click — not on a timer.
//  * iOS Safari fires nothing at all and has no programmatic install. There the
//    card explains the Share → "Add to Home Screen" route instead, with the
//    steps spelled out, because the retailers on the portal are on iPhones as
//    often as on Android.
//
// A dismissal is remembered: "later" quietens it for a fortnight, "no thanks"
// for good. Nothing shows at all once the app is actually installed.

const KEY = "vivaha.install.dismissed";
const LATER_DAYS = 14;

type Choice = { until: number | "never" };

interface BipEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

const readChoice = (): Choice | null => {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Choice) : null;
  } catch {
    return null;
  }
};
const writeChoice = (c: Choice) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* private window */ } };

const installed = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true);

// Safari on an iPhone or iPad, where the only route is the Share sheet. iPadOS
// reports itself as a Mac, so touch points are the tell.
const iosSafari = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const apple = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const safari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return apple && safari;
};

/** Points <link rel="manifest"> at this section's manifest.
 *
 * The ERP and the shop live on one origin under different scopes, and each is
 * its own installable app — the office wants the dashboard, a retailer wants
 * the shop. The root layout links the ERP manifest; the portal swaps it for its
 * own on mount, which is before Chrome decides what is installable. */
function useManifest(href: string) {
  useEffect(() => {
    const el = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    if (!el || el.getAttribute("href") === href) return;
    const was = el.getAttribute("href");
    el.setAttribute("href", href);
    return () => { if (was) el.setAttribute("href", was); };
  }, [href]);
}

/** Registers the service worker. Safe to mount more than once. */
export function useServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    if (location.protocol !== "https:" && location.hostname !== "localhost") return;
    // A failed registration is not worth a toast — it only costs installability.
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);
}

export function InstallApp({ hindi = false, delayMs = 2500, manifest = "/manifest.webmanifest" }: { hindi?: boolean; delayMs?: number; manifest?: string }) {
  useServiceWorker();
  useManifest(manifest);
  const [show, setShow] = useState(false);
  // Settled at mount rather than in the effect: iOS never fires the install
  // event, so its mode is a property of the browser, not of anything that happens.
  const [mode] = useState<"prompt" | "ios">(() => (iosSafari() ? "ios" : "prompt"));
  const bip = useRef<BipEvent | null>(null);
  const t = useCallback((en: string, hi: string) => (hindi ? hi : en), [hindi]);

  useEffect(() => {
    if (installed()) return;
    const c = readChoice();
    if (c && (c.until === "never" || Date.now() < c.until)) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const onBip = (e: Event) => {
      // Keep the browser's own mini-infobar out of the way; the card replaces it.
      e.preventDefault();
      bip.current = e as BipEvent;
      timer = setTimeout(() => setShow(true), delayMs);
    };
    const onInstalled = () => { setShow(false); writeChoice({ until: "never" }); };

    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);

    // iOS has no event to wait for, so the card is offered on a timer instead.
    if (mode === "ios") timer = setTimeout(() => setShow(true), delayMs);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
      if (timer) clearTimeout(timer);
    };
  }, [delayMs, mode]);

  if (!show) return null;

  const later = () => { writeChoice({ until: Date.now() + LATER_DAYS * 864e5 }); setShow(false); };
  const never = () => { writeChoice({ until: "never" }); setShow(false); };

  const install = async () => {
    const e = bip.current;
    if (!e) return later();
    setShow(false);
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      // A refusal in the browser's own dialog is a refusal — do not ask again
      // for a fortnight. An acceptance is handled by `appinstalled`.
      if (outcome !== "accepted") writeChoice({ until: Date.now() + LATER_DAYS * 864e5 });
    } catch {
      later();
    } finally {
      bip.current = null;
    }
  };

  return (
    <div className="ins" role="dialog" aria-modal="false" aria-label={t("Install the app", "ऐप इंस्टॉल करें")}>
      <div className="insb">
        <div className="insi" aria-hidden="true">VC</div>
        <div className="inst">
          <h4 className={hindi ? "hi" : ""}>{t("Install Vivaha on this device", "इस डिवाइस पर Vivaha इंस्टॉल करें")}</h4>
          {mode === "ios" ? (
            <p className={hindi ? "hi" : ""}>
              {t(
                "Tap Share at the bottom of Safari, then “Add to Home Screen”. It opens full screen, without the address bar.",
                "नीचे Safari में Share (⇧) दबाएँ, फिर “Add to Home Screen” चुनें। ऐप पूरी स्क्रीन पर खुलेगा।",
              )}
            </p>
          ) : (
            <p className={hindi ? "hi" : ""}>
              {t(
                "Opens from your home screen or desktop, full screen and without the address bar. Works the same as here.",
                "होम स्क्रीन से सीधा खुलेगा — पूरी स्क्रीन, बिना एड्रेस बार। काम वैसा ही रहेगा।",
              )}
            </p>
          )}
          <div className="insa">
            {mode === "prompt" && (
              <button className="b b-p b-s" onClick={install}>{t("Install", "इंस्टॉल करें")}</button>
            )}
            <button className="b b-o b-s" onClick={later}>{t("Later", "बाद में")}</button>
            <button className="b b-g b-s" onClick={never}>{t("Don’t ask again", "दोबारा न पूछें")}</button>
          </div>
        </div>
        <button className="insx" onClick={later} aria-label={t("Close", "बंद करें")}>×</button>
      </div>
    </div>
  );
}
