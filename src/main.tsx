import { render } from "preact";
import { App } from "./App";
import { starterTour } from "./data/starterTour";
import { initStore } from "./tour";
import "leaflet/dist/leaflet.css";
import "./index.css";

// The URL hash is the only place a tour lives — there is no localStorage, by
// decision (docs/adr/0002-url-sole-source-of-truth.md). Load order: a `#t=` /
// `#view&t=` hash wins over the curated starter template, which wins over a
// blank tour. So a bare URL *always* opens the populated starter, and clearing
// the hash throws the work away and returns to it.
//
// `initStore` also starts the URL writer (every mutation is re-encoded into
// the hash with `history.replaceState`, suppressed while a `#view` link is
// open) and the hash watcher. Nothing to flush on unload: the address bar is
// already the save file.
const boot = initStore({ fallback: starterTour });
if (boot.errors.length > 0) {
  console.warn("[tour] could not load a tour:", boot.errors.join(" "));
}
if (boot.warnings.length > 0) {
  console.info("[tour] repaired on load:", boot.warnings.join(" "));
}

render(<App />, document.getElementById("app")!);
