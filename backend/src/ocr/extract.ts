import type { DeclarationKey } from '@shared/types';
import { segmentBelow, type Segment } from './segments';

/**
 * Declaration extraction from real OCR output.
 *
 * Each declaration is located by a caption keyword and then read either inline
 * (value follows the caption on the same segment) or from the segment directly
 * below it in the same column. A pattern-only fallback catches labels that print
 * the value without a caption — "500 g" on its own, for instance.
 *
 * Every hit keeps the segments it came from, so the evidence region drawn on the
 * image is the actual pixel area the text was read from.
 */

export interface FieldHit {
  value: string;
  segments: Segment[];
  confidence: number;
}

const CAPTION_LIKE =
  /^(net|maximum|mrp|manufactured|packed|marketed|imported|consumer|customer|country|batch|lot|best|month|date|fssai|barcode|ingredients|nutritional)/i;

const PIN_CODE = /\b\d{6}\b/;
const PHONE = /(?:\+?\d[\d\s-]{8,})/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const QUANTITY = /\b\d+(?:\.\d+)?\s*(?:mg|g|gm|gms|kg|ml|l|ltr|litre|litres|n|pcs|pieces)\b/i;
const DATE_LIKE =
  /\b(?:(?:0?[1-9]|1[0-2])[/\-.](?:20)?\d{2}|(?:0?[1-9]|[12]\d|3[01])[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:20)?\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*,?\s*(?:20)?\d{2})\b/i;
const PRICE = /(?:₹|rs\.?|inr)\s*\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*\.\d{2}\b/i;

