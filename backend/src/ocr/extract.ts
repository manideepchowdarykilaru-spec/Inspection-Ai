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

/** Lines that can never be the commodity name: running text, companies, claims, contacts. */
const NOT_A_NAME =
  /\b(?:ltd|limited|pvt|llp|inc|made in|certified|gmp|iso|e-?mail|website|www\.|\.com|toll|free|regd|office|directions|composition|ingredients|derived|contains|read the|see below|for name|batch|expiry|mfd|mfg|lic\.?\s*no|plot|distt|road|nagar|p\.?o\.?)\b/i;

function nameLike(text: string): boolean {
  const words = text.trim().split(/\s+/);
  const letters = text.replace(/[^a-z]/gi, '').length;
  return (
    text.length >= 3 &&
    text.length <= 48 &&
    words.length <= 7 &&
    letters >= text.length * 0.5 &&
    !/[:;@]/.test(text) &&
    !CAPTION_LIKE.test(text) &&
    !QUANTITY.test(text) &&
    !PRICE.test(text) &&
    !DATE_LIKE.test(text) &&
    !NOT_A_NAME.test(text)
  );
}

function readProductIdentity(segments: Segment[], imageHeight: number): FieldHit | undefined {
  // The name is normally in the top part of an upright panel; on a carton read
  // sideways it can sit anywhere, so the position preference is soft.
  const nameLines = segments.filter((s) => nameLike(s.text));
  const upper = nameLines.filter((s) => s.bbox.y1 < imageHeight * 0.42);
  const candidates = (upper.length ? upper : nameLines).sort((a, b) => b.capHeightPx - a.capHeightPx);

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

  let chosen = looksLikeBrandMark ? second : largest;

  // A lone brand word ("Dabur") is the logo, not the commodity, when another
  // line of similar size names the product with that brand in it.
  if (!/\s/.test(chosen.text.trim())) {
    const fuller = candidates.find(
      (c) =>
        c !== chosen &&
        /\s/.test(c.text.trim()) &&
        c.capHeightPx >= chosen.capHeightPx * 0.6 &&
        c.text.toLowerCase().includes(chosen.text.trim().toLowerCase()),
    );
    if (fuller) chosen = fuller;
  }

  // Names wrap: a same-size name-like line directly below continues the name.
  const used = [chosen];
  const next = segmentBelow(segments, chosen, { maxGapPx: 50, minOverlap: 0.2 });
  if (
    next &&
    nameLike(next.text) &&
    Math.abs(next.capHeightPx - chosen.capHeightPx) <= chosen.capHeightPx * 0.25 &&
    !CORPORATE.test(next.text)
  ) {
    used.push(next);
  }
  return {
    value: used.map((u) => u.text.trim()).join(' '),
    segments: used,
    confidence: meanConfidence(used),
  };
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
        const amount = Number((m[0].match(/\d[\d,]*(?:\.\d{1,2})?/)?.[0] ?? '').replace(/,/g, ''));
        const captioned = /\bmrp\b|₹|\brs\.?\b|\binr\b/i.test(m[0]) || /\bmrp\b/i.test(seg.text);
        // A bare decimal only counts on a short line of its own — "31.04 g" inside
        // a composition sentence is a weight, and a number followed by a unit never is.
        const after = seg.text.slice((m.index ?? 0) + m[0].length);
        const unitFollows = /^\s*(?:mg|g|gm|gms|kg|ml|l|ltr|%)\b/i.test(after);
        const plausible = !unitFollows && (captioned || seg.text.trim().length <= 20);
        return { seg, text: m[0], amount, plausible, rank: (captioned ? 1_000_000 : 0) + amount };
      })
      .filter((c) => c.plausible && Number.isFinite(c.amount) && c.amount > 0)
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
    const amountOnly = hit.value.replace(caption, '').trim();
    const isCaptionLine = caption.test(qualifier.text);
    return {
      value: isCaptionLine
        ? `${qualifier.text.match(caption)![0]} ${amountOnly} (incl. of all taxes)`
        : `${hit.value} ${qualifier.text}`.trim(),
      segments: hit.segments.includes(qualifier) ? hit.segments : [...hit.segments, qualifier],
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

/** "BD) DABUR INDIA LTD., Vill. …" — multi-unit cartons key each unit by a short code. */
const UNIT_CODE = /^\s*([A-Z0-9]{1,3})\)\s*/;

