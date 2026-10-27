# GSC Maestro on Glama: public metrics utilities

This is a **metrics-only hosted demo**, not the full desktop GSC Maestro MCP server. The container contains no OAuth accounts, Google Search Console, Bing Webmaster, Yandex, local SQLite, client properties or browser sessions.

The four real MCP tools are:
- maestro_public_capabilities
- maestro_calculate_ctr
- maestro_compare_periods
- maestro_explain_search_metrics

They operate only on numeric aggregates explicitly provided in the current request; no external APIs are called or values stored. Do not submit private queries or account identifiers to hosted providers.

Full search analytics still requires your authorized local GSC Maestro installation.

## Build and verify

```bash
docker build -t gsc-maestro:glama-public .
npm ci --prefix glama/gsc
node --test glama/gsc/container-smoke.test.mjs
```

Tests start a real MCP container with no network, read-only root filesystem, no host mounts, all capabilities dropped, and no-new-privileges.

## Glama build and release

On your claimed GSC Maestro Glama listing, open the Dockerfile admin page, select repository root and Dockerfile, and build with **no credentials or environment secrets**. Verify the tool catalog contains only the four metrics utilities. Publish only if the hosted edition is accurately labelled as a **public metrics-only demo**; the desktop product does not become a cloud-connected Search Console service.
