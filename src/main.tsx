import { render } from "preact";
import { App } from "./App";
import { starterTour } from "./data/starterTour";
import { initStore, saveNow } from "./tour";
import "leaflet/dist/leaflet.css";
import "./index.css";

// Load order: a `#t=` share link wins over localStorage, which wins over the
// curated starter template, which wins over a blank tour. A first visit with
// no URL state and nothing saved opens the populated starter tour (no network
// calls beyond map tiles). Autosave starts here and runs for the life of the
// page (it is suppressed while a `#view` link is open, so a shared tour can
// never overwrite the viewer's own working tour).
const boot = initStore({ fallback: starterTour });
if (boot.errors.length > 0) {
  console.warn("[tour] could not load a tour:", boot.errors.join(" "));
}
if (boot.warnings.length > 0) {
  console.info("[tour] repaired on load:", boot.warnings.join(" "));
}

// Autosave is debounced, so flush on the way out.
window.addEventListener("beforeunload", () => {
  saveNow();
});

render(<App />, document.getElementById("app")!);
