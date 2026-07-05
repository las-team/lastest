/**
 * Quality-score → letter-grade mapping, shared by the public share page and the
 * WCAG panel so a grade can never render two ways on the same page.
 */

export type GradeTone = "ok" | "warn" | "danger";

export interface GradeInfo {
  grade: string;
  tone: GradeTone;
}

// Raw 0–100 → letter. Bands mirror the internal compliance cards (90+ A, 80+ B,
// 70+ C, 60+ D, else F). Used on the operator's private dashboard; on public
// shares route through `publicShareGrade` instead.
export function scoreGrade(score: number): GradeInfo {
  if (score >= 90) return { grade: "A", tone: "ok" };
  if (score >= 80) return { grade: "B", tone: "ok" };
  if (score >= 70) return { grade: "C", tone: "warn" };
  if (score >= 60) return { grade: "D", tone: "warn" };
  return { grade: "F", tone: "danger" };
}

export interface PublicGrade {
  /** "A" | "B" | "C" | "Needs review" */
  display: string;
  tone: GradeTone;
  /** Whether the raw numeric score should be shown alongside the grade. */
  showScore: boolean;
  /** True when the grade was floored (would-be D/F). */
  floored: boolean;
}

// Public-share grade floor (spec §3.3). A founder's own site should never carry
// a bare "D"/"F" on their public timeline — that reads as an accusation and
// poisons trust in the whole report. Would-be D/F (score < 70) collapse to an
// amber "Needs review" with the number hidden; the low grade is for their
// private dashboard after they claim. A/B/C render as-is.
export function publicShareGrade(score: number): PublicGrade {
  const { grade, tone } = scoreGrade(score);
  if (score < 70) {
    return {
      display: "Needs review",
      tone: "warn",
      showScore: false,
      floored: true,
    };
  }
  return { display: grade, tone, showScore: true, floored: false };
}
