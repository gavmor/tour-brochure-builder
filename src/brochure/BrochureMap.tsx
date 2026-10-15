/**
 * The brochure's map: the same geography as the editor, with nothing you can
 * edit (SPEC D2 — a shared link has no editing affordances at all).
 *
 * It deliberately reuses the editor's `createTileLayer`, `stopIcon` and
 * `routeLatLngs` rather than re-deriving any of them: if the two maps drew
 * different lines, or the brochure shipped its own copy of the OSM attribution
 * string, the printed artifact would stop matching what the author edited.
 */

import * as L from "leaflet";
import { useEffect, useRef } from "preact/hooks";
import {
  createTileLayer,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  fixLeafletDefaultIcons,
} from "../editor/leafletSetup";
import { badgeSignature, safeColor, stopIcon } from "../editor/markers";
import { routeLatLngs } from "../editor/shape";
import { hiddenRouteIds } from "../editor/uiState";
import { findStop, selectedStopId, type Tour, tour } from "../tour";
import { tourPoints } from "./content";
import {
  isPrintFlowActive,
  printPrep,
  type SettleOutcome,
  setMapPrintPrepare,
  whenTilesSettled,
} from "./printing";

function fitToTour(map: L.Map, current: Tour): void {
  const points = tourPoints(current);
  if (points.length === 0) {
    map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    return;
  }
  if (points.length === 1) {
    map.setView(points[0], Math.max(map.getZoom(), 15));
    return;
  }
  map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 16 });
}

/**
 * Known gap, Firefox only: in Firefox's printed output the tile raster covers
 * a smaller rectangle than the map box, leaving Leaflet's grey container
 * showing around it. Everything else prints correctly there (geometry, routes,
 * markers, legend, credit, itinerary, cards), and Chrome prints the map edge
 * to edge. Flattening Leaflet's pane transforms before printing was tried and
 * did not change it; the next thing to try is rasterising the map to a canvas
 * for print (leaflet-image or similar) rather than printing live tiles.
 */

