/**
 * Public surface of the "Add sites near a location" feature.
 *
 * Split the way the original spike was: `osm.ts` is pure (geometry, query
 * building, ranking, mapping to the app's Stop model), `net.ts` owns fetch,
 * timeouts, cancellation, caching and mirrors, and `curated.ts` is the offline
 * fallback. The editor imports from here only.
 */

export * from "./curated";
export * from "./net";
export * from "./osm";
