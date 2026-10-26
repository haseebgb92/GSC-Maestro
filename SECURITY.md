# Security policy

## Credential handling

Connect **your own** Google Desktop OAuth client through the native Settings import, Bing Webmaster API key through the Bing screen, and Yandex OAuth token through the Yandex screen. These are not embedded in the source repository.

Private runtime state must remain under the local user's account: the Linux Secret Service keyring and `~/.local/share/com.advertpreneur.gscmaestro/`. Never commit OAuth JSON downloads, API tokens, SQLite databases, CSV reports, logs, `.env` values, or remote deployment keys.

The public MCP hostname, if used, must be supplied independently with `GSC_MAESTRO_PUBLIC_BASE_URL`. Hosted OAuth is disabled when unset. This GitHub repository does not grant access to the author's MCP tunnel or Google, Bing, or Yandex account.

## Before contributing

```bash
npm run security:check
npm test
npm run build
```

The pre-push check is intentionally conservative and flags potential private-machine paths. It is not a substitute for a professional secret-scanning service. Inspect changes manually before creating a public commit.

## If a secret is accidentally published

Immediately revoke or rotate the affected key/token through the provider, remove exposed files from public access, and review Git history; simply deleting a file in a new commit does not erase it from previous revisions. Do not post actual secrets in a public issue.

Please report security vulnerabilities privately to the repository owner using GitHub's private vulnerability reporting feature if enabled. Otherwise do not disclose exploit details or confidential data in public issues.
