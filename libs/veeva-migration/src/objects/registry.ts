/**
 * Object registry (§6.1, §6.2): one module per object key, and `loadOrder()`
 * which derives the topological steps from `dependsOn` with `selfRefs` (pass-2
 * patches) excluded from the DAG. Cycles that are not declared through
 * `selfRefs` are a blocking `MAP_CYCLE_UNDECLARED`.
 */
import { OBJECT_KEYS, type ObjectKey, type SelfRef } from "../types";
import type { ObjectModule } from "./types";

import { country } from "./reference/country";
import { user } from "./reference/user";
import { territory } from "./reference/territory";
import { user_territory } from "./reference/user_territory";
import { product } from "./product/product";
import { product_group } from "./product/product_group";
import { account } from "./account/account";
import { address } from "./account/address";
import { child_account } from "./account_rel/child_account";
import { affiliation } from "./account_rel/affiliation";
import { account_territory } from "./account_rel/account_territory";
import { tsf } from "./account_rel/tsf";
import { product_metrics } from "./account_rel/product_metrics";
import { key_message } from "./content/key_message";
import { clm_presentation } from "./content/clm_presentation";
import { clm_presentation_slide } from "./content/clm_presentation_slide";
import { approved_document } from "./content/approved_document";
import { sample_lot } from "./sample/sample_lot";
import { sample_transaction } from "./sample/sample_transaction";
import { sample_inventory } from "./sample/sample_inventory";
import { sample_inventory_item } from "./sample/sample_inventory_item";
import { em_venue } from "./em_master/em_venue";
import { em_catalog } from "./em_master/em_catalog";
import { em_speaker } from "./em_master/em_speaker";
import { em_event } from "./em_event/em_event";
import { em_attendee } from "./em_event/em_attendee";
import { em_event_speaker } from "./em_event/em_event_speaker";
import { em_event_team_member } from "./em_event/em_event_team_member";
import { expense_header } from "./expense/expense_header";
import { expense_line } from "./expense/expense_line";
import { medical_event } from "./medical/medical_event";
import { event_attendee } from "./medical/event_attendee";
import { medical_inquiry } from "./medical/medical_inquiry";
import { account_plan } from "./medical/account_plan";
import { call2 } from "./call2/call2";
import { call2_detail } from "./call2/call2_detail";
import { call2_discussion } from "./call2/call2_discussion";
import { call2_key_message } from "./call2/call2_key_message";
import { call2_sample } from "./call2/call2_sample";
import { order } from "./order_email/order";
import { order_line } from "./order_email/order_line";
import { sent_email } from "./order_email/sent_email";
import { email_activity } from "./order_email/email_activity";
import { multichannel_consent } from "./multichannel/multichannel_consent";
import { multichannel_activity } from "./multichannel/multichannel_activity";
import { multichannel_activity_line } from "./multichannel/multichannel_activity_line";

/** Family directories (one agent per family). */
export const OBJECT_FAMILIES: Record<string, ObjectKey[]> = {
  reference: ["country", "user", "territory", "user_territory"],
  product: ["product", "product_group"],
  account: ["account", "address"],
  account_rel: [
    "child_account",
    "affiliation",
    "account_territory",
    "tsf",
    "product_metrics",
  ],
  content: [
    "key_message",
    "clm_presentation",
    "clm_presentation_slide",
    "approved_document",
  ],
  sample: [
    "sample_lot",
    "sample_transaction",
    "sample_inventory",
    "sample_inventory_item",
  ],
  em_master: ["em_venue", "em_catalog", "em_speaker"],
  em_event: [
    "em_event",
    "em_attendee",
    "em_event_speaker",
    "em_event_team_member",
  ],
  expense: ["expense_header", "expense_line"],
  medical: [
    "medical_event",
    "event_attendee",
    "medical_inquiry",
    "account_plan",
  ],
  call2: [
    "call2",
    "call2_detail",
    "call2_discussion",
    "call2_key_message",
    "call2_sample",
  ],
  order_email: ["order", "order_line", "sent_email", "email_activity"],
  multichannel: [
    "multichannel_consent",
    "multichannel_activity",
    "multichannel_activity_line",
  ],
};