export function BrochureMap() {
  const hostRef = useRef<HTMLElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef(
    new Map<string, { marker: L.Marker; sig: string }>(),
  );
  const linesRef = useRef(new Map<string, L.Polyline>());
  const fittedRef = useRef<string | null>(null);
  const skipPanRef = useRef(false);

  const current = tour.value;
  const selected = selectedStopId.value;
  const hidden = hiddenRouteIds.value;
  const staging = printPrep.value;

  // ------------------------------------------------------------------ mount
  useEffect(() => {
    fixLeafletDefaultIcons();
    const host = hostRef.current;
    if (!host) return;

    const map = L.map(host, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      // A brochure is a document: scrolling the page past the map should not
      // zoom it out from under the reader.
      scrollWheelZoom: false,
    });
    const tiles = createTileLayer().addTo(map);
    mapRef.current = map;
    tileLayerRef.current = tiles;

    // Leaflet measures its container once. The brochure's map box changes size
    // at every breakpoint and again when the sheet switches to print geometry.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(host);

    const markers = markersRef.current;
    const lines = linesRef.current;
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      markers.clear();
      lines.clear();
    };
  }, []);

  // ------------------------------------------------------- print readiness
  useEffect(() => {
    /**
     * Called by the Print button *before* `window.print()`. The sheet is
     * already in print geometry by now (the chrome set `printPrep` and waited
     * a frame), so this re-measures the container, refits the stops into the
     * new shape and waits for that box's tiles — the fix for SPEC §6's
     * half-grey map.
     *
     * At full bleed the print box is the whole left two-thirds of the sheet
     * (7.333in × 8.5in, ~14 % more area than the old margined box), so the
     * tile wait is given a little more room before it gives up and warns.
     */
    const prepare = async (): Promise<SettleOutcome> => {
      const map = mapRef.current;
      if (!map) return "ready";
      map.invalidateSize({ animate: false });
      fitToTour(map, tour.peek());
      const settled = await whenTilesSettled(tileLayerRef.current, {
        timeout: 10000,
      });
      return settled;
    };
    setMapPrintPrepare(prepare);
    return () => setMapPrintPrepare(null);
  }, []);

  // Ctrl+P bypasses our button. We cannot hold the print back to load tiles —
  // `beforeprint` is synchronous — but we can at least hand the browser a map
  // laid out for the paper, with every route drawn, instead of a screen-shaped
  // one. The Print button remains the path that guarantees tiles.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onBefore = () => {
      if (isPrintFlowActive()) return; // the Print button already staged this
      printPrep.value = true;
      const map = mapRef.current;
      if (!map) return;
      map.invalidateSize({ animate: false });
      fitToTour(map, tour.peek());
    };
    const onAfter = () => {
      if (isPrintFlowActive()) return; // that flow unstages when it is done
      printPrep.value = false;
    };
    window.addEventListener("beforeprint", onBefore);
    window.addEventListener("afterprint", onAfter);
    return () => {
      window.removeEventListener("beforeprint", onBefore);
      window.removeEventListener("afterprint", onAfter);
    };
  }, []);

  // Coming back from the print geometry: re-measure and refit the screen box.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize({ animate: false });
    fitToTour(map, tour.peek());
  }, [staging]);

  // -------------------------------------------------------------- polylines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const lines = linesRef.current;
    const seen = new Set<string>();

    for (const route of current.routes) {
      seen.add(route.id);
      const latlngs = routeLatLngs(route);
      // Hiding a route is a screen-only reading aid; the printed brochure
      // always carries every route (see the legend's note).
      const visible =
        (staging || !hidden.includes(route.id)) && latlngs.length >= 2;
      let line = lines.get(route.id);
      if (!line) {
        line = L.polyline(latlngs, { interactive: false });
        lines.set(route.id, line);
      }
      line.setLatLngs(latlngs);
      line.setStyle({
        color: safeColor(route.color),
        weight: 4,
        opacity: 0.9,
      });
      if (visible && !map.hasLayer(line)) line.addTo(map);
      if (!visible && map.hasLayer(line)) line.remove();
    }

    for (const [id, line] of lines) {
      if (seen.has(id)) continue;
      line.remove();
      lines.delete(id);
    }
  }, [current, hidden, staging]);

  // ---------------------------------------------------------------- markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const seen = new Set<string>();

    for (const route of current.routes) {
      const visible = staging || !hidden.includes(route.id);
      route.stops.forEach((stop, index) => {
        seen.add(stop.id);
        const badge = {
          label: index + 1,
          color: route.color,
          selected: stop.id === selected,
        };
        const sig = [
          badgeSignature(badge),
          stop.lat,
          stop.lng,
          stop.title,
        ].join("|");

        let entry = markers.get(stop.id);
        if (!entry) {
          const marker = L.marker([stop.lat, stop.lng], {
            draggable: false,
            keyboard: true,
            riseOnHover: true,
            alt: stop.title,
            icon: stopIcon(badge),
          });
          marker.on("click", () => {
            skipPanRef.current = true;
            selectedStopId.value = stop.id;
          });
          entry = { marker, sig: "" };
          markers.set(stop.id, entry);
        }

        if (entry.sig !== sig) {
          entry.marker.setLatLng([stop.lat, stop.lng]);
          entry.marker.setIcon(stopIcon(badge));
          entry.sig = sig;
        }
        if (visible && !map.hasLayer(entry.marker)) entry.marker.addTo(map);
        if (!visible && map.hasLayer(entry.marker)) entry.marker.remove();

        // `alt` is ignored for divIcons, so spell the label out for assistive
        // tech and give everyone else a tooltip.
        const element = entry.marker.getElement();
        if (element) {
          element.setAttribute("role", "button");
          element.setAttribute(
            "aria-label",
            `Stop ${badge.label} of ${route.name}: ${stop.title}`,
          );
          element.title = stop.title;
        }
      });
    }

    for (const [id, entry] of markers) {
      if (seen.has(id)) continue;
      entry.marker.remove();
      markers.delete(id);
    }
  }, [current, selected, hidden, staging]);

  // ------------------------------------------------------------ fit on load
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (fittedRef.current === current.id) return;
    fittedRef.current = current.id;
    fitToTour(map, current);
  }, [current]);

  // ------------------------------------------- pan to the selected stop
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selected) return;
    if (skipPanRef.current) {
      skipPanRef.current = false;
      return;
    }
    const found = findStop(tour.peek(), selected);
    if (!found) return;
    map.setView([found.stop.lat, found.stop.lng], Math.max(map.getZoom(), 15), {
      animate: true,
    });
  }, [selected]);

  return (
    // The class here is static: Leaflet writes its own classes onto this
    // element and a Preact class update would wipe them (editor's hard-won
    // lesson). State modifiers go on an ancestor.
    <section
      ref={hostRef}
      class="brochure-map"
      aria-label="Tour map. Numbered markers mark each stop."
    />
  );
}
