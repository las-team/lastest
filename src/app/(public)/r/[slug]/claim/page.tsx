import { redirect } from "next/navigation";
import { getCurrentSession } from "@/lib/auth";
import {
  ClaimPage,
  type ClaimPageProps,
} from "@lastest/plugin-share/claim-page";

export const dynamic = "force-dynamic";

export default async function Page({ params }: ClaimPageProps) {
  const { slug } = await params;
  const session = await getCurrentSession();
  if (!session?.team) {
    redirect(`/login?claim=${slug}`);
  }
  return <ClaimPage params={params} />;
}
