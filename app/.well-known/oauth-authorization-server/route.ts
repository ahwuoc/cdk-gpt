import { getOidcProvider } from "@/oidc/provider";
import { runWithNodeBridge } from "@/oidc/next-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const provider = getOidcProvider();
  return runWithNodeBridge(request, "", async (req, res) => {
    await provider.callback()(req, res);
  });
}
