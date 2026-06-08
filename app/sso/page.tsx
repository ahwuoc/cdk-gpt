import { OidcSsoHome } from "@/components/oidc-sso-home";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function SsoPage() {
  return <OidcSsoHome />;
}
