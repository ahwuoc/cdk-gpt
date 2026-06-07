import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

const jwk = privateKey.export({ format: "jwk" });
jwk.use = "sig";
jwk.alg = "RS256";
jwk.kid = `oidc-${Date.now()}`;

console.log(JSON.stringify({ keys: [jwk] }));
