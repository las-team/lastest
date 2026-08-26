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
    // Word-ish boundary so `call__v` does not match inside `recall__vx`.
    const idx = haystack.indexOf(needle);
    if (idx === -1) return false;
    const before = haystack[idx - 1] ?? " ";
    const after = haystack[idx + needle.length] ?? " ";
    return !/[a-z0-9_]/.test(before) && !/[a-z0-9_]/.test(after);
  });
}