function readManufacturer(segments: Segment[], batchCode?: string): FieldHit | undefined {
  const byLabel = byCaption(segments, {
    caption:
      /\b(?:manufactured\s*(?:&|and)?\s*packed\s*by|manufactured\s*by|packed\s*by|marketed\s*by|mfd\.?\s*by|manufacturer|mfg\.?\s*by)\b/i,
    maxGapPx: 90,
  });
  if (byLabel) return byLabel;

  // Uncaptioned: lines naming a corporate entity that are not the consumer-care block.
  const entities = segments.filter(
    (seg) => CORPORATE.test(seg.text) && !/consumer|care|cares|toll|helpline|e-?mail/i.test(seg.text),
  );
  if (entities.length === 0) return undefined;

  // "For name & address of Mfg. unit, read the first two characters of the batch
  // code": when the batch code starts with a unit code printed on the panel,
  // that unit is the manufacturer of this very pack.
  const prefix = batchCode?.match(/^([A-Z]{1,3})/i)?.[1]?.toUpperCase();
  const keyed = prefix
    ? entities.find((seg) => seg.text.match(UNIT_CODE)?.[1]?.toUpperCase() === prefix)
    : undefined;
  const entity = keyed ?? entities[0];

  // Stop at the start of an address so the name stands alone.
  const stripped = entity.text.replace(UNIT_CODE, '');
  const corporateAt = stripped.search(CORPORATE);
  const commaAfter = corporateAt >= 0 ? stripped.indexOf(',', corporateAt) : -1;
  const name = (commaAfter > 0 ? stripped.slice(0, commaAfter) : stripped)
    .split(/,\s*(?=(?:vill|plot|p\.?o\.?|sy\.?|unit|shed|sector|i\.?g\.?c|no\.?\s*\d|\d))/i)[0]
    .replace(/\s*\((?:unit|plant)[^)]*\)\s*$/i, '')
    .trim();
  return { value: name || entity.text, segments: [entity], confidence: entity.confidence };
}

function readAddress(segments: Segment[], manufacturer?: FieldHit): FieldHit | undefined {
  if (!manufacturer) {
    return byPattern(segments, /.+/, (s) => PIN_CODE.test(s.text));
  }
  // Cartons often run the name and address together on one line — and on to
  // the next when the address is long. Start after the name and continue
  // downward until a PIN code closes the address.
  const anchor = manufacturer.segments[manufacturer.segments.length - 1];
  const collected: Segment[] = [];
  const stripped = anchor.text.replace(UNIT_CODE, '');
  const at = stripped.indexOf(manufacturer.value);
  const afterName = at >= 0 ? stripped.slice(at + manufacturer.value.length) : '';
  const inlineAddress = afterName
    .replace(/^\s*\((?:unit|plant)[^)]*\)/i, '')
    .replace(/^[\s,.\-–]+/, '')
    .replace(/\s*mfg\.?\s*lic.*$/i, '')
    .trim();
  if (inlineAddress.length > 8) {
    if (PIN_CODE.test(inlineAddress.replace(/\s/g, ''))) {
      return { value: inlineAddress, segments: [anchor], confidence: anchor.confidence };
    }
    let cursor: Segment | undefined = anchor;
    const parts = [inlineAddress];
    const used = [anchor];
    for (let i = 0; i < 3 && cursor; i++) {
      const next: Segment | undefined = segmentBelow(segments, cursor, { maxGapPx: 70, minOverlap: 0.2 });
      if (!next || UNIT_CODE.test(next.text) || CAPTION_LIKE.test(next.text)) break;
      parts.push(next.text.replace(/\s*mfg\.?\s*lic.*$/i, '').trim());
      used.push(next);
      if (PIN_CODE.test(next.text.replace(/\s/g, ''))) break;
      cursor = next;
    }
    return { value: parts.filter(Boolean).join(' '), segments: used, confidence: meanConfidence(used) };
  }
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

const CONTACT_LINE = /toll|free|1800|helpline|e-?mail|website|www\.|\.com\b|\.in\b|call|write|cell|desk/i;
const ADDRESS_LINE = /\b(?:road|street|marg|nagar|house|office|park|estate|plot|floor|sector|p\.?o\.?|distt|pin)\b|\b\d{6}\b/i;

