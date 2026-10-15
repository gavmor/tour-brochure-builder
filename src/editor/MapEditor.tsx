/**
 * The Leaflet map, driven directly through `useRef`/`useEffect`.
 *
 * react-leaflet is not Preact-compatible without the compat alias, and the
 * direct API is the honest one here anyway: the store is the source of truth
 * and the effects below reconcile Leaflet layers against it, keyed by id, so a
 * keystroke in the title field does not tear down every marker on the map.
 */

import * as L from "leaflet";
import { useEffect, useRef } from "preact/hooks";
import {
  activeRoute,
  addStop,
  findStop,
  moveStop,
  readOnly,
  selectedStopId,
  type Tour,
  tour,
  updateRoute,
} from "../tour";
import {
  createTileLayer,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  fixLeafletDefaultIcons,
} from "./leafletSetup";
import { badgeSignature, safeColor, stopIcon } from "./markers";
import {
  APPROXIMATE_DASH,
  approximateTooltip,
  routeDrawBounds,
  routeGeometry,
  routingAttributionHtml,
  syncRouteGeometry,
} from "./routeGeometry";
import { type LatLng, routeLatLngs } from "./shape";
import {
  addMode,
  fitRequest,
  hiddenRouteIds,
  nearbyCenter,
  nearbyPinMode,
  nearbyProposals,
  round6,
  shapeMode,
} from "./uiState";

/** Every point the tour draws, for bounds fitting — road geometry included. */
function tourPoints(current: Tour): LatLng[] {
  return current.routes.flatMap(routeDrawBounds);
}

function fitToTour(map: L.Map, current: Tour): void {
  const points = tourPoints(current);
  if (points.length === 0) return;
  if (points.length === 1) {
    map.setView(points[0], Math.max(map.getZoom(), 15));
    return;
  }
  map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 16 });
}

