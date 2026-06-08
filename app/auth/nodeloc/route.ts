import { redirect } from "next/navigation";
import { buildLoginRedirectUrl } from "@/lib/auth";

export const dynamic = "force-dynamic";

export function GET() {
  redirect(buildLoginRedirectUrl("/dashboard"));
}
