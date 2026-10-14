# ADR 0002 — The URL hash is the sole source of truth

- **Status:** Accepted
- **Date:** 2026-10-14
- **Decided by:** Gavin (card t_0306d86f)
- **Supersedes:** the "localStorage as a convenience layer" position recorded on
  epic t_442984bb / the mhr-pattern spec, and SPEC D2's "writes it to
  localStorage as the working tour". mhr kept localStorage; this project drops
  it.

## Context

The app shipped with two places a tour could live: a `#t=` / `#view&t=` share
link in the URL hash, and a debounced `localStorage` autosave under
`tour-brochure-builder:tour`. Boot order was URL → localStorage → starter
template → blank.

Two stores meant two ways to be wrong, and the live site hit both:

- **A returning visitor saw a blank map.** Any visit that ended on an empty or
  half-cleared tour autosaved that emptiness. The next bare-URL visit restored
  it, *ahead of* the curated Chicago starter the starter-template work had just
  added. The starter was only ever shown to someone with no storage at all.
- **The address bar lied.** The URL was a snapshot taken when you last pressed
  *Copy share link*; the real state was in localStorage. Copying the URL out of
  the address bar after editing gave you a stale tour, and nothing on screen
  said so.
- **"Edit a copy" needed a confirmation dialog** (SPEC §5 item 8) purely to
  protect the one localStorage slot two tours were competing for.

## Decision

**All tour state lives in the URL hash. Nothing reads or writes
`window.localStorage`.**

1. Boot order is URL hash → curated starter template → blank. A bare URL
   therefore *always* opens the starter.
2. Every mutation re-encodes the tour into the hash — the same lz-string
   payload share links already used — written with `history.replaceState`,
   debounced ~300 ms.
3. Clearing the hash clears the work: the `hashchange` watcher resets the store
   to the starter template.
4. While the working tour still equals the starter byte for byte there is no
   diff, so the hash stays empty. The hash holds *the diff from the starter*,
   which is what makes rule 3 coherent rather than a thing that instantly
   undoes itself.
5. `#view` links stay read-only and suppress the writer, so a link you were
   sent is never rewritten under you.

`replaceState`, never `pushState`: at one history entry per edit a minute of
work would bury the Back button, and Back would walk the user through their own
keystrokes instead of leaving the app.

## Consequences

**Good**

- One store, so no precedence bugs and no stale-snapshot class of bug at all.
  The address bar is the save file; what you copy is what you have.
- The blank-map bug is fixed *by construction*, not by reordering a fallback
  chain — there is no longer a code path that can show a remembered empty tour.
- "Edit a copy" loses its confirmation dialog: the only thing a copy can
  overwrite is the hash currently on screen, which the user is looking at, can
  go Back to, and still holds wherever they were sent it. SPEC §5 item 8 is
  answered: no dialog.
- Sharing stops being a separate feature with its own moment ("press Copy
  link"). Every URL is a share link, always current.

**Bad, and accepted for now**

- **Closing the tab without copying the URL loses the work.** This is the real
  cost. Mitigations that exist today: the URL is always current (copy the
  address bar at any time), and JSON export/import is unchanged.
- **Long tours live in a long address bar.** The share-URL budget (SPEC §6,
  warn at 6k, ~8k ceiling) now governs the working URL too, not just links you
  deliberately send. The existing `shareUrlWarning` signal covers it, and the
  brochure surfaces it.
- **Private/incognito tabs behave identically to normal ones.** Previously an
  accident of storage availability; now the design.
- Browsers keep the hash out of `Referer` and out of server logs, so this is
  not a privacy regression — but the tour is in anything that captures URLs
  (history sync, chat clients that unfurl links).

**Reversible?** Easily. The writer is one `effect` in `src/tour/store.ts`
(`startUrlSync`); reinstating a convenience cache means adding a second
subscriber there and a step in `initStore`'s fallback chain, not unpicking the
design. The "for now" in Gavin's decision is load-bearing.

## Alternatives considered

- **Keep localStorage, fix only the boot order** (starter ahead of an *empty*
  stored tour). Smaller diff, but it keeps two stores, keeps the stale-URL
  problem, and the "is this stored tour empty enough to ignore?" heuristic is
  exactly the kind of rule that grows edge cases.
- **Keep localStorage as a crash-recovery cache only** (written, never read on
  normal boot). Preserves the no-data-loss property, but a store nothing reads
  is a store nobody tests, and it reintroduces the "my edits vanished" support
  question in a subtler form. Worth revisiting if tab-close data loss bites.
- **IndexedDB / a backend.** Out of scope: SPEC §6 forbids a view-time server
  dependency, and the whole artifact is a static page on GitHub Pages.