export function MapEditor() {
  const hostRef = useRef<HTMLElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef(
    new Map<string, { marker: L.Marker; sig: string }>(),
  );
  const linesRef = useRef(new Map<string, L.Polyline>());
  const viaLayerRef = useRef<L.LayerGroup | null>(null);
  /** The "search near here" centre, drawn while the POI dialog is working. */
  const centreMarkerRef = useRef<L.CircleMarker | null>(null);
  /** Provisional markers for the proposals currently on the checklist. */
  const proposalLayerRef = useRef<L.LayerGroup | null>(null);
  /** Tour id whose bounds we already fitted — refit on load, not on every edit. */
  const fittedRef = useRef<string | null>(null);
  /** Set when the map itself caused the selection, so we do not pan under the user. */
  const skipPanRef = useRef(false);

  const current = tour.value;
  const selected = selectedStopId.value;
  const hidden = hiddenRouteIds.value;
  const armed = addMode.value;
  const pinning = nearbyPinMode.value;
  const searchCentre = nearbyCenter.value;
  const proposals = nearbyProposals.value;
  const shaping = shapeMode.value;
  const locked = readOnly.value;
  const activeId = activeRoute.value?.id ?? null;
  const fitNonce = fitRequest.value;
  const geometry = routeGeometry.value;

  // ------------------------------------------------------------------ mount
  useEffect(() => {
    fixLeafletDefaultIcons();
    const host = hostRef.current;
    if (!host) return;

    const map = L.map(host, {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
    });
    createTileLayer().addTo(map);
    // The tile layer carries the OSM credit; the routing endpoints are a
    // separate obligation and a separate line in the control (ADR 0001 /
    // FOSSGIS usage policy).
    map.attributionControl?.addAttribution(routingAttributionHtml);
    viaLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    // Leaflet measures its container once, at construction. If the editor
    // mounts before layout settles (or the sidebar resizes), the map renders
    // as a grey band until something invalidates it.
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(host);

    const markers = markersRef.current;
    const lines = linesRef.current;
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      viaLayerRef.current = null;
      centreMarkerRef.current = null;
      proposalLayerRef.current = null;
      markers.clear();
      lines.clear();
    };
  }, []);

  // ------------------------------------------------ click: add stop / deselect
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const onClick = (event: L.LeafletMouseEvent) => {
      // Choosing a search centre for "Add sites near a location" wins over
      // adding a stop: it is the mode the user armed most recently, and the
      // two are mutually exclusive (see `openNearby`).
      if (!locked && pinning) {
        nearbyPinMode.value = false;
        nearbyCenter.value = {
          lat: round6(event.latlng.lat),
          lng: round6(event.latlng.lng),
        };
        return;
      }
      if (locked || !armed) {
        selectedStopId.value = null;
        return;
      }
      addStopAt(event.latlng.lat, event.latlng.lng);
    };

    const addStopAt = (lat: number, lng: number) => {
      const live = tour.peek();
      const route =
        live.routes.find((r) => r.id === activeId) ?? live.routes[0];
      const stop = addStop(
        {
          lat: round6(lat),
          lng: round6(lng),
          title: `Stop ${(route?.stops.length ?? 0) + 1}`,
        },
        route?.id,
      );
      if (stop) {
        skipPanRef.current = true;
        selectedStopId.value = stop.id;
      }
    };

    // Keyboard equivalent of click-to-add: the map container is focusable, so
    // Enter while armed drops a stop at the centre of the view.
    const onKeyDown = (event: KeyboardEvent) => {
      if (locked || !armed || event.key !== "Enter") return;
      event.preventDefault();
      const centre = map.getCenter();
      addStopAt(centre.lat, centre.lng);
    };

    map.on("click", onClick);
    map.getContainer().addEventListener("keydown", onKeyDown);
    return () => {
      map.off("click", onClick);
      map.getContainer().removeEventListener("keydown", onKeyDown);
    };
  }, [armed, pinning, locked, activeId]);

  // ------------------------------------------------- the POI search centre
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const existing = centreMarkerRef.current;
    if (!searchCentre) {
      existing?.remove();
      centreMarkerRef.current = null;
      return;
    }
    const position: [number, number] = [searchCentre.lat, searchCentre.lng];
    if (existing) {
      existing.setLatLng(position);
      return;
    }
    const marker = L.circleMarker(position, {
      radius: 10,
      color: "#1F3A5F",
      weight: 2,
      fillColor: "#1F3A5F",
      fillOpacity: 0.25,
      interactive: false,
      className: "search-centre",
    });
    marker.addTo(map);
    centreMarkerRef.current = marker;
  }, [searchCentre]);

  // ------------------------------------------ provisional POI proposals (§2)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let layer = proposalLayerRef.current;
    if (!layer) {
      layer = L.layerGroup().addTo(map);
      proposalLayerRef.current = layer;
    }
    layer.clearLayers();
    for (const proposal of proposals) {
      L.circleMarker([proposal.lat, proposal.lng], {
        radius: 7,
        color: "#1F3A5F",
        weight: 2,
        // Ticked proposals read as "will be added"; unticked ones as "offered".
        fillColor: proposal.chosen ? "#1F3A5F" : "#ffffff",
        fillOpacity: proposal.chosen ? 0.85 : 0.6,
        interactive: true,
        className: "poi-proposal",
      })
        .bindTooltip(proposal.title, { direction: "top" })
        .addTo(layer);
    }
  }, [proposals]);

  // ----------------------------------------------------- road geometry
  // Ask the routing service for road geometry whenever the *request* changes
  // (stops added, removed, reordered or moved; profile switched). Renames and
  // recolors do not reach the network — `syncRouteGeometry` compares cache
  // keys, and the service debounces what is left.
  useEffect(() => {
    syncRouteGeometry(current);
  }, [current]);

  // -------------------------------------------------------------- polylines
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const lines = linesRef.current;
    const seen = new Set<string>();

    for (const route of current.routes) {
      seen.add(route.id);
      // The straight line is the placeholder and the fallback: it is drawn
      // the moment a route exists, and road geometry replaces it only once
      // the router answers. A route is never blank.
      const straight = routeLatLngs(route);
      const geo = geometry[route.id];
      const latlngs = geo?.coords ?? straight;
      const approximate = geo?.approximate ?? false;
      const visible = !hidden.includes(route.id) && straight.length >= 2;
      const isActive = route.id === activeId;
      let line = lines.get(route.id);

      if (!line) {
        line = L.polyline(latlngs, {
          color: safeColor(route.color),
          // Vector clicks bubble to the map by default, which would clear the
          // selection or drop a stop on the line.
          bubblingMouseEvents: false,
        });
        line.on("click", (event: L.LeafletMouseEvent) => {
          const originalEvent = event.originalEvent;
          if (
            shapeMode.peek() &&
            !readOnly.peek() &&
            originalEvent.shiftKey &&
            activeRoute.peek()?.id === route.id
          ) {
            const live = tour.peek().routes.find((r) => r.id === route.id);
            if (!live) return;
            updateRoute(route.id, {
              via: [
                ...(live.via ?? []),
                [round6(event.latlng.lat), round6(event.latlng.lng)],
              ],
            });
          }
        });
        lines.set(route.id, line);
      }

      line.setLatLngs(latlngs);
      line.setStyle({
        color: safeColor(route.color),
        weight: isActive ? 5 : 3,
        opacity: isActive ? 0.95 : 0.6,
        // Leaflet removes the attribute outright on a falsy `dashArray`, so
        // this both sets and clears the approximate styling.
        dashArray: approximate ? APPROXIMATE_DASH : undefined,
      });
      // Say *why* the line is straight. Leaflet tooltips are pointer-events
      // none, so this does not get in the way of shift-click shaping.
      if (approximate) {
        line.bindTooltip(approximateTooltip(geo?.reason), {
          sticky: true,
          className: "route-tooltip--approximate",
        });
      } else {
        line.unbindTooltip();
      }
      if (visible && !map.hasLayer(line)) line.addTo(map);
      if (!visible && map.hasLayer(line)) line.remove();
    }

    for (const [id, line] of lines) {
      if (seen.has(id)) continue;
      line.remove();
      lines.delete(id);
    }
  }, [current, hidden, activeId, geometry]);

  // ---------------------------------------------------------------- markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const seen = new Set<string>();

    for (const route of current.routes) {
      const visible = !hidden.includes(route.id);
      const muted = route.id !== activeId;
      route.stops.forEach((stop, index) => {
        seen.add(stop.id);
        const badge = {
          label: index + 1,
          color: route.color,
          selected: stop.id === selected,
          muted,
        };
        const sig = [
          badgeSignature(badge),
          stop.lat,
          stop.lng,
          stop.title,
          locked ? "ro" : "rw",
        ].join("|");

        let entry = markers.get(stop.id);
        if (!entry) {
          const marker = L.marker([stop.lat, stop.lng], {
            draggable: !locked,
            autoPan: true,
            riseOnHover: true,
            keyboard: true,
            alt: stop.title,
            icon: stopIcon(badge),
          });
          marker.on("click", () => {
            skipPanRef.current = true;
            selectedStopId.value = stop.id;
          });
          marker.on("dragend", () => {
            const { lat, lng } = marker.getLatLng();
            skipPanRef.current = true;
            selectedStopId.value = stop.id;
            moveStop(stop.id, round6(lat), round6(lng));
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
        if (entry.marker.dragging) {
          if (locked) entry.marker.dragging.disable();
          else entry.marker.dragging.enable();
        }
        // `alt` only applies to image icons; a divIcon needs the label spelled
        // out for screen readers and a tooltip for everyone else.
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
  }, [current, selected, hidden, activeId, locked]);

  // ----------------------------------------------------- via (shape) handles
  useEffect(() => {
    const layer = viaLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    const route = current.routes.find((r) => r.id === activeId);
    if (!shaping || locked || !route) return;

    (route.via ?? []).forEach((point, index) => {
      const handle = L.marker([point[0], point[1]], {
        draggable: true,
        keyboard: false,
        alt: `Shape point ${index + 1} of ${route.name}`,
        icon: L.divIcon({
          className: "via-marker",
          html: `<span class="via-handle" style="background:${safeColor(
            route.color,
          )}"></span>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      });
      /** Replace the whole array: `via` has no stable id to patch by. */
      const writeVia = (next: [number, number][]) => {
        updateRoute(
          route.id,
          next.length > 0 ? { via: next } : { via: undefined },
        );
      };
      handle.on("dragend", () => {
        const live = tour.peek().routes.find((r) => r.id === route.id);
        if (!live?.via) return;
        const { lat, lng } = handle.getLatLng();
        const next = live.via.map((p, i) =>
          i === index ? ([round6(lat), round6(lng)] as [number, number]) : p,
        );
        writeVia(next);
      });
      // Shift-click to remove, so a stray click after a drag cannot delete it.
      handle.on("click", (event: L.LeafletMouseEvent) => {
        if (!event.originalEvent.shiftKey) return;
        const live = tour.peek().routes.find((r) => r.id === route.id);
        if (!live?.via) return;
        writeVia(live.via.filter((_, i) => i !== index));
      });
      handle.bindTooltip("Drag to bend the route · Shift-click to remove", {
        direction: "top",
      });
      handle.addTo(layer);
    });
  }, [current, activeId, shaping, locked]);

  // ------------------------------------------------------------ fit on load
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // Fit once per tour (on load / import / new), not on every edit — refitting
    // after each added stop would yank the view out from under the author.
    if (fittedRef.current === current.id) return;
    fittedRef.current = current.id;
    fitToTour(map, current);
  }, [current]);

  // --------------------------------------------- explicit "Fit to stops"
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fitNonce === 0) return;
    fitToTour(map, tour.peek());
  }, [fitNonce]);

  // ---------------------------------------------- pan to the selected stop
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
    <div
      class={`map-pane${armed && !locked ? " map-pane--adding" : ""}${
        pinning && !locked ? " map-pane--picking" : ""
      }`}
    >
      {/*
        The class on the Leaflet host is static on purpose. Leaflet adds its
        own classes (`leaflet-container` and friends, which carry the layout
        and touch-action rules) to this element, and a Preact class update
        would overwrite them — so state modifiers go on the wrapper instead.
      */}
      <section
        ref={hostRef}
        class="map-pane__canvas"
        aria-label="Tour map. Drag numbered markers to move stops."
      />
      {armed && !locked ? (
        <p class="map-pane__hint" role="status">
          Click the map to add a stop (or focus the map and press Enter to add
          one at the centre). Press <kbd>Esc</kbd> to stop adding.
        </p>
      ) : null}
      {pinning && !locked ? (
        <p class="map-pane__hint map-pane__hint--picking" role="status">
          Click the map to choose the centre of the &ldquo;sites near a
          location&rdquo; search.
        </p>
      ) : null}
      {shaping && !locked ? (
        <p class="map-pane__hint map-pane__hint--shape" role="status">
          Shape points: <kbd>Shift</kbd>-click the active route&rsquo;s line to
          bend it, drag a handle to move it, <kbd>Shift</kbd>-click a handle to
          remove it.
        </p>
      ) : null}
    </div>
  );
}
