import {
  AppMapClient,
  type CoverageRailComponent,
  type ExploreProgressPanelComponent,
} from "./app-map-client";
import { getActiveExploration, getAppMap } from "../actions";

/**
 * The plugin half of the `/app-map` route.
 *
 * Everything App Map renders lives in this package; what stays on the app side
 * (`src/app/(app)/app-map/page.tsx`) is the composition — resolving which
 * repository the user has selected, the plan gates, and the two pieces of app
 * UI a plugin may not import. See `app-map-client.tsx` for why the progress
 * panel is one of them.
 *
 * The initial map is fetched here rather than in the app page, which is a
 * change from before: the page used to call the server action itself. It
 * cannot any more, because the action now takes a `repositoryId` and running
 * it is what resolves the plugin's scope. Fetching from inside the package
 * keeps that resolution in one place.
 */
export default async function AppMapPage({
  repositoryId,
  branch,
  qaAgentEnabled,
  maxExplorers,
  exploreProgressPanel,
  onCancelExploration,
  dataView,
  gapsView,
  coverageRail,
  coverageSummary,
  coverageGapCount,
}: {
  repositoryId: string;
  branch: string;
  qaAgentEnabled: boolean;
  maxExplorers: number;
  exploreProgressPanel: ExploreProgressPanelComponent;
  onCancelExploration: (sessionId: string) => Promise<void>;
  /** Optional data-coverage surfaces — see `AppMapClientProps`. */
  dataView?: React.ReactNode;
  gapsView?: React.ReactNode;
  coverageRail?: CoverageRailComponent;
  coverageSummary?: string;
  coverageGapCount?: number;
}) {
  const [result, activeExploration] = await Promise.all([
    getAppMap({ repositoryId, branch }),
    qaAgentEnabled
      ? getActiveExploration({ repositoryId })
      : Promise.resolve(null),
  ]);

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      <AppMapClient
        initialGraph={result.ok ? result.graph : null}
        emptyReason={result.ok ? null : result.reason}
        repositoryId={repositoryId}
        branch={branch}
        qaAgentEnabled={qaAgentEnabled}
        maxExplorers={maxExplorers}
        activeExploration={activeExploration}
        exploreProgressPanel={exploreProgressPanel}
        onCancelExploration={onCancelExploration}
        dataView={dataView}
        gapsView={gapsView}
        coverageRail={coverageRail}
        coverageSummary={coverageSummary}
        coverageGapCount={coverageGapCount}
      />
    </div>
  );
}
