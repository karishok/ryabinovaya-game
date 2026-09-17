# Ryabinovaya

Ryabinovaya is a mobile-first warehouse strategy prototype. Manage a short
distribution-center shift by sorting goods into storage zones, assembling
pallets for dark stores, loading vehicles, and planning delivery routes. Your
shift ends with a report on deliveries, timing, precision (how much of the
loaded cargo weight matched an actual order versus dead weight), spoilage,
and profit.

## Open the prototype

Open `index.html` directly in a web browser. The prototype is built with
vanilla HTML, CSS, and JavaScript; there is no build step or package install.

## Run the tests

From the project directory, run:

```sh
node --test tests/*.test.js
```

The tests use Node.js's built-in test runner and require no additional
dependencies.

## TSD warehouse UI

Tasks arrive on a physical handheld TSD. Accepting a task returns the device
to the edge of the scene, leaving the rack signs, pallet, AGV, and truck as
direct warehouse controls. Briefing, pallet building, vehicle routing,
feedback, and reports reuse the same TSD shell; decorative layers never own
pointer events. Reduced-motion preferences disable repeated movement.

Reference screenshot: `docs/screenshots/living-warehouse-mobile.png`
