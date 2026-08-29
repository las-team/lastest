/**
 * Vendor-release churn signal — pure text matching over release notes.
 *
 * Lives in the model rather than next to the SUT profilers because it touches
 * nothing but two strings: the profilers persist, this one decides.
 */

/**
 * Vendor-release churn signal.
 *
 * Marks object types a vendor release touched, so their cells outrank equally
 * sized untouched ones. This is the release-wave prioritisation the whole
 * Vault pitch rests on: when 26R2 changes the Call Report layout, the cells on
 * `call__v` should climb the queue on their own.
 *
 * Matching is deliberately literal — a release note naming `call__v` marks
 * `call__v`. Inferring "the release probably affects X" from prose is exactly
 * the kind of guess that would make the churn term untrustworthy.
 */
export function extractChurnedObjectTypes(
  releaseNotes: string,
  knownObjectTypes: string[],
): string[] {
  const haystack = releaseNotes.toLowerCase();
  return knownObjectTypes.filter((t) => {
    const needle = t.toLowerCase();
    if (!needle) return false;
    // EVERY occurrence, not just the first: checking only `indexOf` meant a
    // note reading "recall__vx ... call__v" tested the embedded occurrence,
    // found an identifier character beside it, and reported `call__v`
    // untouched — the standalone mention two words later never got looked at.
    for (
      let idx = haystack.indexOf(needle);
      idx !== -1;
      idx = haystack.indexOf(needle, idx + 1)
    ) {
      const before = haystack[idx - 1] ?? " ";
      const after = haystack[idx + needle.length] ?? " ";
      // Word-ish boundary so `call__v` does not match inside `recall__vx`.
      if (!/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after)) return true;
    }
    return false;
  });
}
