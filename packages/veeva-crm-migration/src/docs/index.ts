/**
 * `@lastest/veeva-crm-migration/docs` — Markdown documentation of a
 * classified snapshot (pure renderer + one file writer).
 */
export {
  renderDocs,
  renderIndex,
  renderProfiles,
  renderGlobalIndex,
  renderCountryIndex,
  renderRepCategory,
  type RenderedDoc,
  type RenderOptions,
} from "./render";
export { renderIntake } from "./intake";
export { buildContext, type Ctx } from "./context";
export { table as markdownTable } from "./markdown";
export { writeDocs } from "./write";
