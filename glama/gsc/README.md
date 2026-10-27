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

## Verified hosted release

**v0.1.0 was published on Glama on October 27, 2026**, using the restricted `glama/gsc/server.mjs` entry point. Glama's container build test successfully started the MCP server and identified exactly the four public metrics utilities. The published release's average Tool Definition Quality Score was **4.0/5** across those four tools.

[Public Glama listing](https://glama.ai/mcp/servers/haseebgb92/GSC-Maestro) · [Glama release administration](https://glama.ai/mcp/servers/haseebgb92/GSC-Maestro/admin/releases)

For future updates, synchronize the repository in the Glama admin, choose the repository's root build context, then enter build step `npm install --prefix glama/gsc --omit=dev --ignore-scripts --no-audit --no-fund` and startup command `["mcp-proxy","--","node","glama/gsc/server.mjs"]` without environment secrets. Test before publishing any replacement release.

The hosted edition is a **public metrics-only demo**, not a cloud-connected Search Console service. The complete desktop MCP server remains separately installed and user-authorized.
