/**
 * Country name → ISO-3166-1 alpha-2 normalisation (DESIGN §3.1 source 2).
 *
 * Salesforce `User.Country` is free text, so the extractor needs a name map
 * to fold "Germany", "Deutschland", "DE" and "DEU" into one `CountryCode`.
 * Pure data + two pure functions; no I/O.
 */
import { GLOBAL_COUNTRY, type CountryCode } from "./types";

/** `[alpha2, alpha3, English short name, ...aliases]`. */
type CountryRow = readonly [string, string, string, ...string[]];

/**
 * Every UN member and observer state plus the territories that regularly show
 * up as user countries in pharma CRM orgs (HK, MO, PR, TW, XK, GL, …).
 */
const COUNTRY_TABLE: readonly CountryRow[] = [
  ["AD", "AND", "Andorra"],
  ["AE", "ARE", "United Arab Emirates", "UAE", "Emirates"],
  ["AF", "AFG", "Afghanistan"],
  ["AG", "ATG", "Antigua and Barbuda", "Antigua & Barbuda", "Antigua"],
  ["AI", "AIA", "Anguilla"],
  ["AL", "ALB", "Albania"],
  ["AM", "ARM", "Armenia"],
  ["AO", "AGO", "Angola"],
  ["AR", "ARG", "Argentina"],
  ["AS", "ASM", "American Samoa"],
  ["AT", "AUT", "Austria", "Österreich", "Oesterreich"],
  ["AU", "AUS", "Australia"],
  ["AW", "ABW", "Aruba"],
  ["AX", "ALA", "Åland Islands", "Aland Islands", "Aland"],
  ["AZ", "AZE", "Azerbaijan"],
  ["BA", "BIH", "Bosnia and Herzegovina", "Bosnia & Herzegovina", "Bosnia"],
  ["BB", "BRB", "Barbados"],
  ["BD", "BGD", "Bangladesh"],
  ["BE", "BEL", "Belgium", "Belgique", "België", "Belgie", "Belgien"],
  ["BF", "BFA", "Burkina Faso"],
  ["BG", "BGR", "Bulgaria"],
  ["BH", "BHR", "Bahrain"],
  ["BI", "BDI", "Burundi"],
  ["BJ", "BEN", "Benin"],
  ["BL", "BLM", "Saint Barthélemy", "Saint Barthelemy", "St. Barthelemy"],
  ["BM", "BMU", "Bermuda"],
  ["BN", "BRN", "Brunei", "Brunei Darussalam"],
  ["BO", "BOL", "Bolivia", "Plurinational State of Bolivia"],
  ["BQ", "BES", "Bonaire, Sint Eustatius and Saba", "Caribbean Netherlands"],
  ["BR", "BRA", "Brazil", "Brasil"],
  ["BS", "BHS", "Bahamas", "The Bahamas"],
  ["BT", "BTN", "Bhutan"],
  ["BW", "BWA", "Botswana"],
  ["BY", "BLR", "Belarus"],
  ["BZ", "BLZ", "Belize"],
  ["CA", "CAN", "Canada"],
  ["CC", "CCK", "Cocos (Keeling) Islands", "Cocos Islands"],
  [
    "CD",
    "COD",
    "Congo, Democratic Republic of the",
    "Democratic Republic of the Congo",
    "DR Congo",
    "DRC",
    "Congo-Kinshasa",
  ],
  ["CF", "CAF", "Central African Republic"],
  ["CG", "COG", "Congo", "Republic of the Congo", "Congo-Brazzaville"],
  [
    "CH",
    "CHE",
    "Switzerland",
    "Schweiz",
    "Suisse",
    "Svizzera",
    "Swiss Confederation",
  ],
  ["CI", "CIV", "Côte d'Ivoire", "Cote d'Ivoire", "Ivory Coast"],
  ["CK", "COK", "Cook Islands"],
  ["CL", "CHL", "Chile"],
  ["CM", "CMR", "Cameroon"],
  ["CN", "CHN", "China", "People's Republic of China", "PRC", "Mainland China"],
  ["CO", "COL", "Colombia"],
  ["CR", "CRI", "Costa Rica"],
  ["CU", "CUB", "Cuba"],
  ["CV", "CPV", "Cabo Verde", "Cape Verde"],
  ["CW", "CUW", "Curaçao", "Curacao"],
  ["CX", "CXR", "Christmas Island"],
  ["CY", "CYP", "Cyprus"],
  ["CZ", "CZE", "Czechia", "Czech Republic", "Česko", "Cesko"],
  ["DE", "DEU", "Germany", "Deutschland", "Federal Republic of Germany"],
  ["DJ", "DJI", "Djibouti"],
  ["DK", "DNK", "Denmark", "Danmark"],
  ["DM", "DMA", "Dominica"],
  ["DO", "DOM", "Dominican Republic", "República Dominicana"],
  ["DZ", "DZA", "Algeria"],
  ["EC", "ECU", "Ecuador"],
  ["EE", "EST", "Estonia", "Eesti"],
  ["EG", "EGY", "Egypt"],
  ["EH", "ESH", "Western Sahara"],
  ["ER", "ERI", "Eritrea"],
  ["ES", "ESP", "Spain", "España", "Espana"],
  ["ET", "ETH", "Ethiopia"],
  ["FI", "FIN", "Finland", "Suomi"],
  ["FJ", "FJI", "Fiji"],
  ["FK", "FLK", "Falkland Islands", "Falkland Islands (Malvinas)", "Malvinas"],
  ["FM", "FSM", "Micronesia", "Federated States of Micronesia"],
  ["FO", "FRO", "Faroe Islands", "Faeroe Islands"],
  ["FR", "FRA", "France", "French Republic"],
  ["GA", "GAB", "Gabon"],
  [
    "GB",
    "GBR",
    "United Kingdom",
    "UK",
    "U.K.",
    "Great Britain",
    "Britain",
    "England",
    "Scotland",
    "Wales",
    "Northern Ireland",
    "United Kingdom of Great Britain and Northern Ireland",
  ],
  ["GD", "GRD", "Grenada"],
  ["GE", "GEO", "Georgia"],
  ["GF", "GUF", "French Guiana"],
  ["GG", "GGY", "Guernsey"],
  ["GH", "GHA", "Ghana"],
  ["GI", "GIB", "Gibraltar"],
  ["GL", "GRL", "Greenland"],
  ["GM", "GMB", "Gambia", "The Gambia"],
  ["GN", "GIN", "Guinea"],
  ["GP", "GLP", "Guadeloupe"],
  ["GQ", "GNQ", "Equatorial Guinea"],
  ["GR", "GRC", "Greece", "Hellas", "Hellenic Republic"],
  ["GT", "GTM", "Guatemala"],
  ["GU", "GUM", "Guam"],
  ["GW", "GNB", "Guinea-Bissau", "Guinea Bissau"],
  ["GY", "GUY", "Guyana"],
  ["HK", "HKG", "Hong Kong", "Hong Kong SAR", "Hong Kong SAR China"],
  ["HN", "HND", "Honduras"],
  ["HR", "HRV", "Croatia", "Hrvatska"],
  ["HT", "HTI", "Haiti"],
  ["HU", "HUN", "Hungary", "Magyarország", "Magyarorszag"],
  ["ID", "IDN", "Indonesia"],
  ["IE", "IRL", "Ireland", "Republic of Ireland", "Éire", "Eire"],
  ["IL", "ISR", "Israel"],
  ["IM", "IMN", "Isle of Man"],
  ["IN", "IND", "India"],
  ["IO", "IOT", "British Indian Ocean Territory"],
  ["IQ", "IRQ", "Iraq"],
  ["IR", "IRN", "Iran", "Islamic Republic of Iran"],
  ["IS", "ISL", "Iceland", "Ísland"],
  ["IT", "ITA", "Italy", "Italia"],
  ["JE", "JEY", "Jersey"],
  ["JM", "JAM", "Jamaica"],
  ["JO", "JOR", "Jordan"],
  ["JP", "JPN", "Japan", "Nippon", "Nihon"],
  ["KE", "KEN", "Kenya"],
  ["KG", "KGZ", "Kyrgyzstan", "Kyrgyz Republic"],
  ["KH", "KHM", "Cambodia"],
  ["KI", "KIR", "Kiribati"],
  ["KM", "COM", "Comoros"],
  ["KN", "KNA", "Saint Kitts and Nevis", "St. Kitts and Nevis", "St Kitts"],
  [
    "KP",
    "PRK",
    "Korea, Democratic People's Republic of",
    "North Korea",
    "DPRK",
  ],
  [
    "KR",
    "KOR",
    "Korea, Republic of",
    "South Korea",
    "Korea",
    "Republic of Korea",
  ],
  ["KW", "KWT", "Kuwait"],
  ["KY", "CYM", "Cayman Islands"],
  ["KZ", "KAZ", "Kazakhstan"],
  ["LA", "LAO", "Laos", "Lao People's Democratic Republic", "Lao PDR"],
  ["LB", "LBN", "Lebanon"],
  ["LC", "LCA", "Saint Lucia", "St. Lucia", "St Lucia"],
  ["LI", "LIE", "Liechtenstein"],
  ["LK", "LKA", "Sri Lanka"],
  ["LR", "LBR", "Liberia"],
  ["LS", "LSO", "Lesotho"],
  ["LT", "LTU", "Lithuania", "Lietuva"],
  ["LU", "LUX", "Luxembourg", "Luxemburg"],
  ["LV", "LVA", "Latvia", "Latvija"],
  ["LY", "LBY", "Libya"],
  ["MA", "MAR", "Morocco", "Maroc"],
  ["MC", "MCO", "Monaco"],
  ["MD", "MDA", "Moldova", "Republic of Moldova"],
  ["ME", "MNE", "Montenegro"],
  ["MF", "MAF", "Saint Martin (French part)", "Saint Martin", "St. Martin"],
  ["MG", "MDG", "Madagascar"],
  ["MH", "MHL", "Marshall Islands"],
  [
    "MK",
    "MKD",
    "North Macedonia",
    "Macedonia",
    "Republic of North Macedonia",
    "FYROM",
  ],
  ["ML", "MLI", "Mali"],
  ["MM", "MMR", "Myanmar", "Burma"],
  ["MN", "MNG", "Mongolia"],
  ["MO", "MAC", "Macao", "Macau", "Macao SAR", "Macau SAR"],
  ["MP", "MNP", "Northern Mariana Islands"],
  ["MQ", "MTQ", "Martinique"],
  ["MR", "MRT", "Mauritania"],
  ["MS", "MSR", "Montserrat"],
  ["MT", "MLT", "Malta"],
  ["MU", "MUS", "Mauritius"],
  ["MV", "MDV", "Maldives"],
  ["MW", "MWI", "Malawi"],
  ["MX", "MEX", "Mexico", "México"],
  ["MY", "MYS", "Malaysia"],
  ["MZ", "MOZ", "Mozambique"],
  ["NA", "NAM", "Namibia"],
  ["NC", "NCL", "New Caledonia"],
  ["NE", "NER", "Niger"],
  ["NF", "NFK", "Norfolk Island"],
  ["NG", "NGA", "Nigeria"],
  ["NI", "NIC", "Nicaragua"],
  [
    "NL",
    "NLD",
    "Netherlands",
    "The Netherlands",
    "Nederland",
    "Holland",
    "Kingdom of the Netherlands",
  ],
  ["NO", "NOR", "Norway", "Norge"],
  ["NP", "NPL", "Nepal"],
  ["NR", "NRU", "Nauru"],
  ["NU", "NIU", "Niue"],
  ["NZ", "NZL", "New Zealand", "Aotearoa"],
  ["OM", "OMN", "Oman"],
  ["PA", "PAN", "Panama", "Panamá"],
  ["PE", "PER", "Peru", "Perú"],
  ["PF", "PYF", "French Polynesia", "Tahiti"],
  ["PG", "PNG", "Papua New Guinea"],
  ["PH", "PHL", "Philippines", "The Philippines"],
  ["PK", "PAK", "Pakistan"],
  ["PL", "POL", "Poland", "Polska"],
  ["PM", "SPM", "Saint Pierre and Miquelon", "St. Pierre and Miquelon"],
  ["PN", "PCN", "Pitcairn", "Pitcairn Islands"],
  ["PR", "PRI", "Puerto Rico"],
  ["PS", "PSE", "Palestine", "State of Palestine", "Palestinian Territory"],
  ["PT", "PRT", "Portugal"],
  ["PW", "PLW", "Palau"],
  ["PY", "PRY", "Paraguay"],
  ["QA", "QAT", "Qatar"],
  ["RE", "REU", "Réunion", "Reunion"],
  ["RO", "ROU", "Romania", "România"],
  ["RS", "SRB", "Serbia", "Srbija"],
  ["RU", "RUS", "Russia", "Russian Federation"],
  ["RW", "RWA", "Rwanda"],
  ["SA", "SAU", "Saudi Arabia", "KSA", "Kingdom of Saudi Arabia"],
  ["SB", "SLB", "Solomon Islands"],
  ["SC", "SYC", "Seychelles"],
  ["SD", "SDN", "Sudan"],
  ["SE", "SWE", "Sweden", "Sverige"],
  ["SG", "SGP", "Singapore"],
  ["SH", "SHN", "Saint Helena", "St. Helena"],
  ["SI", "SVN", "Slovenia", "Slovenija"],
  ["SJ", "SJM", "Svalbard and Jan Mayen", "Svalbard"],
  ["SK", "SVK", "Slovakia", "Slovak Republic", "Slovensko"],
  ["SL", "SLE", "Sierra Leone"],
  ["SM", "SMR", "San Marino"],
  ["SN", "SEN", "Senegal"],
  ["SO", "SOM", "Somalia"],
  ["SR", "SUR", "Suriname"],
  ["SS", "SSD", "South Sudan"],
  ["ST", "STP", "Sao Tome and Principe", "São Tomé and Príncipe"],
  ["SV", "SLV", "El Salvador"],
  ["SX", "SXM", "Sint Maarten", "Sint Maarten (Dutch part)"],
  ["SY", "SYR", "Syria", "Syrian Arab Republic"],
  ["SZ", "SWZ", "Eswatini", "Swaziland"],
  ["TC", "TCA", "Turks and Caicos Islands", "Turks & Caicos"],
  ["TD", "TCD", "Chad"],
  ["TG", "TGO", "Togo"],
  ["TH", "THA", "Thailand"],
  ["TJ", "TJK", "Tajikistan"],
  ["TK", "TKL", "Tokelau"],
  ["TL", "TLS", "Timor-Leste", "East Timor"],
  ["TM", "TKM", "Turkmenistan"],
  ["TN", "TUN", "Tunisia"],
  ["TO", "TON", "Tonga"],
  ["TR", "TUR", "Türkiye", "Turkiye", "Turkey"],
  ["TT", "TTO", "Trinidad and Tobago", "Trinidad & Tobago", "Trinidad"],
  ["TV", "TUV", "Tuvalu"],
  [
    "TW",
    "TWN",
    "Taiwan",
    "Taiwan, Province of China",
    "Republic of China",
    "ROC",
  ],
  ["TZ", "TZA", "Tanzania", "United Republic of Tanzania"],
  ["UA", "UKR", "Ukraine"],
  ["UG", "UGA", "Uganda"],
  [
    "US",
    "USA",
    "United States",
    "United States of America",
    "U.S.",
    "U.S.A.",
    "US of A",
    "America",
    "Estados Unidos",
  ],
  ["UY", "URY", "Uruguay"],
  ["UZ", "UZB", "Uzbekistan"],
  ["VA", "VAT", "Holy See", "Vatican", "Vatican City", "Vatican City State"],
  [
    "VC",
    "VCT",
    "Saint Vincent and the Grenadines",
    "St. Vincent and the Grenadines",
    "St Vincent",
  ],
  ["VE", "VEN", "Venezuela", "Bolivarian Republic of Venezuela"],
  ["VG", "VGB", "Virgin Islands, British", "British Virgin Islands", "BVI"],
  [
    "VI",
    "VIR",
    "Virgin Islands, U.S.",
    "US Virgin Islands",
    "U.S. Virgin Islands",
  ],
  ["VN", "VNM", "Vietnam", "Viet Nam"],
  ["VU", "VUT", "Vanuatu"],
  ["WF", "WLF", "Wallis and Futuna"],
  ["WS", "WSM", "Samoa", "Western Samoa"],
  ["XK", "XKX", "Kosovo", "Republic of Kosovo"],
  ["YE", "YEM", "Yemen"],
  ["YT", "MYT", "Mayotte"],
  ["ZA", "ZAF", "South Africa", "RSA", "Republic of South Africa"],
  ["ZM", "ZMB", "Zambia"],
  ["ZW", "ZWE", "Zimbabwe"],
];

