import type { ClientMetadata } from "oidc-provider";
import { readCsvEnv, readEnv } from "./env";

export function getClients(): ClientMetadata[] {
  const clientId = readEnv("OIDC_CLIENT_ID") ?? "openai-alias-demo";
  const clientSecret = readEnv("OIDC_CLIENT_SECRET") ?? "dev-secret-change-me";
  const redirectUris = readCsvEnv("OIDC_CLIENT_REDIRECT_URIS") ?? [
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
