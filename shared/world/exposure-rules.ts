import type { EventCategory, WorldEvent } from "./contracts";

export interface ExposureRegion {
  readonly name: string;
  /** Inclusive longitude/latitude bounds; boxes do not cross the antimeridian. */
  readonly bbox?: readonly [west: number, south: number, east: number, north: number];
  /** Uppercase event-country names/ISO aliases; ignored for news and GDELT publisher countries. */
  readonly countries?: readonly string[];
  /** Any listed whole word/phrase in the headline can locate the event in this region. */
  readonly geographicHeadlineKeywords?: readonly string[];
}

export interface ExposureRule {
  readonly id: string;
  readonly regions: readonly ExposureRegion[];
  readonly categories: readonly EventCategory[];
  /** Any listed whole word/phrase must occur in the headline, case-insensitively. */
  readonly headlineKeywords?: readonly string[];
  readonly sectors: readonly string[];
  readonly ruleText: string;
  readonly watchSymbols: readonly string[];
}

export interface ExposureMatch {
  event: WorldEvent;
  ruleId: string;
  region: string;
  sectors: readonly string[];
  ruleText: string;
  watchSymbols: readonly string[];
}

// These are monitoring links, not estimates of company damage, prices or returns.
// Natural events use specific shipping waters, not broad country-to-sector assumptions.
export const EXPOSURE_RULES: readonly ExposureRule[] = [
  {
    id: "bay-of-bengal-storm",
    regions: [{ name: "Bay of Bengal", bbox: [80, 5, 95, 23] }],
    categories: ["storm"],
    sectors: ["Indian ports", "Indian coastal refining"],
    ruleText:
      "Storm coordinates fall in the Bay of Bengal watch box. Indian ports and coastal refiners use these waters for vessel access and cargo transport; this location match does not establish a port closure or refinery interruption.",
    watchSymbols: ["ADANIPORTS", "RELIANCE"],
  },
  {
    id: "arabian-sea-storm",
    regions: [{ name: "Arabian Sea", bbox: [55, 5, 75, 24] }],
    categories: ["storm"],
    sectors: ["Indian ports", "Indian coastal refining"],
    ruleText:
      "Storm coordinates fall in the Arabian Sea watch box. Indian ports and coastal refiners use these waters for vessel access and cargo transport; this location match does not establish a port closure or refinery interruption.",
    watchSymbols: ["ADANIPORTS", "RELIANCE"],
  },
  {
    id: "taiwan-semiconductor-news",
    regions: [
      {
        name: "Taiwan",
        bbox: [119, 21, 123, 26.5],
        geographicHeadlineKeywords: ["taiwan", "taiwanese"],
      },
    ],
    categories: ["news"],
    headlineKeywords: [
      "semiconductor",
      "semiconductors",
      "chip production",
      "chip factory",
      "chip factories",
    ],
    sectors: ["Indian vehicle manufacturing"],
    ruleText:
      "A semiconductor, chip-production or chip-factory headline mentions Taiwan or has coordinates in the Taiwan watch box. Vehicle electronics use semiconductor inputs, linking this topic to Indian vehicle manufacturers; the match does not establish a supplier relationship or a supply interruption for a watch symbol.",
    watchSymbols: ["MARUTI", "TMPV", "M&M"],
  },
  {
    id: "gulf-oil-logistics-news",
    regions: [
      {
        name: "Gulf export region",
        bbox: [48, 23, 57, 30.5],
        geographicHeadlineKeywords: [
          "persian gulf",
          "strait of hormuz",
          "saudi arabia",
          "saudi",
          "united arab emirates",
          "uae",
          "iran",
          "iraq",
          "kuwait",
          "qatar",
          "oman",
        ],
      },
    ],
    categories: ["news"],
    headlineKeywords: [
      "oil export",
      "oil exports",
      "crude export",
      "crude exports",
      "oil terminal",
      "oil terminals",
      "tanker",
      "tankers",
      "oil sanctions",
      "crude sanctions",
      "oil production",
      "oil output cut",
      "oil output cuts",
      "crude output cut",
      "crude output cuts",
      "opec",
    ],
    sectors: ["Indian oil refining", "Indian petrochemicals", "Indian paints"],
    ruleText:
      "An oil-export, crude-export, oil-terminal, tanker, oil-sanctions, crude-sanctions, oil-production, oil/crude-output-cut or OPEC headline mentions a listed Gulf location or has coordinates in the Gulf watch box. Seaborne crude feeds Indian refining and petrochemical inputs used in paints; the match establishes neither a supply interruption nor an input-price change.",
    watchSymbols: ["RELIANCE", "ASIANPAINT"],
  },
  {
    id: "red-sea-shipping-news",
    regions: [
      {
        name: "Red Sea / Suez route",
        bbox: [32, 12, 44, 30],
        geographicHeadlineKeywords: ["red sea", "suez canal", "bab el mandeb", "bab al mandab"],
      },
    ],
    categories: ["news"],
    headlineKeywords: ["shipping", "freight", "tanker", "tankers", "cargo", "vessel", "vessels"],
    sectors: ["Indian ports", "Indian oil refining"],
    ruleText:
      "A shipping, freight, tanker, cargo or vessel headline mentions the Red Sea, Suez Canal or Bab el Mandeb route, or has coordinates in the Red Sea watch box. This route connects Indian maritime trade with European markets; the match does not establish a specific shipment delay, company exposure or freight-price change.",
    watchSymbols: ["ADANIPORTS", "RELIANCE"],
  },
  {
    id: "russia-crude-trade-news",
    regions: [
      { name: "Russia", geographicHeadlineKeywords: ["russia", "russian", "rosneft", "lukoil"] },
    ],
    categories: ["news"],
    headlineKeywords: [
      "oil sanctions",
      "crude sanctions",
      "oil price cap",
      "price cap",
      "oil exports",
      "crude exports",
      "oil imports",
      "crude imports",
      "tanker",
      "tankers",
      "shadow fleet",
    ],
    sectors: ["Indian oil refining"],
    ruleText:
      "An oil-sanctions, price-cap, crude-trade, tanker or shadow-fleet headline mentions Russia or a Russian oil company. Indian refiners have imported Russian seaborne crude since 2022, so restrictions on that trade concern their crude sourcing; the match establishes neither a supply interruption nor a margin change.",
    watchSymbols: ["RELIANCE"],
  },
  {
    id: "rbi-policy-rate-news",
    regions: [{ name: "India", geographicHeadlineKeywords: ["rbi", "reserve bank of india"] }],
    categories: ["news"],
    headlineKeywords: [
      "repo rate",
      "policy rate",
      "monetary policy",
      "rate decision",
      "rate cut",
      "rate cuts",
      "rate hike",
      "rate hikes",
      "interest rate",
      "interest rates",
    ],
    sectors: ["Indian banks"],
    ruleText:
      "A repo-rate, policy-rate, monetary-policy or interest-rate headline mentions the Reserve Bank of India. Indian banks link many floating-rate loans to the RBI repo rate, so policy decisions feed into their lending and deposit pricing; the match establishes neither the direction nor the size of any change.",
    watchSymbols: ["HDFCBANK", "ICICIBANK", "SBIN"],
  },
  {
    id: "us-fed-rate-news",
    regions: [
      { name: "United States", geographicHeadlineKeywords: ["federal reserve", "fed", "fomc"] },
    ],
    categories: ["news"],
    headlineKeywords: [
      "policy rate",
      "monetary policy",
      "rate decision",
      "rate cut",
      "rate cuts",
      "rate hike",
      "rate hikes",
      "interest rate",
      "interest rates",
    ],
    sectors: ["Indian IT services"],
    ruleText:
      "A policy-rate, monetary-policy or interest-rate headline mentions the US Federal Reserve or FOMC. US rate decisions influence the dollar–rupee exchange rate that converts the US-dollar revenue of Indian IT-services exporters; the match establishes neither a currency move nor an earnings change.",
    watchSymbols: ["TCS", "INFY", "HCLTECH"],
  },
];

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