/**
 * Lookup key: lower-case, dots removed (`U.S.` → `us`), diacritics stripped,
 * `_`/`-`/whitespace runs collapsed to one space.
 */
function nameKey(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\./g, "")
    .replace(/[\s_\-]+/g, " ")
    .trim();
}

/** Lower-cased English country names and common variants → ISO-3166-1 alpha-2. */
export const COUNTRY_NAMES: Record<string, CountryCode> = (() => {
  const map: Record<string, CountryCode> = {};
  for (const row of COUNTRY_TABLE) {
    const [code, , ...names] = row;
    for (const n of names) {
      const key = nameKey(n);
      if (!(key in map)) map[key] = code;
      const plain = n.toLowerCase();
      if (!(plain in map)) map[plain] = code;
    }
  }
  return map;
})();

const ALPHA2 = new Set<CountryCode>(COUNTRY_TABLE.map((r) => r[0]));
const ALPHA3: Record<string, CountryCode> = Object.fromEntries(
  COUNTRY_TABLE.map((r) => [r[1], r[0]]),
);
const ENGLISH_NAME: Record<CountryCode, string> = Object.fromEntries(
  COUNTRY_TABLE.map((r) => [r[0], r[2]]),
);

/** Non-ISO two-letter codes seen in the wild → ISO alpha-2. */
const ALPHA2_ALIASES: Record<string, CountryCode> = {
  UK: "GB",
  EL: "GR",
};

