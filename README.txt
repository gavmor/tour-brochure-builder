QA print evidence — PR #6 "Print the brochure full bleed at zero page margin"
Card t_e1df029f. Binaries + measurement scripts only; this branch is never meant to merge.

Produced from gavmor/tour-brochure-builder main @ a615607 (PR #6 merged as a64be00),
built with `pnpm install --frozen-lockfile && pnpm build && pnpm preview --port 4288`,
HeadlessChrome 145 (Skia/PDF m145).

Capture method (matches the dev's): stub `window.print`, click the real Print button so
the staging -> invalidateSize -> tile-settle -> spill-measure flow actually runs, then
`Page.printToPDF { preferCSSPageSize: true, printBackground: true, scale: 1,
landscape: true, margin*: 0 }` while the sheet is still staged.

NOTE: the tab must be FOREGROUND (`Page.bringToFront`) before clicking Print. In a hidden
tab `requestAnimationFrame` is frozen, so `nextPaint()` inside `printBrochure` never
resolves and the flow hangs staged forever with `window.print()` never called.

FILES
  starter-tour-2pages.pdf             6-stop starter Chicago tour. 2 pages. PASSES everything.
  28stop-tour-4pages.pdf              28-stop tour: sheet + spill + 2 card pages. Page 4 FAILS.
  60stop-tour-5pages.pdf              60-stop tour: sheet + spill + 3 card pages. Pages 4,5 FAIL.
  28stop-page1-110dpi.png             page 1 raster — full bleed, folds, tiles, credit, legend.
  28stop-page4-top-edge-300dpi.png    page 4 top 1.4in — cards flush to the trim, zero inset.
  qa-make-tour.mjs                    builds the oversized `#view&t=` share URL used above.
  measure_pdf.py                      per-page size + per-edge white-band + column-boundary scan.
  row_segments.py                     contiguous painted x-segments on one raster row.
  zoom_edges.py                       per-row ink profile at the top/bottom of a page.
  tile_check.py                       largest uniform-colour block in the map box (grey-tile hunt).

All four scripts are stdlib-only; they parse `pdftoppm`'s binary P6 PPM directly.
  pdftoppm -r 150 <pdf> <prefix>
  python3 measure_pdf.py <pdf> 150

HEADLINE NUMBERS (28stop-tour-4pages.pdf, rasterised at 150 dpi)
  every page            792 x 612 pt = 11.0000in x 8.5000in landscape
  page 1 all-white band top/bottom/left/right = 0px / 0px / 0px / 0px
  page 1 map panel      0 -> 7.3333in, full 8.5in height; itinerary 7.3333 -> 11.0000in
  page 1 fold pitch     grid-template-columns 704px / 352px @96dpi = 3.6667in panels
  page 1 map box        longest uniform run = Lake Michigan blue (170,211,223); no grey tile
  page 2 (spill)        inset 0.2600 / 0.2200 / 0.2200in (top/left/right)   OK
  page 3 (cards 1/2)    inset 0.2600 / 0.2133 / 0.2133in                     OK
  page 4 (cards 2/2)    inset 0.0000 / 0.2133 / 0.2133in                     DEFECT
                        card hairline border (224,217,204) painted on raster row y=0,
                        three 3.28in segments; first body text 0.133in from the trim.
