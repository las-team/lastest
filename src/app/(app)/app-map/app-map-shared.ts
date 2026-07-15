import type { CoverageStatus } from "@/lib/app-map/build-map";

export const COVERAGE_COLOR: Record<CoverageStatus, string> = {
  covered: "#3f9142",
  planned: "#E09836",
  uncovered: "#9ca3af",
};

export const COVERAGE_LABEL: Record<CoverageStatus, string> = {
  covered: "Covered",
  planned: "Planned",
  uncovered: "No coverage",
};
