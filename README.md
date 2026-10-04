# Philippine GeoBase

**Status: Beta — experimental draft**

Philippine GeoBase is an open-source map application prototype for exploring Philippine administrative boundaries, from regions and provinces to cities, municipalities, and barangays.

The main unresolved issue is the barangay polygons: coverage and geometry are still being checked, and some polygons may be missing, simplified, or inaccurate. Barangay rendering and navigation are under active development. This is not an official government mapping service; do not use it as the sole source for decisions that require authoritative boundaries.

## Run locally

Requirements: Node.js and npm.

```sh
npm install
npm run dev
```

Create a production build with:

```sh
npm run build
```

## Data and attribution

The app combines boundary geometry with PSGC reference lookups. These are separate sources:

- **Boundary GeoJSON:** [Barangay Boundaries Repository](https://github.com/bendlikeabamboo/barangay-boundaries-repository), created by Manuel Balmeo. This app currently requests the repository's `2023-10-24` snapshot. The repository describes its boundaries as converted from NAMRIA administrative-boundary shapefiles and enriched with PSA PSGC records. Its processing code is MIT-licensed; retain attribution to the original data sources.
- **PSGC lookup API:** [PSGC Cloud](https://psgc.cloud/), developed by John Joshua A. Lipio. The app uses it for geographic reference/classification lookups. It is a community-provided service, not the official PSA API; verify important information against official records and follow the service's [terms](https://psgc.cloud/terms).
- **Original records:** [Philippine Statistics Authority (PSA) PSGC](https://psa.gov.ph/classification/psgc/) and [NAMRIA](https://namria.gov.ph/).

The app's MIT license applies to this project's original application code. It does not relicense the boundary data, PSGC Cloud service, or third-party dependencies. Their source terms and attribution requirements remain separate.

## Credits

Thank you to Manuel Balmeo for the boundary GeoJSON processing and publication, and John Joshua A. Lipio for PSGC Cloud. The underlying administrative records are attributed to PSA and NAMRIA. Their work makes this prototype possible.

## License

Original application code in this repository is available under the MIT License; see [LICENSE](LICENSE). External data, APIs, and dependencies are governed by their respective terms.

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
