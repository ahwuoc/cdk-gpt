import type { ClientMetadata } from "oidc-provider";

function csv(value?: string) {
  return value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getClients(): ClientMetadata[] {
  const clientId = process.env.OIDC_CLIENT_ID ?? "openai-alias-demo";
  const clientSecret = process.env.OIDC_CLIENT_SECRET ?? "dev-secret-change-me";
  const redirectUris = csv(process.env.OIDC_CLIENT_REDIRECT_URIS) ?? [
    "https://external.auth.openai.com/sso/oidc/6A8rnomqd4FgfFnu5erMMiVfJ/callback",
    "http://localhost:3000/api/auth/callback/oidc",
  ];

  return [
    {
      client_id: clientId,
      client_secret: clientSecret,
      client_name: "OpenAI External SSO",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      redirect_uris: redirectUris,
      scope: "openid email profile",
      token_endpoint_auth_method: "client_secret_basic",
    },
  ];
}