function matchesHeadline(headline: string, keywords: readonly string[]): boolean {
  for (const keyword of keywords) {
    let offset = headline.indexOf(keyword);
    while (offset !== -1) {
      const end = offset + keyword.length;
      // Whole-word boundaries prevent partial-word keyword matches.
      const startsWord = offset === 0 || !WORD_CHARACTER.test(headline[offset - 1]!);
      const endsWord = end === headline.length || !WORD_CHARACTER.test(headline[end]!);
      if (startsWord && endsWord) return true;
      offset = headline.indexOf(keyword, offset + 1);
    }
  }
  return false;
}

/** Event order, then rule order; at most one matching region per event/rule pair. */
export function matchExposure(events: readonly WorldEvent[]): ExposureMatch[] {
  const matches: ExposureMatch[] = [];
  for (const event of events) {
    const headline = event.title.toLowerCase();
    // News country can identify the publisher rather than the event location.
    const country =
      event.category !== "news" && event.source !== "GDELT"
        ? event.country?.trim().toUpperCase()
        : undefined;
    const coordinates = event.coordinates;
    for (const rule of EXPOSURE_RULES) {
      if (!rule.categories.includes(event.category)) continue;
      if (rule.headlineKeywords && !matchesHeadline(headline, rule.headlineKeywords)) continue;
      for (const region of rule.regions) {
        const box = region.bbox;
        const countryMatches = country !== undefined && region.countries?.includes(country);
        const headlineMatches =
          region.geographicHeadlineKeywords !== undefined &&
          matchesHeadline(headline, region.geographicHeadlineKeywords);
        const boxMatches =
          box !== undefined &&
          coordinates !== undefined &&
          coordinates.longitude >= box[0] &&
          coordinates.longitude <= box[2] &&
          coordinates.latitude >= box[1] &&
          coordinates.latitude <= box[3];
        if (!countryMatches && !boxMatches && !headlineMatches) continue;
        matches.push({
          event,
          ruleId: rule.id,
          region: region.name,
          sectors: rule.sectors,
          ruleText: rule.ruleText,
          watchSymbols: rule.watchSymbols,
        });
        break;
      }
    }
  }
  return matches;
}