/**
 * Normalises a free-text country to ISO-3166-1 alpha-2.
 *
 * Accepts alpha-2 (`de`, ` DE `), the `UK`/`EL` aliases, alpha-3 (`DEU`),
 * English names and the variants in {@link COUNTRY_NAMES}. Returns `null`
 * for empty / unknown input. `"GLOBAL"` is not a country and yields `null`.
 */
export function normalizeCountry(
  raw: string | null | undefined,
): CountryCode | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (upper.length === 2) {
    if (ALPHA2.has(upper)) return upper;
    const alias = ALPHA2_ALIASES[upper];
    if (alias) return alias;
  }
  if (upper.length === 3) {
    const byAlpha3 = ALPHA3[upper];
    if (byAlpha3) return byAlpha3;
  }
  const byName = COUNTRY_NAMES[nameKey(trimmed)];
  return byName ?? null;
}

/** English short name for a country code; `"Global"` for the global bucket; the code itself when unknown. */
export function countryName(code: CountryCode): string {
  if (code === GLOBAL_COUNTRY) return "Global";
  const upper = code.toUpperCase();
  return (
    ENGLISH_NAME[upper] ?? ENGLISH_NAME[ALPHA2_ALIASES[upper] ?? ""] ?? code
  );
}

/** Every known alpha-2 code, sorted. */
export const KNOWN_COUNTRY_CODES: readonly CountryCode[] = [...ALPHA2].sort();
