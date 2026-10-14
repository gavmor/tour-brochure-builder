/**
 * Leaflet bootstrap shared by the editor (and, later, the brochure view).
 *
 * Two things live here because getting either wrong is a silent breakage:
 * the default-icon URL fix under Vite, and the OSM tile layer options that
 * the tile usage policy obliges us to ship.
 */

import * as L from "leaflet";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";

/** OSM raster tiles. No other basemap is wired up (SPEC §6). */
export const OSM_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

/**
 * Required attribution. The rendered text reads
 * "© OpenStreetMap contributors" — it is a licence term, not decoration,
 * so it must stay visible on screen and in print.
 */
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';

/** Tile policy: 19 is the deepest zoom the standard OSM layer serves. */
export const OSM_MAX_ZOOM = 19;

/** Chicago, so an empty tour opens somewhere recognisable (the reference city). */
export const DEFAULT_CENTER: [number, number] = [41.8827, -87.6233];
export const DEFAULT_ZOOM = 13;

let iconsPatched = false;

/**
 * Leaflet guesses its marker image URLs from the path of the script that
 * loaded it. Under Vite there is no such script, so the stock pin and its
 * shadow 404 and markers render blank. Point the default icon at the hashed
 * assets Vite emits instead.
 *
 * The editor draws numbered `divIcon`s, but anything that falls back to
 * `L.Icon.Default` (including the brochure view) needs this.
 */
export function fixLeafletDefaultIcons(): void {
  if (iconsPatched) return;
  iconsPatched = true;
  // `_getIconUrl` is the private path-guessing hook; drop it before merging.
  delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })
    ._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2x,
    iconUrl: markerIcon,
    shadowUrl: markerShadow,
  });
}

/**
 * The one OSM tile layer. `updateWhenIdle: false` keeps panning smooth without
 * prefetching anything: Leaflet only ever requests tiles for the current
 * viewport plus the default one-tile buffer, which is what the usage policy
 * asks for (no bulk or speculative downloading).
 */
export function createTileLayer(): L.TileLayer {
  return L.tileLayer(OSM_TILE_URL, {
    maxZoom: OSM_MAX_ZOOM,
    attribution: OSM_ATTRIBUTION,
    // Default (2); stated explicitly so nobody "optimises" it into a prefetch.
    keepBuffer: 2,
  });
}
