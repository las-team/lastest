/**
 * Mechanical rename rule (§6.0.2). Output of these helpers is `[UNVERIFIED]`
 * by definition: preflight must confirm it against live metadata.
 */

function stripVod(name: string): string {
  return name.replace(/__c$/i, "").replace(/_vod$/i, "");
}

/** `Call2_vod__c → call2__v`, `Account → account__v`, `User → user__sys`. */
export function renameObject(sfdcObject: string): string {
  if (sfdcObject === "User") return "user__sys";
  return `${stripVod(sfdcObject).toLowerCase()}__v`;
}

const FIELD_EXCEPTIONS: Record<string, string> = {
  Name: "name__v",
  OwnerId: "ownerid__v",
  CreatedById: "created_by__v",
  CreatedDate: "created_date__v",
  LastModifiedById: "modified_by__v",
  LastModifiedDate: "modified_date__v",
  RecordTypeId: "object_type__v.api_name__v",
  CurrencyIsoCode: "local_currency__sys",
};

/**
 * `Call_Datetime_vod__c → call_datetime__v`; customer `Foo__c → foo__c`;
 * `zvod_*` → `null` (dropped); `Id` → `null` (legacy-id field is resolved at
 * preflight, §3.2); `IsDeleted`/`SystemModstamp` → `null` (routing only).
 */
export function renameField(sfdcField: string): string | null {
  if (sfdcField in FIELD_EXCEPTIONS) return FIELD_EXCEPTIONS[sfdcField];
  if (
    sfdcField === "Id" ||
    sfdcField === "IsDeleted" ||
    sfdcField === "SystemModstamp"
  )
    return null;
  if (/^zvod_/i.test(sfdcField)) return null;
  if (/_vod__c$/i.test(sfdcField))
    return `${stripVod(sfdcField).toLowerCase()}__v`;
  if (/__c$/i.test(sfdcField))
    return `${sfdcField.replace(/__c$/i, "").toLowerCase()}__c`;
  return `${sfdcField.toLowerCase()}__v`;
}

/**
 * `Submitted_vod → submitted__v`; plain-English `"Detail Only" → detail_only__v`;
 * customer values get `__c` when `customer = true`.
 */
export function renamePicklistValue(value: string, customer = false): string {
  const suffix = customer ? "__c" : "__v";
  if (/_vod$/i.test(value))
    return `${value.replace(/_vod$/i, "").toLowerCase()}${suffix}`;
  const slug = value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${slug || "value"}${suffix}`;
}

/** `Speaker_Program_vod → speaker_program__v`. */
export function renameObjectType(developerName: string): string {
  return `${developerName.replace(/_vod$/i, "").toLowerCase()}__v`;
}

/** `Status_vod__c → {object}_status__v` (§6.0.2 status fields). */
export function renameStatusField(targetObject: string): string {
  return `${targetObject.replace(/__v$|__sys$|__c$/, "")}_status__v`;
}

/** `America/New_York → america_new_york__sys` (§6.0.2 timezone). */
export function renameTimezone(tz: string): string {
  return `${tz.toLowerCase().replace(/[^a-z0-9]+/g, "_")}__sys`;
}