function readConsumerCare(segments: Segment[]): FieldHit | undefined {
  // Most specific caption first: "Consumer Care", "Dabur Cares", "For complaints",
  // then a bare helpline / toll-free line.
  const captions = [
    /\b(?:consumer\s*(?:care|cell|complaints?|service)|customer\s*(?:care|service|support))\b/i,
    /\b(?:\w+\s+cares|for\s*(?:any\s*)?complaints?|feedback|call\s*or\s*write)\b/i,
    /\b(?:helpline|toll[\s-]*free)\b/i,
  ];
  let caption: RegExp | undefined;
  let captionSegment: Segment | undefined;
  for (const c of captions) {
    captionSegment = segments.find((s) => c.test(s.text));
    if (captionSegment) { caption = c; break; }
  }
  if (!captionSegment || !caption) {
    // Some labels print only the contact details.
    const contact = segments.filter((s) => EMAIL.test(s.text) || /toll|1800/i.test(s.text));
    if (contact.length === 0) return undefined;
    return { value: joinSegments(contact), segments: contact, confidence: meanConfidence(contact) };
  }

  const collected: Segment[] = [];
  const inline = inlineRemainder(captionSegment, caption);
  if (inline || PHONE.test(captionSegment.text) || EMAIL.test(captionSegment.text)) collected.push(captionSegment);

  let cursor = captionSegment;
  for (let i = 0; i < 6; i++) {
    const next = segmentBelow(segments, cursor, { maxGapPx: 70, minOverlap: 0.15 });
    if (!next) break;
    // The company name inside the block ("Consumer Cell, Shakti Agro Mills Pvt. Ltd.") belongs to it.
    const isContact =
      PHONE.test(next.text) || EMAIL.test(next.text) || CONTACT_LINE.test(next.text) || CORPORATE.test(next.text);
    const isAddress = ADDRESS_LINE.test(next.text);
    const otherCaption = CAPTION_LIKE.test(next.text) && !/consumer|customer/i.test(next.text);
    if (otherCaption && !isContact) break;
    // The first line under the caption is taken on trust; later ones must look like contact details.
    if (!isContact && !isAddress && i > 0) break;
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
    accept: new RegExp(`${DATE_LIKE.source}|\\b\\d{1,2}\\s*(?:months?|years?|days?)\\b`, 'i'),
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

const COUNTRIES = new Set(
  [
    'india', 'china', 'usa', 'uk', 'uae', 'sri lanka', 'nepal', 'bangladesh', 'bhutan', 'pakistan', 'thailand',
    'malaysia', 'indonesia', 'vietnam', 'singapore', 'japan', 'korea', 'south korea', 'taiwan', 'italy', 'germany',
    'france', 'spain', 'netherlands', 'belgium', 'switzerland', 'austria', 'poland', 'turkey', 'australia',
    'new zealand', 'canada', 'mexico', 'brazil', 'argentina', 'chile', 'egypt', 'kenya', 'south africa',
    'saudi arabia', 'oman', 'qatar', 'iran', 'russia', 'ukraine', 'ireland', 'denmark', 'sweden', 'norway',
    'finland', 'greece', 'portugal', 'philippines', 'myanmar', 'cambodia', 'hong kong',
  ],
);

function readCountry(segments: Segment[]): FieldHit | undefined {
  const byLabel = byCaption(segments, {
    caption: /\bcountry\s*of\s*origin\b/i,
    accept: /[a-z]{3,}/i,
    maxGapPx: 90,
  });
  if (byLabel) return byLabel;
  // "Made in India", "Product of Sri Lanka", "Manufactured in India".
  const made = /\b(?:made|manufactured|produced|product|packed)\s+(?:in|of)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i;
  for (const seg of segments) {
    const m = seg.text.match(made);
    if (!m) continue;
    const words = m[1].split(/\s+/);
    const candidate = [words.slice(0, 2).join(' '), words[0]].find((w) => COUNTRIES.has(w.toLowerCase()));
    if (candidate) {
      const country = candidate.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
      return { value: /^u/i.test(country) && country.length <= 3 ? country.toUpperCase() : country, segments: [seg], confidence: seg.confidence };
    }
  }
  return undefined;
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

/** A short alphanumeric code such as "RU3743 L8B" or "SG-2607-D12". */
const BATCH_CODE = /^[A-Z]{1,3}[\s\-–—]?\d{3,6}(?:[\s\-–—]?[A-Z0-9]{1,5}){0,2}[.,]?$/i;

function readBatch(segments: Segment[]): FieldHit | undefined {
  const captioned = byCaption(segments, {
    caption: /\b(?:batch\s*(?:no\.?|number|code)?|lot\s*(?:no\.?|number)?|b\.?\s*no\.?)\b/i,
    // A code: has a digit, at most four tokens, and no word of four or more
    // lower-case letters (which is how "batch code & see below" is told apart).
    // Tokens may start with a misread symbol ("$G-2607-D12" for "SG-2607-D12").
    accept: /^(?=.*\d)(?!.*\b[a-z]{4,}\b)\S+(?:\s+\S+){0,3}\s*$/,
    maxGapPx: 90,
  });
  if (captioned) return captioned;

  // Caption-free fallback. Batch codes are usually dot-matrix printed at
  // packing time, often in a different orientation from their caption, so the
  // caption→value link is frequently broken in a photograph. A lone code that
  // is not a date, price, quantity or a long numeric run (barcode, licence) is
  // accepted at reduced confidence.
  const candidates = segments.filter((s) => {
    const t = s.text.trim();
    return (
      BATCH_CODE.test(t) &&
      !DATE_LIKE.test(t) &&
      !PRICE.test(t) &&
      !QUANTITY.test(t) &&
      !/^\d+$/.test(t.replace(/[\s-]/g, ''))
    );
  });
  if (candidates.length === 0) return undefined;
  const top = [...candidates].sort((a, b) => b.confidence - a.confidence)[0];
  return { value: top.text.trim(), segments: [top], confidence: Math.min(top.confidence, 0.7) };
}

export function extractFields(
  segments: Segment[],
  imageHeight: number,
): Partial<Record<DeclarationKey, FieldHit>> {
  const batch = readBatch(segments);
  const manufacturer = readManufacturer(segments, batch?.value);
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
    BATCH_NUMBER: batch,
  };

  Object.keys(fields).forEach((key) => {
    const hit = fields[key as DeclarationKey];
    if (!hit || !hit.value.trim()) delete fields[key as DeclarationKey];
  });

  return fields;
}
