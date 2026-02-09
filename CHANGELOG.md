# 1.0.0 (2026-02-09)


### Features

* implement permission extraction, tracing, and CSV export ([ca0231f](https://github.com/akj/permafrost/commit/ca0231f543801de123b05cddbbef7b18d2a70a1d))
* org-aware default database path (~/.permafrost/<username>/permissions.db) ([688bdb7](https://github.com/akj/permafrost/commit/688bdb74d4878f4ad57e9beb8bf01df9ef74259e))
* replace CLI subprocess with SDR library for metadata retrieval ([6c5bbdf](https://github.com/akj/permafrost/commit/6c5bbdfa02f318d835a6bb43280b291d0400af6f))
* add Phase 2 analysis, reporting, and PSG recommendation engine ([d874ef7](https://github.com/akj/permafrost/commit/d874ef7c5e9ed2212060dcdd1448c0ec79782cec))
* add migration foundation — diff, plan, transform, export ([3a21d8b](https://github.com/akj/permafrost/commit/3a21d8b783fc0b8b86ce53c46eb5b2f7fc97d19b))
* add ESLint v9 with stylistic plugin and enforce conventions ([4e9df83](https://github.com/akj/permafrost/commit/4e9df83df564abf63234b7e9e729fe8a8104290d))


### Bug Fixes

* resolve org aliases to usernames before AuthInfo.create ([5c19e2a](https://github.com/akj/permafrost/commit/5c19e2a14987b624427170ae5cffe38a027fb731))
