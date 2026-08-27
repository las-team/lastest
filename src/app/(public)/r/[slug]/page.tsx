import PublicSharePage, {
  generateMetadata,
  type PageProps,
} from "@lastest/plugin-share/page";
import { AwardBadgeRow } from "@/components/awards/award-badge-row";
import { WebMcpShareTools } from "@/components/webmcp/webmcp-share-tools-client";

// Dynamic — share content is live and render is cheap (pure server HTML).
export const revalidate = 0;

export { generateMetadata };

export default async function Page({ params }: PageProps) {
  const { slug } = await params;
  return (
    <>
      {/* Public, read-only WebMCP tools for this report — no session involved.
       *  See docs/design/webmcp.md §7. */}
      <WebMcpShareTools
        slug={slug}
        enabled={process.env.WEBMCP_ENABLED === "1"}
      />
      <PublicSharePage params={params} awardBadgeRow={AwardBadgeRow} />
    </>
  );
}
