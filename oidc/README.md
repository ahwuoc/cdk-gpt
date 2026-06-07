# OIDC Identity Provider Boilerplate

This folder contains a Next.js App Router based OIDC provider powered by `oidc-provider`.

## Flow

1. A client starts Authorization Code Flow against `OIDC_ISSUER`.
2. `oidc-provider` redirects to `/interaction/:uid`.
3. `app/interaction/[uid]/page.tsx` loads aliases and renders an account selection UI.
4. The form posts to `app/interaction/[uid]/finish/route.ts`, which validates the alias and calls `provider.interactionFinished()`.
5. The result includes both login and consent grant data with `accountId` set to the alias id.
6. `findAccount()` resolves that alias and returns ID token claims:
   `email`, `email_verified`, `given_name`, and `family_name`.

PKCE remains required for public clients (`token_endpoint_auth_method=none`).
The OpenAI SSO client is configured as a confidential client with `client_secret_basic`,
because OpenAI's setup test does not send a PKCE `code_challenge`.

## Catch-all alias model

Use the catch-all domain `gptsieure.bond`, then create aliases like:

```text
adjective-animal-number@gptsieure.bond
```

Persist a table with at least:

```text
id
human_user_id
email
given_name
family_name
openai_account_id
created_at
```

The repository shape in `account-repository.ts` is the integration point. Replace the in-memory implementation with Supabase/Postgres queries:

```ts
listAliasesForHumanUser(userId)
getAliasById(aliasId)
createAlias({ humanUserId, domain, givenName, familyName })
```

This maps one real user to many OpenAI accounts while each selected alias produces its own stable OIDC subject.

## Run

Run the existing Next.js app:

```bash
bun run dev
```

Discovery URL:

```text
http://localhost:3000/api/oidc/.well-known/openid-configuration
```

OpenAI redirect/callback URI:

```text
https://external.auth.openai.com/sso/oidc/6A8rnomqd4FgfFnu5erMMiVfJ/callback
```

Set `OIDC_JWKS` to a private signing JWKS in production. Without it, `oidc-provider`
uses development keys and prints a warning.
