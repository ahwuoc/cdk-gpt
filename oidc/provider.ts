import Provider, { type Account, type Configuration, type KoaContextWithOIDC } from "oidc-provider";
import { accountRepository } from "./account-repository";
import { getClients } from "./client-config";
import { readCsvEnv, readEnv } from "./env";
import { RedisAdapter } from "./redis-adapter";

export function getIssuer() {
  const issuer = readEnv("OIDC_ISSUER") ?? "http://localhost:3000";
  const url = new URL(issuer);

  if (url.pathname === "/api/oidc" || url.pathname === "/oidc") {
    return url.origin;
  }

  return issuer.replace(/\/$/, "");
}

function getCookieKeys() {
  const keys = readCsvEnv("OIDC_COOKIE_KEYS");

  if (keys && keys.length > 0) return keys;
  return ["dev-cookie-key-change-me"];
}

function getJwks() {
  const value = readEnv("OIDC_JWKS");
  if (!value) return undefined;

  return JSON.parse(value) as NonNullable<Configuration["jwks"]>;
}

async function findAccount(_ctx: KoaContextWithOIDC, sub: string): Promise<Account | undefined> {
  const alias = await accountRepository.getAliasById(sub);
  if (!alias) return undefined;

  return {
    accountId: alias.id,
    async claims() {
      return {
        sub: alias.id,
        email: alias.email,
        email_verified: true,
        name: `${alias.givenName} ${alias.familyName}`,
        given_name: alias.givenName,
        family_name: alias.familyName,
      };
    },
  };
}

export function createOidcProvider() {
  const configuration: Configuration = {
    clients: getClients(),
    clientAuthMethods: ["client_secret_basic", "client_secret_post"],
    adapter: RedisAdapter,
    jwks: getJwks(),
    responseTypes: ["code"],
    conformIdTokenClaims: false,
    findAccount,
    claims: {
      openid: ["sub"],
      email: ["email", "email_verified"],
      profile: ["name", "given_name", "family_name"],
    },
    cookies: {
      keys: getCookieKeys(),
    },
    interactions: {
      url(_ctx, interaction) {
        return `/interaction/${interaction.uid}`;
      },
    },
    features: {
      devInteractions: {
        enabled: false,
      },
    },
    pkce: {
      required: (_ctx, client) => client.tokenEndpointAuthMethod === "none",
    },
    renderError(ctx, out, error) {
      console.error("OIDC provider error", error);
      ctx.type = "json";
      ctx.body =
        process.env.NODE_ENV === "production"
          ? out
          : {
              ...out,
              debug: error.message,
              stack: error.stack,
            };
    },
    routes: {
      authorization: "/oidc/authorize",
      token: "/oidc/token",
      userinfo: "/oidc/userinfo",
      jwks: "/oidc/jwks",
      end_session: "/oidc/session/end",
      pushed_authorization_request: "/oidc/request",
    },
    ttl: {
      AuthorizationCode: 60,
      IdToken: 10 * 60,
      AccessToken: 10 * 60,
      Interaction: 10 * 60,
    },
  };

  const provider = new Provider(getIssuer(), configuration);
  provider.proxy = true;
  return provider;
}

let provider: Provider | null = null;

export function getOidcProvider() {
  provider ??= createOidcProvider();
  return provider;
}
