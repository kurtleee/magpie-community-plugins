# GitHub Copilot

An unofficial OpenCode provider plugin for GitHub Copilot on GitHub.com and
GitHub Enterprise (including GHE.com). In magpie it also shows the account's
premium request or credit quota: used, remaining, the included allowance and
when it resets. It does not change the subscription or enable paid overage.

The authentication and request implementation is adapted from
[`opencode-copilot-auth` 0.0.12](https://www.npmjs.com/package/opencode-copilot-auth)
([source](https://github.com/anomalyco/opencode-copilot-auth)), under its MIT
license, retained in `LICENSE`. It uses the same device flow, Copilot client
headers, request signing, initiator detection and vision headers. No runtime
dependency on another installed plugin or local file is needed.

## Install and sign in

```sh
magpie plugin add @magpie-community/opencode-copilot-auth
magpie plugin login github-copilot
```

Choose GitHub.com or GitHub Enterprise; for Enterprise enter your own GitHub
host, such as `company.ghe.com`. Complete GitHub's device authorization in
the browser. Host inputs must be HTTPS origins without credentials, paths,
query strings or custom ports. As in the upstream plugin, Enterprise API and
inference hosts are `api.<host>` and `copilot-api.<host>`; deployments with
different endpoint layouts are not covered.

For OpenCode, add `@magpie-community/opencode-copilot-auth` to `plugin` in
`opencode.json`, then run `opencode auth login`.

The provider id is `github-copilot` for both deployments. GitHub's OAuth token
is stored in the host's auth store as `refresh`; the short-lived Copilot token
is stored as `access` with `expires`. In magpie this is `plugin-auth.json`,
scoped by the host to the selected account, including additional `#slot`
accounts. Enterprise sign-ins keep `enterpriseUrl` through token renewal.
Models come from the host's existing `github-copilot` catalog.

If the original `opencode-copilot-auth` is already installed in magpie, keep
it and explicitly choose which plugin serves the existing provider:

```sh
magpie plugin use @magpie-community/opencode-copilot-auth github-copilot
```

The shared provider id lets the new plugin reuse the existing sign-in and
model picks; there is no automatic migration from magpie's separate built-in
`copilot` provider or from a legacy `github-copilot-enterprise` auth entry.

## Quota reporting

magpie calls `auth.usage(getAuth, provider)` independently of model requests.
It reads `GET /copilot_internal/user` on `api.github.com` or the account's
`api.<enterpriseUrl>` using the GitHub OAuth token, **not** the short-lived
inference token. Reading quota neither renews nor persists either token.
OpenCode ignores magpie's additional hook.

- Snapshot counters accept numbers or numeric strings. Fractional
  `quota_remaining` takes precedence over the rounded legacy `remaining`;
  `remaining` is the fallback when the canonical field is absent. Used amount
  is entitlement minus remaining. `credits_used` is used only when neither
  the remaining counter nor a percentage is available.
- Snapshot amounts determine the percentage when known; otherwise
  `percent_remaining` gives a percentage without inventing an absolute balance.
- `quota_reset_at`, `quota_reset_date_utc` and `quota_reset_date` supply resets;
  date-only values mean UTC midnight. Legacy free-plan monthly counters are
  supported too.
- `has_quota: false` does not hide a usable or exhausted seat. A zero
  entitlement means no included allowance. An exhausted premium pool may say
  `unlimited: true, has_quota: false`; it is shown as 100% used, not unlimited.
- Unlimited chat and completion allowances are labelled `Unlimited`, not
  `0 / 0`. Completion quotas do not block chat model routing. Only unmanaged
  premium seats with vendor-permitted overage are informational (`aside`);
  Business and Enterprise exhaustion remains blocking, as in magpie's native
  Copilot implementation. The plugin never changes the overage permission or
  adds the separate overage counter to included usage.
- Empty, malformed or unavailable quota data is unknown, not zero usage.
  Only an explicit HTTP 401 marks the sign-in expired. Network errors, rate
  limits, 403s and server errors keep the sign-in. No response body or token is
  included in error messages. Quota requests have a timeout and reject redirects.

GitHub's quota endpoint is internal and may change. An organization may not
expose all balances to a seat; missing data is not an estimate of its budget.

## Tests

```sh
HOME=$(mktemp -d) bun test packages/copilot
bun scripts/check.mjs copilot
```

Tests use synthetic accounts and mocked network responses only: public and
Enterprise device flows, token refresh, request signing, fractional credits,
legacy requests, unlimited allowances, resets, unknown quota and read failures.
They read no real auth files and consume no Copilot allowance.
