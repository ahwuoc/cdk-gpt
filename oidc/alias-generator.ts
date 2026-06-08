import { createHash, randomInt, randomUUID } from "node:crypto";
import { adjectives, animals, uniqueNamesGenerator } from "unique-names-generator";
import { readEnv } from "./env";

export function getDefaultAliasDomain() {
  const configuredDomain = readEnv("OIDC_ALIAS_DOMAIN");
  if (configuredDomain) return normalizeAliasDomain(configuredDomain);

  const issuer = readEnv("OIDC_ISSUER") ?? "https://www.chillnro.online";
  return normalizeAliasDomain(new URL(issuer).hostname);
}

export const defaultAliasDomain = getDefaultAliasDomain();

function normalizeAliasDomain(domain: string) {
  return domain.trim().toLowerCase().replace(/^@/, "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export function generateCatchAllAlias(domain = defaultAliasDomain) {
  const normalizedDomain = normalizeAliasDomain(domain);
  if (!normalizedDomain || !normalizedDomain.includes(".")) {
    throw new Error("A valid catch-all domain is required");
  }

  const name = uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    separator: "-",
    style: "lowerCase",
  });
  const number = randomInt(1000, 9999);

  return `${name}-${number}@${normalizedDomain}`;
}

export async function generateUniqueCatchAllAlias(params: {
  domain?: string;
  exists: (email: string) => Promise<boolean>;
  maxAttempts?: number;
}) {
  const maxAttempts = params.maxAttempts ?? 20;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const email = generateCatchAllAlias(params.domain);
    if (!(await params.exists(email))) {
      return email;
    }
  }

  throw new Error("Unable to generate a unique email alias");
}

export function deterministicAliasId(email: string) {
  return createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 24);
}

export function opaqueAliasId() {
  return randomUUID();
}
