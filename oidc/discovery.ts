import { getIssuer } from "./provider";

export function getDiscoveryMetadata() {
  const issuer = getIssuer();

  return {
    issuer,
    authorization_endpoint: `${issuer}/oidc/authorize`,
    token_endpoint: `${issuer}/oidc/token`,
    userinfo_endpoint: `${issuer}/oidc/userinfo`,
    jwks_uri: `${issuer}/oidc/jwks`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    claims_supported: ["sub", "name", "given_name", "family_name", "email", "email_verified"],
    code_challenge_methods_supported: ["S256"],
  };
}

export function publicOidcHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=3600",
  };
}

export function discoveryResponse() {
  return Response.json(getDiscoveryMetadata(), {
    headers: publicOidcHeaders(),
  });
}
