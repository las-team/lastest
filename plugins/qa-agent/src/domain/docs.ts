/**
 * QA Agent documentation intake. Users upload product docs (requirements,
 * specs, manuals) on the setup card; the decoded text is condensed into a
 * digest the planner treats as authoritative for intended behavior — letting
 * it plan journeys and coverage for documented functionality the live crawl
 * or code check alone would miss. Only the digest is persisted (session
 * metadata), never the raw upload.
 */

export interface QaUploadedDoc {
  name: string;
  /** Base64-encoded file content (same transport as spec imports). */
  contentBase64: string;
}

export interface QaDocSummary {
  name: string;
  chars: number;
}

export const MAX_DOC_FILES = 5;
/** Per-file decoded-text cap (chars). */
export const MAX_DOC_CHARS = 40_000;
/** Total digest cap fed to the planner (chars). */
export const MAX_DOCS_DIGEST_CHARS = 15_000;

const SUPPORTED_EXTENSIONS = [".md", ".txt", ".pdf", ".docx"];

export function isSupportedDocName(name: string): boolean {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Decode one uploaded doc to plain text (pdf via unpdf, docx via mammoth,
 *  everything else utf-8) — mirrors the spec-import upload path. */
export async function decodeUploadedDoc(doc: QaUploadedDoc): Promise<string> {
  const buf = Buffer.from(doc.contentBase64, "base64");
  const lower = doc.name.toLowerCase();
  let text: string;
  if (lower.endsWith(".pdf")) {
    const { extractText } = await import("unpdf");
    const { text: pages } = await extractText(new Uint8Array(buf));
    text = Array.isArray(pages) ? pages.join("\n") : String(pages);
  } else if (lower.endsWith(".docx")) {
    const mammoth = (await import("mammoth")).default;
    const { value } = await mammoth.extractRawText({ buffer: buf });
    text = value;
  } else {
    text = buf.toString("utf-8");
  }
  return text.slice(0, MAX_DOC_CHARS);
}

/** Condense decoded docs into the planner's documentation digest. Each doc
 *  gets a fair share of the total budget so one giant file can't crowd out
 *  the others. */
export function buildDocsDigest(
  docs: Array<{ name: string; text: string }>,
): string {
  const nonEmpty = docs.filter((d) => d.text.trim());
  if (nonEmpty.length === 0) return "";
  const perDoc = Math.floor(MAX_DOCS_DIGEST_CHARS / nonEmpty.length);
  return nonEmpty
    .map((d) => {
      const body =
        d.text.length > perDoc
          ? d.text.slice(0, perDoc) + "\n…(truncated)"
          : d.text;
      return `### Document: ${d.name}\n${body.trim()}`;
    })
    .join("\n\n");
}

/** Decode + digest an upload set; returns per-file summaries for the UI and
 *  the digest for the planner. Unsupported/undecodable files are skipped. */
export async function processUploadedDocs(uploads: QaUploadedDoc[]): Promise<{
  summaries: QaDocSummary[];
  digest: string;
}> {
  const docs: Array<{ name: string; text: string }> = [];
  for (const upload of uploads.slice(0, MAX_DOC_FILES)) {
    if (!isSupportedDocName(upload.name)) continue;
    try {
      const text = await decodeUploadedDoc(upload);
      if (text.trim()) docs.push({ name: upload.name, text });
    } catch (err) {
      console.warn(`[QaDocs] failed to decode ${upload.name}:`, err);
    }
  }
  return {
    summaries: docs.map((d) => ({ name: d.name, chars: d.text.length })),
    digest: buildDocsDigest(docs),
  };
}
