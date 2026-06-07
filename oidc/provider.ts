import Provider, { type Account, type Configuration, type KoaContextWithOIDC } from "oidc-provider";
import { accountRepository } from "./account-repository";
import { getClients } from "./client-config";
import { RedisAdapter } from "./redis-adapter";

function getIssuer() {
  return process.env.OIDC_ISSUER ?? "http://localhost:3000/api/oidc";
}

function getCookieKeys() {
  const keys = process.env.OIDC_COOKIE_KEYS?.split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  if (keys && keys.length > 0) return keys;
  return ["dev-cookie-key-change-me"];
}

function getJwks() {
  const value = process.env.OIDC_JWKS;
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
        given_name: alias.givenName,
        family_name: alias.familyName,
      };
    },
  };
}

export function createOidcProvider() {
  const configuration: Configuration = {
    clients: getClients(),
    adapter: RedisAdapter,
    jwks: getJwks(),
    conformIdTokenClaims: false,
    findAccount,
    claims: {
      openid: ["sub"],
      email: ["email", "email_verified"],
      profile: ["given_name", "family_name"],
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
      required: () => true,
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
    ttl: {
      AuthorizationCode: 60,
      IdToken: 10 * 60,
      AccessToken: 10 * 60,
      Interaction: 10 * 60,
    },
  };

  return new Provider(getIssuer(), configuration);
}

let provider: Provider | null = null;

export function getOidcProvider() {
  provider ??= createOidcProvider();
  return provider;
}
