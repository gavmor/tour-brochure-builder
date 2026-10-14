import { readOnly, stopCount, tour } from "./tour";

export function App() {
  return (
    <div class="app">
      <h1>Tour Brochure Builder</h1>
      <p>
        Interactive tour brochure authoring with Leaflet &amp; OpenStreetMap.
      </p>
      {/* Placeholder store readout — the editor and brochure cards replace this. */}
      <p class="store-readout">
        <strong>{tour.value.title}</strong> · {tour.value.routes.length}{" "}
        route(s) · {stopCount.value} stop(s) ·{" "}
        {readOnly.value ? "read-only share link" : "editing"}
      </p>
    </div>
  );
}