function joinSegments(segments: Segment[]): string {
  return segments
    .map((s) => s.text)
    .join(', ')
    .replace(/\s*,\s*,+/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function meanConfidence(segments: Segment[]): number {
  if (segments.length === 0) return 0;
  return segments.reduce((sum, s) => sum + s.confidence, 0) / segments.length;
}

/** Strips a caption prefix, returning whatever the segment says after it. */
function inlineRemainder(segment: Segment, caption: RegExp): string {
  const match = segment.text.match(caption);
  if (!match) return '';
  return segment.text
    .slice((match.index ?? 0) + match[0].length)
    .replace(/^[\s:.\-–—]+/, '')
    .trim();
}

interface CaptionSpec {
  caption: RegExp;
  /** Value must satisfy this to be accepted. */
  accept?: RegExp;
  maxGapPx?: number;
  /** Additional segments pulled in below the value (address blocks, contacts). */
  continuation?: (segment: Segment, index: number) => boolean;
  maxContinuation?: number;
}

function byCaption(segments: Segment[], spec: CaptionSpec): FieldHit | undefined {
  const captionSegments = segments.filter((s) => spec.caption.test(s.text));

  for (const caption of captionSegments) {
    const used: Segment[] = [];
    let value = inlineRemainder(caption, spec.caption);

    if (value && (!spec.accept || spec.accept.test(value))) {
      used.push(caption);
    } else {
      const below = segmentBelow(segments, caption, {
        maxGapPx: spec.maxGapPx ?? 90,
        skip: (s) => (spec.accept ? !spec.accept.test(s.text) && CAPTION_LIKE.test(s.text) : false),
      });
      if (!below) continue;
      if (spec.accept && !spec.accept.test(below.text)) continue;
      value = below.text;
      used.push(below);
    }

    if (spec.continuation) {
      let cursor = used[used.length - 1];
      for (let i = 0; i < (spec.maxContinuation ?? 3); i++) {
        const next = segmentBelow(segments, cursor, { maxGapPx: 60, minOverlap: 0.2 });
        if (!next || !spec.continuation(next, i)) break;
        used.push(next);
        cursor = next;
      }
    }

    return {
      value: joinSegments(used.length === 1 && used[0] === caption ? [] : used) || value,
      segments: used.length ? used : [caption],
      confidence: meanConfidence(used.length ? used : [caption]),
    };
  }
  return undefined;
}

function byPattern(segments: Segment[], pattern: RegExp, filter?: (s: Segment) => boolean): FieldHit | undefined {
  const hit = segments.find((s) => pattern.test(s.text) && (filter?.(s) ?? true));
  if (!hit) return undefined;
  const match = hit.text.match(pattern);
  return {
    value: match ? match[0].trim() : hit.text,
    segments: [hit],
    confidence: hit.confidence,
  };
}

/* --------------------------------------------------------- Field readers */

function readProductIdentity(segments: Segment[], imageHeight: number): FieldHit | undefined {
  const candidates = segments
    .filter(
      (s) =>
        s.bbox.y1 < imageHeight * 0.42 &&
        s.text.length >= 3 &&
        !CAPTION_LIKE.test(s.text) &&
        !QUANTITY.test(s.text) &&
        !PRICE.test(s.text) &&
        /[a-z]/i.test(s.text),
    )
    .sort((a, b) => b.capHeightPx - a.capHeightPx);

  if (candidates.length === 0) return undefined;

  /*
   * On most Indian packages the brand is set larger than the commodity name —
   * "SHAKTI GOLD" above "Toor Dal (Arhar)". When the largest line is markedly
   * bigger and set in capitals, it reads as the brand mark, so the commodity
   * name is the next most prominent line.
   */
  const [largest, second] = candidates;
  const looksLikeBrandMark =
    second !== undefined &&
    largest.capHeightPx > second.capHeightPx * 1.25 &&
    largest.text === largest.text.toUpperCase();

  const chosen = looksLikeBrandMark ? second : largest;
  return { value: chosen.text, segments: [chosen], confidence: chosen.confidence };
}

function readMrp(segments: Segment[]): FieldHit | undefined {
  const caption = /\b(?:m\.?\s?r\.?\s?p\.?|maximum retail price|retail sale price|max\.? retail price)\b/i;
  let hit = byCaption(segments, { caption, accept: /\d/, maxGapPx: 90 });
  if (!hit) {
    // No caption in this orientation: take the largest price-looking amount
    // that is not a per-unit figure — "₹0.73 per g" sits beside the MRP on
    // many cartons and must not win.
    const candidates = segments
      .filter((seg) => PRICE.test(seg.text) && !/\bper\s*(?:g|kg|ml|l|unit|pc|piece)\b/i.test(seg.text))
      .map((seg) => {
        const m = seg.text.match(PRICE)!;
        const amount = Number(m[0].replace(/[^\d.]/g, ''));
        const captioned = /\bmrp\b|₹|\brs\b/i.test(seg.text);
        return { seg, text: m[0], amount, rank: (captioned ? 1_000_000 : 0) + amount };
      })
      .filter((c) => Number.isFinite(c.amount) && c.amount > 0)
      .sort((a, b) => b.rank - a.rank);
    if (candidates.length === 0) return undefined;
    const top = candidates[0];
    hit = { value: top.text.trim(), segments: [top.seg], confidence: top.seg.confidence };
  }

  // Pull in an adjacent "inclusive of all taxes" qualifier so the formatting
  // rule can see it — labels usually print it on its own line.
  const anchor = hit.segments[hit.segments.length - 1];
  const qualifier = segments.find(
    (s) =>
      /incl.*tax|inclusive of all taxes/i.test(s.text) &&
      Math.abs(s.bbox.y0 - anchor.bbox.y1) < 90,
  );
  if (qualifier && !/incl/i.test(hit.value)) {
    return {
      value: `${hit.value} ${qualifier.text}`.trim(),
      segments: [...hit.segments, qualifier],
      confidence: Math.min(hit.confidence, qualifier.confidence),
    };
  }
  // Keep the caption in the value so the format rule can test for the prefix.
  const captionSegment = segments.find((s) => caption.test(s.text));
  if (captionSegment && !caption.test(hit.value)) {
    return { ...hit, value: `${captionSegment.text.match(caption)![0]} ${hit.value}`.trim() };
  }
  return hit;
}

function readNetQuantity(segments: Segment[]): FieldHit | undefined {
  const byLabel = byCaption(segments, {
    caption: /\bnet\s*(?:qty|quantity|wt\.?|weight|content|contents|vol\.?|volume)\b/i,
    accept: /\d/,
    maxGapPx: 90,
  });
  if (byLabel) return byLabel;

  // Uncaptioned: "300g" beside "200g + 100g" — the total is the largest amount.
  const toBase = (n: number, unit: string) => (/^(?:kg|l|ltr|litres?)$/i.test(unit) ? n * 1000 : n);
  const candidates = segments
    .filter((seg) => !PRICE.test(seg.text) && !/\bper\b/i.test(seg.text))
    .flatMap((seg) =>
      Array.from(seg.text.matchAll(/(\d+(?:\.\d+)?)\s*(mg|g|gm|gms|kg|ml|l|ltr|litres?|n|pcs|pieces)\b/gi)).map(
        (m) => ({ seg, text: m[0], base: toBase(Number(m[1]), m[2]) }),
      ),
    )
    .sort((a, b) => b.base - a.base);
  if (candidates.length === 0) return undefined;
  const top = candidates[0];
  return { value: top.text.trim(), segments: [top.seg], confidence: top.seg.confidence };
}

const CORPORATE = /\b(?:ltd|limited|pvt|private|llp|inc|industries|foods|mills|co)\b\.?/i;

function readManufacturer(segments: Segment[]): FieldHit | undefined {
  const byLabel = byCaption(segments, {
    caption:
      /\b(?:manufactured\s*(?:&|and)?\s*packed\s*by|manufactured\s*by|packed\s*by|marketed\s*by|mfd\.?\s*by|manufacturer|mfg\.?\s*by)\b/i,
    maxGapPx: 90,
  });
  if (byLabel) return byLabel;
  // Uncaptioned: the first line naming a corporate entity that is not the
  // consumer-care block.
  const entity = segments.find(
    (seg) => CORPORATE.test(seg.text) && !/consumer|care|cares|toll|helpline|e-?mail/i.test(seg.text),
  );
  if (!entity) return undefined;
  // Stop at the start of an address so the name stands alone.
  const name = entity.text
    .split(/,\s*(?=(?:vill|plot|p\.?o\.?|sy\.?|unit|shed|sector|no\.?\s*\d|\d))/i)[0]
    .trim();
  return { value: name || entity.text, segments: [entity], confidence: entity.confidence };
}

function readAddress(segments: Segment[], manufacturer?: FieldHit): FieldHit | undefined {
  if (!manufacturer) {
    return byPattern(segments, /.+/, (s) => PIN_CODE.test(s.text));
  }
  // Cartons often run the name and address together on one line.
  const inline = manufacturer.segments.find((seg) => PIN_CODE.test(seg.text.replace(/\s/g, '')));
  if (inline) {
    const at = inline.text.indexOf(manufacturer.value);
    const afterName = at >= 0 ? inline.text.slice(at + manufacturer.value.length) : inline.text;
    const address = afterName.replace(/^[\s,.\-–]+/, '').trim();
    if (address.length > 8) return { value: address, segments: [inline], confidence: inline.confidence };
  }
  const anchor = manufacturer.segments[manufacturer.segments.length - 1];
  const collected: Segment[] = [];
  let cursor = anchor;
  for (let i = 0; i < 4; i++) {
    const next = segmentBelow(segments, cursor, { maxGapPx: 70, minOverlap: 0.2 });
    if (!next || CAPTION_LIKE.test(next.text)) break;
    collected.push(next);
    cursor = next;
    if (PIN_CODE.test(next.text)) break;
  }
  if (collected.length === 0) return undefined;
  return {
    value: joinSegments(collected),
    segments: collected,
    confidence: meanConfidence(collected),
  };
}

function readConsumerCare(segments: Segment[]): FieldHit | undefined {
  const caption =
    /\b(?:consumer\s*(?:care|cell|complaints?|service)|customer\s*(?:care|service)|for\s*(?:any\s*)?complaints?|helpline|toll[\s-]*free)\b/i;
  const captionSegment = segments.find((s) => caption.test(s.text));
  if (!captionSegment) {
    // Some labels print only the contact details.
    const contact = segments.filter((s) => EMAIL.test(s.text) || /toll|1800/i.test(s.text));
    if (contact.length === 0) return undefined;
    return { value: joinSegments(contact), segments: contact, confidence: meanConfidence(contact) };
  }

  const collected: Segment[] = [];
  const inline = inlineRemainder(captionSegment, caption);
  if (inline) collected.push(captionSegment);

  let cursor = captionSegment;
  for (let i = 0; i < 4; i++) {
    const next = segmentBelow(segments, cursor, { maxGapPx: 70, minOverlap: 0.15 });
    if (!next) break;
    const isContact =
      PHONE.test(next.text) || EMAIL.test(next.text) || /toll|free|ltd|pvt|cell|desk/i.test(next.text);
    if (!isContact && CAPTION_LIKE.test(next.text)) break;
    if (!isContact && i > 0) break;
    collected.push(next);
    cursor = next;
  }

  if (collected.length === 0) return undefined;
  return {
    value: joinSegments(collected),
    segments: collected,
    confidence: meanConfidence(collected),
  };
}

const MONTH_YEAR = /\b(0?[1-9]|1[0-2])[/\-.](20\d{2})\b/g;

/**
 * Every month/year token on the label with a sortable key. Used when the
 * captions are missing, illegible, or — as on many cartons — printed in a
 * different orientation from the values they label.
 */
function allDates(segments: Segment[]): { value: string; segment: Segment; key: number }[] {
  const hits: { value: string; segment: Segment; key: number }[] = [];
  for (const segment of segments) {
    for (const m of segment.text.matchAll(MONTH_YEAR)) {
      hits.push({ value: m[0], segment, key: Number(m[2]) * 12 + Number(m[1]) });
    }
  }
  return hits.sort((a, b) => a.key - b.key);
}

function readPackingDate(segments: Segment[]): FieldHit | undefined {
  const byLabel = byCaption(segments, {
    caption:
      /\b(?:month\s*(?:&|and)?\s*year\s*of\s*(?:packing|manufacture)|date\s*of\s*(?:packing|manufacture)|packed\s*on|mfg\.?\s*date|mfd\.?\s*date|pkd\.?\s*on|packing\s*date|mfd\.?|mfg\.?)\b/i,
    accept: DATE_LIKE,
    maxGapPx: 90,
  });
  if (byLabel) return byLabel;
  // Uncaptioned: the earliest month/year on the pack is the packing date.
  const first = allDates(segments)[0];
  if (!first) return undefined;
  return {
    value: first.value,
    segments: [first.segment],
    // Inferred from ordering rather than read against a caption.
    confidence: Math.min(first.segment.confidence, 0.8),
  };
}

function readBestBefore(segments: Segment[]): FieldHit | undefined {
  const byLabel = byCaption(segments, {
    caption: /\b(?:best\s*before|use\s*by|expiry\s*date|exp\.?\s*date|best\s*before\s*end|expiry|exp\.?)\b/i,
    maxGapPx: 90,
  });
  if (byLabel) return byLabel;
  // Uncaptioned: a later month/year than the packing date is the expiry.
  const dates = allDates(segments);
  const distinct = dates.filter((d, i, arr) => i === 0 || d.key !== arr[i - 1].key);
  if (distinct.length < 2) return undefined;
  const last = distinct[distinct.length - 1];
  return {
    value: last.value,
    segments: [last.segment],
    confidence: Math.min(last.segment.confidence, 0.8),
  };
}

function readCountry(segments: Segment[]): FieldHit | undefined {
  return byCaption(segments, {
    caption: /\bcountry\s*of\s*origin\b/i,
    accept: /[a-z]{3,}/i,
    maxGapPx: 90,
  });
}

function readImporter(segments: Segment[]): FieldHit | undefined {
  return byCaption(segments, {
    caption: /\b(?:imported\s*(?:&|and)?\s*(?:marketed)?\s*by|importer)\b/i,
    maxGapPx: 90,
    continuation: (s) => !CAPTION_LIKE.test(s.text),
    maxContinuation: 2,
  });
}

function readFssai(segments: Segment[]): FieldHit | undefined {
  return (
    byCaption(segments, { caption: /\bfssai[a-z. ]*(?:lic\.?\s*no\.?)?\b/i, accept: /\d{8,}/, maxGapPx: 90 }) ??
    byPattern(segments, /\b\d{14}\b/)
  );
}

function readBatch(segments: Segment[]): FieldHit | undefined {
  return byCaption(segments, {
    caption: /\b(?:batch\s*(?:no\.?|number)?|lot\s*(?:no\.?|number)?|b\.?\s*no\.?)\b/i,
    accept: /[a-z0-9]/i,
    maxGapPx: 90,
  });
}

export function extractFields(
  segments: Segment[],
  imageHeight: number,
): Partial<Record<DeclarationKey, FieldHit>> {
  const manufacturer = readManufacturer(segments);
  const fields: Partial<Record<DeclarationKey, FieldHit>> = {
    PRODUCT_IDENTITY: readProductIdentity(segments, imageHeight),
    MANUFACTURER_NAME: manufacturer,
    MANUFACTURER_ADDRESS: readAddress(segments, manufacturer),
    NET_QUANTITY: readNetQuantity(segments),
    MRP: readMrp(segments),
    CONSUMER_CARE: readConsumerCare(segments),
    DATE_OF_PACKING: readPackingDate(segments),
    BEST_BEFORE: readBestBefore(segments),
    COUNTRY_OF_ORIGIN: readCountry(segments),
    IMPORTER_DETAILS: readImporter(segments),
    FSSAI_LICENSE: readFssai(segments),
    BATCH_NUMBER: readBatch(segments),
  };

  Object.keys(fields).forEach((key) => {
    const hit = fields[key as DeclarationKey];
    if (!hit || !hit.value.trim()) delete fields[key as DeclarationKey];
  });

  return fields;
}
