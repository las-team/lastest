import PublicSharePage, {
  generateMetadata,
  type PageProps,
} from "@lastest/plugin-share/page";
import { AwardBadgeRow } from "@/components/awards/award-badge-row";

// Dynamic — share content is live and render is cheap (pure server HTML).
export const revalidate = 0;

export { generateMetadata };

export default function Page({ params }: PageProps) {
  return <PublicSharePage params={params} awardBadgeRow={AwardBadgeRow} />;
}
