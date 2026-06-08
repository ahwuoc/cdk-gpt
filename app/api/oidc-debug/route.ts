import { getIssuer } from "@/oidc/provider";
import { readCsvEnv, readEnv } from "@/oidc/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    issuer: getIssuer(),
    client_id: readEnv("OIDC_CLIENT_ID") ?? null,
    has_client_secret: Boolean(readEnv("OIDC_CLIENT_SECRET")),
    redirect_uris: readCsvEnv("OIDC_CLIENT_REDIRECT_URIS") ?? [],
  });
}
