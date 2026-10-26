# GSC Maestro

<p align="center"><img src="GSC-Maestro-ChatGPT-icon.png" alt="GSC Maestro icon" width="104" /></p>
<p align="center"><strong>Local-first search intelligence for Google Search Console, Bing Webmaster, Yandex Webmaster, technical auditing, and AI search reports.</strong></p>

> **Bring your own accounts and credentials.** Nothing in this GitHub repository contains a developer's Google, Bing, Yandex, or ChatGPT access token, connected websites, search data, or private deployment configuration.

## Features

| Area | Capabilities |
| --- | --- |
| Google Search Console | Desktop OAuth, authorized properties, queries, pages, daily performance, search opportunities, indexing/URL inspection, sitemap status. |
| Bing Webmaster | Connect an existing Bing Webmaster API key, sync verified sites, and inspect engine-specific performance. |
| Yandex Webmaster | Connect a personal Yandex OAuth token, discover properties and query/indexing information when the API permits access. |
| Technical audit | Bounded public crawler and site-audit summaries with evidence and source attribution. |
| AI Search and reports | Import supported Bing AI citation exports and generate source-labelled reports. |
| MCP | Local stdio server, MCP Apps visual dashboard, and optional separately configured bearer/OAuth-protected HTTP gateway. |
| Offline/local | SQLite snapshots and exports in each user's private application directory. No account credentials bundled with the app. |

**Platform:** Linux desktop (Tauri 2 + React + TypeScript + Rust), plus a Node.js 22 MCP server. Source code is supplied; prebuilt packages and live cloud integrations are not part of this repository. Features dependent on external APIs require those services and their permissions. Yandex API availability in particular is provider-dependent; a configured token is not a guarantee that all reports work.

## Build and run locally

Requirements: Node.js **22+**, npm, Rust/Cargo, and the system dependencies for Tauri 2 on Linux (notably WebKit2GTK **4.1**, GTK3 development headers, and standard Linux build tools). See [Tauri's Linux prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
git clone https://github.com/haseebgb92/GSC-Maestro.git
cd GSC-Maestro
npm ci
npm run desktop
```

Build an installable Linux Debian package:

```bash
npm run desktop:build
```

Run the local, read-only MCP server from the project folder:

```bash
npm run mcp:bundle
npm run mcp
```

Run the frontend browser preview (without native Tauri account features) using `npm run dev`. The desktop app is needed to store Google/Bing/Yandex credentials and execute native sync commands.

## First-time setup — **your own** credentials

### Google Search Console

1. Open your own [Google Cloud Console](https://console.cloud.google.com/), select or create a project, and enable the **Google Search Console API**.
2. Set up Google's OAuth consent screen; use the appropriate publishing status/test users for your deployment.
3. Create an **OAuth client ID → Desktop app**, then download the client JSON. Do **not** commit this file or share it with others.
4. In **GSC Maestro → Settings**, choose **Import OAuth JSON**. The app saves the OAuth client settings in the **operating-system keyring**, not in this repository.
5. Click **Connect Google**, authorize the app in your system browser using its **read-only Search Console scope**, and then refresh/sync your own verified property.

Your Google authorization and refresh token are private to your Linux account. The app does not ship with preconnected properties or the repository author's OAuth client.

### Bing Webmaster

1. Sign into your own [Bing Webmaster Tools](https://www.bing.com/webmasters/).
2. Obtain your API key from the account's API access settings.
3. Open the app's **Bing** section, paste the key into the password field, and choose **Connect and sync**.

The key is saved privately in the user's local application directory (mode 0600). It is never checked into Git, and no built-in key is supplied.

### Yandex Webmaster

1. Obtain a **Yandex OAuth token** authorized for the Webmaster API through your own Yandex account and OAuth application.
2. Open the app's **Yandex** section and configure the token.
3. Refresh or sync verified sites. API permission, endpoint availability, and Yandex-side restrictions determine which data can be retrieved.

Yandex tokens are stored locally with private permissions. No Yandex OAuth application JSON, tokens, or account IDs from development are included.

### Is Google API access paid?

GSC Maestro does not require a paid LLM/API subscription or the Advertpreneur/E92 account. Google Cloud, Bing and Yandex independently govern their APIs, quotas and authorization conditions; check their current terms for your own usage.

## Data protection

- **Google:** client configuration and refresh tokens are stored in the Linux Secret Service/keyring by the native app.
- **Bing/Yandex:** their respective API credentials are stored in per-user private local files under `~/.local/share/com.advertpreneur.gscmaestro/`.
- **Analytics:** local SQLite databases, report exports, OAuth sessions, logs, cache, credentials, and downloaded files are **Git-ignored**.
- **MCP:** stdio does not expose a public network port. Optional HTTP listens on `127.0.0.1` and creates its own strong local authentication token. Never expose the loopback service directly to the public Internet.
- No Google, Bing, or Yandex account is connected when a new user first clones this repository.

## Optional hosted MCP / ChatGPT OAuth

The public HTTP/MCP endpoint is **off by default**. Running the local MCP server requires no public URL. If you deliberately want remote access, configure a real HTTPS reverse proxy and an **independent hostname belonging to you**, then set:

```bash
export GSC_MAESTRO_PUBLIC_BASE_URL='https://your-domain.example/gsc-maestro'
npm run mcp:http
```

Set the variable in your private service environment for unattended deployments; do not hard-code URLs, keys, tokens or OAuth files. [.env.example](.env.example) lists optional settings, but it is a **template**, not an automatically loaded config or a safe place to commit filled-in values.

- Without `GSC_MAESTRO_PUBLIC_BASE_URL`, hosted OAuth routes are disabled; private localhost MCP can still use the generated local bearer token.
- The OAuth implementation's remote client support is presently **ChatGPT-specific** (PKCE with its known redirect/client metadata). Check your own compatible ChatGPT connector support before promising remote usage.
- Remote exposure is optional and requires TLS, routing, owner approvals, verification, and normal security maintenance. No third-party tenant access is enabled by publishing this repository.

See [SECURITY.md](SECURITY.md) for credential-handling and responsible reporting guidance.

## Test and verify

```bash
npm run security:check
npm test
npm run build
npm run mcp:bundle
node --no-warnings --experimental-sqlite tests/mcp-smoke.mjs
```

`npm run desktop:build` builds the Tauri Linux package. The MCP bundle build regenerates required deployment assets under the ignored `src-tauri/resources/` directory.

## Source layout

| Path | Purpose |
| --- | --- |
| `src/` | React desktop dashboard, charts, Google/Bing/Yandex views, indexing, reports. |
| `src-tauri/src/` | Rust native commands, Google OAuth/keyring, private local storage, schedulers. |
| `mcp/` | Search adapters, public-site crawler, authenticated HTTP transport, OAuth and MCP server. |
| `mcp-ui/` | Visual MCP Apps views. |
| `tests/` | Deterministic regression tests; no real credentials required. |
| `src-tauri/icons/` | Application branding for packages. |

## Important limitations

Google Search Console, Bing and Yandex APIs may limit data or require separately verified ownership. Real Google Search Console authorization needs the desktop application and your own OAuth configuration. Search engine metrics are kept separate; sample data is visibly identified and should not be represented as live data. Direct write access to websites is not enabled by these read-only search connectors.

**Never open a GitHub issue containing API keys, OAuth JSON, bearer tokens, user property exports, or search-console screenshots with sensitive client data.**

---

Made by Advertpreneur. License: MIT.