export const OBJECT_MODULES: Record<ObjectKey, ObjectModule> = {
  country,
  user,
  territory,
  user_territory,
  product,
  product_group,
  account,
  address,
  child_account,
  affiliation,
  account_territory,
  tsf,
  product_metrics,
  key_message,
  clm_presentation,
  clm_presentation_slide,
  approved_document,
  sample_lot,
  sample_transaction,
  sample_inventory,
  sample_inventory_item,
  em_venue,
  em_catalog,
  em_speaker,
  em_event,
  em_attendee,
  em_event_speaker,
  em_event_team_member,
  expense_header,
  expense_line,
  medical_event,
  event_attendee,
  medical_inquiry,
  account_plan,
  call2,
  call2_detail,
  call2_discussion,
  call2_key_message,
  call2_sample,
  order,
  order_line,
  sent_email,
  email_activity,
  multichannel_consent,
  multichannel_activity,
  multichannel_activity_line,
};

export function getModule(key: ObjectKey): ObjectModule {
  const m = OBJECT_MODULES[key];
  if (!m) throw new Error(`Unknown object key "${key}"`);
  return m;
}

/** One §6.1 step (without the per-country units — `run/types.ts` adds them). */
export interface LoadStep {
  index: number;
  keys: ObjectKey[];
  pass2: Array<{
    objectKey: ObjectKey;
    target: string;
    source: string;
    refKey: ObjectKey;
  }>;
}

export class CycleError extends Error {
  readonly code = "MAP_CYCLE_UNDECLARED";
  constructor(public readonly cycle: string[]) {
    super(
      `MAP_CYCLE_UNDECLARED: dependency cycle not covered by selfRefs: ${cycle.join(" → ")}`,
    );
  }
}

type ModuleLike = Pick<ObjectModule, "key" | "dependsOn" | "selfRefs">;

/**
 * Derive the ordered steps (§6.1) from `dependsOn`: a module waits for every
 * enabled dependency except those it patches in pass 2 (`selfRefs` whose
 * `objectKey` names the dependency, or the module itself). Steps are
 * longest-path layers; keys inside a step follow `OBJECT_KEYS` order.
 */
export function loadOrder(
  modules: Record<string, ModuleLike> | ModuleLike[],
  enabledKeys?: Iterable<ObjectKey>,
): LoadStep[] {
  const list = Array.isArray(modules) ? modules : Object.values(modules);
  const byKey = new Map(list.map((m) => [m.key, m] as const));
  const enabled = new Set<ObjectKey>(
    enabledKeys ? [...enabledKeys].filter((k) => byKey.has(k)) : byKey.keys(),
  );
  const order = (k: ObjectKey) => {
    const i = (OBJECT_KEYS as readonly string[]).indexOf(k);
    return i < 0 ? OBJECT_KEYS.length + [...byKey.keys()].indexOf(k) : i;
  };
  const keys = [...enabled].sort((a, b) => order(a) - order(b));
  const deps = new Map<ObjectKey, ObjectKey[]>();
  for (const k of keys) {
    const m = byKey.get(k)!;
    const pass2 = new Set(
      (m.selfRefs ?? []).map((sr: SelfRef) => sr.objectKey ?? m.key),
    );
    deps.set(
      k,
      [...new Set(m.dependsOn)]
        .filter((d) => d !== k && enabled.has(d) && !pass2.has(d))
        .sort((a, b) => order(a) - order(b)),
    );
  }
  // longest-path level via DFS with cycle detection
  const level = new Map<ObjectKey, number>();
  const visiting = new Set<ObjectKey>();
  const stack: ObjectKey[] = [];
  const visit = (k: ObjectKey): number => {
    const known = level.get(k);
    if (known !== undefined) return known;
    if (visiting.has(k))
      throw new CycleError([...stack.slice(stack.indexOf(k)), k]);
    visiting.add(k);
    stack.push(k);
    let lv = 0;
    for (const d of deps.get(k) ?? []) lv = Math.max(lv, visit(d) + 1);
    stack.pop();
    visiting.delete(k);
    level.set(k, lv);
    return lv;
  };
  for (const k of keys) visit(k);
  const max = Math.max(-1, ...level.values());
  const steps: LoadStep[] = [];
  for (let i = 0; i <= max; i++) {
    const stepKeys = keys.filter((k) => level.get(k) === i);
    const pass2: LoadStep["pass2"] = [];
    for (const k of stepKeys)
      for (const sr of byKey.get(k)!.selfRefs ?? [])
        pass2.push({
          objectKey: k,
          target: sr.target,
          source: sr.source,
          refKey: sr.objectKey ?? k,
        });
    steps.push({ index: i, keys: stepKeys, pass2 });
  }
  return steps;
}

/** Flat key order (parents before children) derived from `loadOrder`. */
export function orderedKeys(
  modules: Record<string, ModuleLike> | ModuleLike[],
  enabledKeys?: Iterable<ObjectKey>,
): ObjectKey[] {
  return loadOrder(modules, enabledKeys).flatMap((s) => s.keys);
}
