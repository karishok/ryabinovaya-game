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

## Living warehouse UI

The mobile warehouse is rendered as a layered scene: an optimized WebP
environment, semantic HTML interaction layers, and a pure `scene-view.js`
mapper that turns existing game state into visual modes. Animations represent
reducer state only and are disabled through the operating system's
reduced-motion preference.

Reference screenshot: `docs/screenshots/living-warehouse-mobile.png`.
