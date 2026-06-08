import { getOidcProvider } from "@/oidc/provider";
import { publicOidcHeaders } from "@/oidc/discovery";
import { runWithNodeBridge } from "@/oidc/next-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handleOidc(request: Request) {
  const provider = getOidcProvider();
  const response = await runWithNodeBridge(request, "", async (req, res) => {
    await provider.callback()(req, res);
  });

  if (new URL(request.url).pathname === "/oidc/jwks") {
    const headers = publicOidcHeaders();
    for (const [name, value] of Object.entries(headers)) {
      response.headers.set(name, value);
    }
  }

  return response;
}

export const GET = handleOidc;
export const POST = handleOidc;
