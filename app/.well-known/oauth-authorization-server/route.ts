import { discoveryResponse } from "@/oidc/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return discoveryResponse();
}
