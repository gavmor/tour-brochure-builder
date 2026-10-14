/**
 * The brochure view: a printable, shareable rendering of a tour.
 *
 * Page 1 is the tri-fold sheet — map across panels 1–2, itinerary column in
 * panel 3 (SPEC §2). Stop detail cards follow on continuation pages. The
 * chrome above the sheet (view switch, Print, Copy share link, Edit a copy)
 * is screen-only and disappears from the print.
 */

import { useEffect, useRef, useState } from "preact/hooks";
import { editCopyFlow, showEditor } from "../appState";
import { OSM_ATTRIBUTION } from "../editor/leafletSetup";
import { routingAttributionHtml } from "../editor/routeGeometry";
import {
  readOnly,
  shareLink,
  shareUrlLength,
  shareUrlWarning,
  tour,
} from "../tour";
import { BrochureMap } from "./BrochureMap";
import { copyText } from "./clipboard";
import { tourSummaryLine } from "./content";
import { ItineraryColumn, ItinerarySpill } from "./ItineraryColumn";
import { Legend } from "./Legend";
import { isPrintFlowActive, printBrochure, printPrep } from "./printing";
import { StopCards } from "./StopCards";
import { clearSpill, measureSpill } from "./spill";
import "./brochure.css";

type Tone = "ok" | "warn" | "error";
interface Status {
  tone: Tone;
  text: string;
}

const numberFormat = new Intl.NumberFormat("en-US");

export function Brochure() {
  const current = tour.value;
  const locked = readOnly.value;
  const staging = printPrep.value;
  const warning = shareUrlWarning.value;
  const length = shareUrlLength.value;

  const sheetRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status | null>(null);
  /** Set when the clipboard is unavailable: show the link to copy by hand. */
  const [manualLink, setManualLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Transient confirmations should not linger as stale UI.
  useEffect(() => {
    if (!status || status.tone === "error") return;
    const timer = setTimeout(() => setStatus(null), 6000);
    return () => clearTimeout(timer);
  }, [status]);

  // Ctrl+P bypasses the Print button, so take the same spill measurement on
  // the browser's own print event. It is best-effort — `beforeprint` cannot be
  // held open for a re-render — but it beats clipping the itinerary's tail.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onBefore = () => {
      if (isPrintFlowActive()) return; // the Print button already measured
      measureSpill(
        sheetRef.current?.querySelector<HTMLElement>(".bro-itinerary") ?? null,
      );
    };
    const onAfter = () => {
      if (isPrintFlowActive()) return; // that flow clears up when it is done
      clearSpill();
    };
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
    };
  }, []);

  const handlePrint = async () => {
    setBusy(true);
    setStatus(null);
    const result = await printBrochure(() => sheetRef.current, {
      // Measured in print geometry: whatever does not fit panel 3 moves to the
      // continuation sheet instead of being clipped away (SPEC §5 item 6).
      measure: () =>
        measureSpill(
          sheetRef.current?.querySelector<HTMLElement>(".bro-itinerary") ??
            null,
        ),
      cleanup: clearSpill,
    });
    setBusy(false);
    if (result.tiles === "timeout" || result.images === "timeout") {
      setStatus({
        tone: "warn",
        text:
          result.tiles === "timeout"
            ? "Some map tiles were still loading when the print started — check the preview, and try again if the map looks patchy."
            : "Some stop images were still loading when the print started — check the preview before printing.",
      });
    }
  };

  const handleCopy = async () => {
    const link = shareLink.peek();
    setManualLink(null);
    const outcome = await copyText(link.url);
    const size = numberFormat.format(link.urlLength);

    if (outcome === "failed") {
      setManualLink(link.url);
      setStatus({
        tone: "error",
        text: "This browser blocked the clipboard — the link is below, select and copy it.",
      });
      return;
    }
    if (link.tooLong) {
      setStatus({
        tone: "error",
        text: `Copied, but the link is ${size} characters. Links this long are truncated by some chat apps and proxies — export the tour as JSON instead.`,
      });
      return;
    }
    setStatus({
      tone: link.warn ? "warn" : "ok",
      text: link.warn
        ? `Share link copied (${size} characters — close to the ~8,000 limit some chat apps impose).`
        : "Share link copied. It opens this brochure read-only.",
    });
  };

  const handleEditCopy = () => {
    const copy = editCopyFlow();
    setStatus(
      copy
        ? { tone: "ok", text: "Editing a copy. The shared link is unchanged." }
        : { tone: "ok", text: "Kept the tour saved in this browser." },
    );
  };

  return (
    <div class={`brochure${staging ? " brochure--staging" : ""}`}>
      <header class="brochure__chrome no-print">
        <div class="brochure__chrome-meta">
          <strong class="brochure__chrome-title">{current.title}</strong>
          <span class="brochure__chrome-sub">{tourSummaryLine(current)}</span>
        </div>
        <div class="brochure__chrome-actions">
          {locked ? null : (
            <button type="button" onClick={showEditor}>
              ← Editor
            </button>
          )}
          <button
            type="button"
            class="primary"
            onClick={handlePrint}
            disabled={busy}
          >
            {busy ? "Preparing…" : "Print"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            title={`Share link: ${numberFormat.format(length)} characters`}
          >
            Copy share link
          </button>
          {locked ? (
            <button type="button" class="primary" onClick={handleEditCopy}>
              Edit a copy
            </button>
          ) : null}
        </div>
      </header>

      {locked ? (
        <p class="brochure__banner no-print" role="status">
          You are viewing a shared tour. It is read-only, so your own saved tour
          is untouched — use <strong>Edit a copy</strong> to work on it.
        </p>
      ) : null}

      {warning !== "ok" && !status ? (
        <p
          class={`brochure__status brochure__status--${
            warning === "too-long" ? "error" : "warn"
          } no-print`}
          role="status"
        >
          {warning === "too-long"
            ? `This tour's share link is ${numberFormat.format(length)} characters — long enough that some chat apps will truncate it. Trim descriptions or image URLs, or share the JSON export.`
            : `This tour's share link is ${numberFormat.format(length)} characters, approaching the ~8,000 limit some chat apps impose.`}
        </p>
      ) : null}

      {status ? (
        <p
          class={`brochure__status brochure__status--${status.tone} no-print`}
          role="status"
        >
          {status.text}
        </p>
      ) : null}

      {manualLink ? (
        <label class="brochure__manual-link no-print">
          <span class="visually-hidden">Share link</span>
          <input
            type="text"
            readOnly
            value={manualLink}
            onFocus={(event) => (event.target as HTMLInputElement).select()}
          />
        </label>
      ) : null}

      <div class="brochure__sheet" ref={sheetRef}>
        <section class="brochure__page brochure__page--main">
          <div class="brochure__map-panel">
            <BrochureMap />
            <Legend />
            {/*
              The OSM credit is a licence term, not decoration (SPEC §6).
              Leaflet's own control carries it on screen, but Firefox dropped
              that control from the printed page, so the brochure prints its
              own copy of the same string — `OSM_ATTRIBUTION` is the constant
              Leaflet is configured with, a module literal rather than tour
              data, so the inner HTML is ours and not user input. The routing
              endpoints (ADR 0001) are credited the same way and for the same
              reason: their geometry is on the printed page.
            */}
            <p
              class="brochure__attribution"
              dangerouslySetInnerHTML={{
                __html: `${OSM_ATTRIBUTION} &middot; ${routingAttributionHtml}`,
              }}
            />
          </div>
          <ItineraryColumn />
        </section>

        <ItinerarySpill />
        <StopCards />
      </div>

      {staging ? (
        <div class="brochure__staging-overlay no-print" role="status">
          <p>Loading map tiles and images for the print…</p>
        </div>
      ) : null}
    </div>
  );
}
