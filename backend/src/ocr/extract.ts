import type { DeclarationKey } from '@shared/types';
import { segmentBelow, type Segment } from './segments';
import type { LineTag } from './nlp/classifier';

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

const PIN_CODE = /\b\d{3}\s?\d{3}\b/;
/** "MRP", "M.R.P.", "MRPR" / "MRP?" (a rupee sign misread and glued on), "Maximum Retail Price". */
const MRP_CAPTION = /\b(?:m\.?\s?r\.?\s?p\.?(?:\s?[R₹?=])?(?![A-Za-z])|maximum\s*retail\s*price|retail\s*sale\s*price|max\.?\s*retail\s*price)/i;
/** Cuts a manufacturer line at the end of its corporate suffix: "Marico Ltd. 7th Floor …" → "Marico Ltd.". */
function trimToCorporate(name: string): string {
  const m = name.match(/^(.*?\b(?:pvt\.?\s*ltd|private\s+limited|ltd|limited|llp|inc|corporation|company|co)\b\.?)(?=[\s,;(]|$)/i);
  return m ? m[1].trim() : name;
}
const PHONE = /(?:\+?\d[\d\s-]{8,})/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const QUANTITY = /\b\d+(?:\.\d+)?\s*(?:mg|g|gm|gms|kg|ml|l|ltr|litre|litres|n|pcs|pieces)\b/i;
const DATE_LIKE =
  /\b(?:(?:0?[1-9]|1[0-2])[/\-.](?:20)?\d{2}|(?:0?[1-9]|[12]\d|3[01])[/\-.](?:0?[1-9]|1[0-2])[/\-.](?:20)?\d{2}|(?:\d{1,2}\s*)?(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6}\.?[\s/\-.,]*(?:20)?\d{2})\b/i;
/** "02JUN2026", "MAY/2026", "July 2026": day optional, month by name, two- or four-digit year. */
const MONTH_NAME_DATE = /\b(?:(\d{1,2})\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6}\.?[\s/\-.,]*((?:20)?\d{2})\b/gi;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const PRICE = /(?:₹|rs\.?|inr)\s*\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*\.\d{2}\b/i;
/**
 * Every way an amount is printed or misread on a pack: "₹150", "Rs. 62.00",
 * "?150" / "=150" / "Z150" (OCR for ₹), and "132/-". Returns the amounts with
 * how they were marked; a per-unit figure ("₹0.73 per g") is excluded.
 */
/**
 * The rupee sign is the glyph recognisers misread most: "7", "R", "Z", "F", "T",
 * "?" or "=" — "MRP 7 62.00", "R 220.00". A lone such character standing
 * before an amount is the sign, and is rewritten as one so every amount
 * reader sees "₹ 62.00".
 */
function fixRupeeMisreads(text: string): string {
  return text
    // Directly after the MRP caption: any single stray character before the figure.
    .replace(/(\bm\.?\s?r\.?\s?p\.?\s*[:.\-–—]?\s*)[7RZFT?=](?=\s+\d)/gi, '$1₹')
    .replace(/(\bm\.?\s?r\.?\s?p\.?\s*[:.\-–—]?\s*)[RZFT?=](?=\d)/gi, '$1₹')
    // Anywhere: a lone 7/R/Z/F/T before an amount with paise.
    .replace(/(^|[\s(])[7RZFT]\s+(?=\d{1,5}[.,]\d{2}\b)/g, '$1₹ ');
}

const AMOUNT_ANY =
  /(?:(₹|\brs\.?|\binr|[?=€¥£])\s?(\d{1,5}(?:[.,]\d{1,2})?)(?![A-Za-z0-9])(?!\s*(?:g|kg|ml|l|mg|%)\b)|\b(\d{1,5}(?:\.\d{2})?)\s*\/-)/gi;
/** "per g", "/teabag", "per 100 g": a unit sale price, never the MRP. */
const PER_UNIT = /^\s*(?:\(?\s*(?:per|\/)\s*(?:\d+\s*)?(?:g|gm|kg|ml|l|ltr|n|unit|pc|piece|tablet|teabag|sachet|pack|pull|sheet|each)\b|per\b)/i;

function amountsIn(rawText: string, lenient = false): { amount: number; text: string; marked: 'rupee' | 'slash' }[] {
  const text = fixRupeeMisreads(rawText);
  const out: { amount: number; text: string; marked: 'rupee' | 'slash' }[] = [];
  for (const m of text.matchAll(AMOUNT_ANY)) {
    const raw = (m[2] ?? m[3]).replace(',', '.');
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount < 1) continue;
    if (PER_UNIT.test(text.slice((m.index ?? 0) + m[0].length))) continue;
    const decimals = /[.,]\d{2}$/.test(raw.replace(',', '.'));
    const genuineMark = m[1] ? /^(?:₹|rs|inr)/i.test(m[1]) : false;
    // "?", "=", "€" stand in for a misread ₹ only when paise follow ("=150.00");
    // a lone "=1" or "?8" is punctuation and a stray digit.
    if (m[1] && !genuineMark && !decimals && !(lenient && amount >= 10)) continue;
    // A genuine ₹ before a single digit with no paise is almost always a fragment ("₹ 9" of "₹ 92.00").
    if (m[1] && genuineMark && !decimals && amount < 10) continue;
    out.push({ amount, text: m[0].trim(), marked: m[1] ? 'rupee' : 'slash' });
  }
  return out;
}

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

const INDEX_LINE = /\bsee\s+(?:below|bottom|side|neck|cap|lid|panel|back|pack)\b|\brefer\s+(?:to\s+)?(?:the\s+)?(?:cap|neck|bottom|batch|lot|code|side)\b|\bfor\s+details\b/i;

function byCaption(segments: Segment[], spec: CaptionSpec): FieldHit | undefined {
  const captionSegments = segments.filter((s) => spec.caption.test(s.text) && !INDEX_LINE.test(s.text));

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
  /\b(?:ltd|limited|pvt|llp|inc|made in|certified|gmp|iso|e-?mail|website|www\.|\.com|toll|free|regd|office|directions|composition|ingredients|derived|contains|read the|see below|for name|batch|expiry|mfd|mfg|lic\.?\s*no|plot|distt|road|nagar|p\.?o\.?|ayurvedic|medicine|proprietary|nutrition|allergen|storage|store in|since|helps|keeps?|fights?|cleanse|rejuvenat|results|use with|brush|external use|reach of|paper box|save water|cruelty|registered|trade mark|www|m\.?r\.?p|incl\.?\s*of\s*all|taxes|not for sale|individual units|pack of|code|size|quality|business|product|item|pulls|ply|grade|rate|units?|weight|total|energy|protein|sugars?|sodium|carbohydrate|fibre|fiber|serving|calories|approx|values?|step|note|caution|warning|apply|rinse|hygienic|feedback|complaints?|contact|exclusive pack|multi-?piece|scan|barcode|qr code|recipe|recommended|dilution|instructions?|advantage|qty|net|wt|vol|date|manufactur\w*|expiry|see|neck|cap|refer|bottle|below|above|panel|first|characters?|details|information|approximate|per|consumer|customer|services|cell|based on|diet|kcal|rda|helpline|mix|serve|add|cook\w*|boil|pour|stir|empty|fill|heat|take|shake|dilute|wash|do not|don't|avoid|consume|open|instruc\w*|direction\w*|method|preparation|tower|wing|floor|unit\s*no|centre|international|opp\.?|near|behind|village|vill\.?|dist\.?|taluk|mandal|wholegrain|manage|tissue|toilet|napkins?|cookies|biscuits?|cake|refined|palm oil|maida|water|sugar|salt|flour)\b/i;

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
    !NOT_A_NAME.test(text) &&
    // A comma-separated list ending in a full stop is an ingredient line.
    !((text.match(/,/g) ?? []).length >= 2 && /\.\s*$/.test(text)) &&
    // Five or more words, mostly lower-case: running text, not a name.
    !(words.length >= 5 && words.slice(1).filter((w) => /^[a-z]/.test(w) && !/^(?:of|and|the|with|in|for|&|a|an)$/.test(w)).length >= 2) &&
    (text.match(/,/g) ?? []).length <= 1
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
    const brand = chosen.text.trim().toLowerCase();
    const fuller =
      candidates.find(
        (c) => c !== chosen && /\s/.test(c.text.trim()) && c.capHeightPx >= chosen.capHeightPx * 0.6 && c.text.toLowerCase().includes(brand),
      ) ??
      // No line repeats the brand: a title of three or more words in near-brand size is the product name
      // ("Complete Care Herbal Toothpaste" under "Himalaya").
      candidates.find((c) => c !== chosen && c.text.trim().split(/\s+/).length >= 3 && c.capHeightPx >= chosen.capHeightPx * 0.6);
    if (fuller) chosen = fuller;
  }

  // Names wrap: a same-size name-like line directly below continues the name.
  const used = [chosen];
  const next = segmentBelow(segments, chosen, { maxGapPx: 50, minOverlap: 0.2 });
  if (
    next &&
    nameLike(next.text) &&
    // A lone word below the name is a stray fragment ("Grade"), not a continuation.
    next.text.trim().split(/\s+/).length >= 2 &&
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

function readMrp(originals: Segment[]): FieldHit | undefined {
  const segments = originals.map((s) => ({ ...s, text: fixRupeeMisreads(s.text) }));
  const hit0 = readMrpOn(segments);
  if (!hit0) return undefined;
  return { ...hit0, segments: hit0.segments.map((c) => originals[segments.indexOf(c)] ?? c) };
}

function readMrpOn(segments: Segment[]): FieldHit | undefined {
  const caption = MRP_CAPTION;
  // An amount: currency-marked, or a plain number with paise or "/-" — never "0.15" from a composition line.
  const amountLike = /(?:₹|rs\.?|inr|[?=€¥£])\s*(?!0\.)\d[\d,]*(?:\.\d{1,2})?|\b(?!0\.)\d{1,5}(?:\.\d{2})\b(?![\/\-.]\d)(?!\s*%)|\b\d{1,5}\s*\/-/i;
  let hit = byCaption(segments, { caption, accept: amountLike, maxGapPx: 90 });
  if (hit && DATE_LIKE.test(hit.value) && !/₹|\brs\b|\binr\b/i.test(hit.value)) hit = undefined;
  if (!hit) {
    // No caption in this orientation: take the largest price-looking amount
    // that is not a per-unit figure — "₹0.73 per g" sits beside the MRP on
    // many cartons and must not win.
    // Marked amounts anywhere — "₹150", "?150" (misread ₹), "132/-" — the largest
    // wins (a struck-through offer price is smaller than the MRP beside it); a
    // bare decimal only counts on a short line of its own.
    // "?150" with no paise is trusted when the panel carries an MRP caption whose value sits elsewhere.
    const declaresMrp = segments.some((seg) => caption.test(seg.text));
    const marked = segments.flatMap((seg) =>
      amountsIn(seg.text, declaresMrp).map((a) => ({ seg, text: a.text, amount: a.amount, rank: 2_000_000 + a.amount })),
    );
    // A number with no rupee mark, no MRP caption and no "/-" is not a price:
    // "01.24" is a date and "R04125" a batch code.
    const candidates = marked.filter((c) => Number.isFinite(c.amount) && c.amount >= 1).sort((a, b) => b.rank - a.rank);
    if (candidates.length === 0) return undefined;
    const top = candidates[0];
    // Normalise a misread rupee mark ("?150", "Z150", "R150") to ₹ — but leave "Rs." alone.
    hit = { value: top.text.replace(/^[?=€¥£]\s?/, '₹').trim(), segments: [top.seg], confidence: top.seg.confidence };
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

/** "Net Wt.", "NET WET" (as printed on some packs), "Net Qty", "Net Content(s)", "Net Volume", "N.W.", "Net Wt. when packed". */
const NET_CAPTION = /\b(?:net\s*(?:qty\.?|quantity|wt\.?|wet|wgt\.?|weight|content|contents|vol\.?|volume)(?:\s*(?:when\s*packed|at\s*\d+\s*°?\s*c))?|n\.\s*w\.?)(?![a-z])/i;
/** A quantity with its unit, optionally followed by a bracketed equivalent: "5 Litre (4570g)", "100 UNITS", "350 Pulls". */
const QTY_UNIT = '(?:kg|kgs|g|gm|gms|grams?|mg|ml|l|ltr|litres?|liters?|cl|n|nos\\.?|pcs|pieces|units?|pulls?|sheets?|tablets?|capsules?|sachets?|bags?)';
const QTY_VALUE = new RegExp(`(?<![\\d.])\\d+(?:[.,]\\d+)?\\s*${QTY_UNIT}(?![a-z])(?:\\s*\\(\\s*\\d+(?:[.,]\\d+)?\\s*(?:kg|g|gm|ml|l)\\s*\\))?`, 'i');
/** "5 PACKS x 184.8 g", "2 N x 150 g": a pack breakdown whose total is the net quantity. */
const QTY_BREAKDOWN = /(\d+)\s*(?:packs?|n|units?|pcs|pieces|tubes?|sachets?|bars?|pouches?|nos\.?)?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(kg|g|gm|gms|ml|l|ltr)\b/i;
const QTY_BREAKDOWN_REVERSED = /(\d+(?:[.,]\d+)?)\s*(kg|g|gm|gms|ml|l|ltr)\s*[x×]\s*(\d+)\s*(?:packs?|n|units?|pcs|pieces|tubes?|sachets?|bars?|pouches?|nos\.?)?/i;
/** Nutrition rows and per-100 g figures are never the pack size. */
const NUTRITION_LINE = /\b(?:kcal|energy|protein|carbohydrates?|sugars?|sodium|fibre|fiber|cholesterol|fat|per\s*100|serving|rda|vitamin|calcium|iron|potassium|omega|trans)\b|%|\bmg\b/i;

/** The printed breakdown with its total appended: "2 N x 150 g (300 g)" — the label's wording is kept, the total is what the rule checks. */
function breakdownTotal(text: string): { text: string; total: number; unit: string } | null {
  const m = text.match(QTY_BREAKDOWN);
  const r = m ? null : text.match(QTY_BREAKDOWN_REVERSED);
  const hit = m ?? r;
  if (!hit) return null;
  const count = Number(m ? m[1] : r![3]);
  const each = Number((m ? m[2] : r![1]).replace(',', '.'));
  const unit = m ? m[3] : r![2];
  const total = count * each;
  if (!Number.isFinite(total) || total <= 0) return null;
  return { text: `${hit[0].trim()} (${Number(total.toFixed(2))} ${unit})`, total, unit };
}

/** The plain quantity on a line, ignoring the per-pack figure inside a breakdown. */
function quantityIn(text: string): string | null {
  const stripped = text.replace(QTY_BREAKDOWN, ' ').replace(QTY_BREAKDOWN_REVERSED, ' ');
  const m = stripped.match(QTY_VALUE);
  if (m) return m[0].trim();
  return breakdownTotal(text)?.text ?? null;
}

/** A promotional line ("+ Free 1N toothbrush", "buy 1 get 1") is never the net quantity. */
const PROMO_LINE = /\bfree\b|\bbuy\s*\d|\boffer\b|\bextra\b|\bbonus\b/i;

function readNetQuantity(segments: Segment[]): FieldHit | undefined {
  // The value printed on the caption's own line, or on its row to the right,
  // comes first: "Net Quantity:" with "300g" beside it, not the "+ Free 1N
  // toothbrush" line printed underneath.
  for (const caption of segments.filter((s) => NET_CAPTION.test(s.text) && !INDEX_LINE.test(s.text))) {
    const inline = quantityIn(inlineRemainder(caption, NET_CAPTION));
    if (inline) return { value: inline, segments: [caption], confidence: caption.confidence };
    const row = valueOnRow(caption, segments, COLUMN_SPECS[4]);
    if (row && !PROMO_LINE.test(row.seg.text)) {
      const q = quantityIn(row.match) ?? row.match.trim();
      return { value: q, segments: [caption, row.seg], confidence: Math.min(caption.confidence, row.seg.confidence) };
    }
  }
  const byLabel = byCaption(segments, {
    caption: NET_CAPTION,
    // Only a quantity with a unit counts: "at 30°C", a date or a batch code under the caption is not the value.
    accept: new RegExp(`${QTY_VALUE.source}|${QTY_BREAKDOWN.source}`, 'i'),
    maxGapPx: 90,
  });
  if (byLabel && !byLabel.segments.some((s) => PROMO_LINE.test(s.text) && !NET_CAPTION.test(s.text))) {
    const q = quantityIn(byLabel.value);
    if (q) return { ...byLabel, value: q };
  }

  // Uncaptioned: "300g" beside "200g + 100g" — the total is the largest amount.
  const toBase = (n: number, unit: string) => (/^(?:kg|l|ltr|litres?)$/i.test(unit) ? n * 1000 : n);
  const candidates = segments
    .filter((seg) => !PRICE.test(seg.text) && !/\bper\b/i.test(seg.text) && !/\d{7,}/.test(seg.text) && !NUTRITION_LINE.test(seg.text) && !PROMO_LINE.test(seg.text))
    .flatMap((seg) => {
      // A breakdown line yields its total; anything else yields its plain quantities.
      const total = breakdownTotal(seg.text);
      if (total) return [{ seg, text: total.text, base: toBase(total.total, total.unit), unit: total.unit }];
      return Array.from(seg.text.matchAll(/(?<![\d.])(\d+(?:\.\d+)?)\s*(g|gm|gms|grams?|kg|ml|l|ltr|litres?|liters?|n|pcs|pieces|units?|pulls?|sheets?)(?![a-z])/gi)).map(
        (m) => ({ seg, text: m[0], base: toBase(Number(m[1]), m[2]), unit: m[2] }),
      );
    })
    // No pack in this rule set weighs more than five kilograms or holds more than five litres.
    .filter((c) => c.base <= 5000 || /^(?:n|pcs|pieces|units?|pulls?|sheets?)$/i.test(c.unit))
    // "3 g" from a nutrition table, "0L" from a barcode: not a pack size.
    .filter((c) => c.base >= 5 || (c.base > 0 && /^(?:n|pcs|pieces|units?|pulls?|sheets?)$/i.test(c.unit)));
  if (candidates.length === 0) return undefined;
  // The net quantity is set in the largest type of any quantity on the panel;
  // among quantities of that size the total ("300g" over "200g + 100g") is the largest.
  const maxCap = Math.max(...candidates.map((c) => c.seg.capHeightPx));
  const top = candidates
    .filter((c) => c.seg.capHeightPx >= maxCap * 0.85)
    .sort((a, b) => b.base - a.base)[0];
  return { value: top.text.trim(), segments: [top.seg], confidence: top.seg.confidence };
}

const CORPORATE = /\b(?:ltd|limited|pvt|private|llp|inc|industries|foods|mills|co)\b\.?/i;

/** "BD) DABUR INDIA LTD., Vill. …" — multi-unit cartons key each unit by a short code. */
const UNIT_CODE = /^\s*([A-Z0-9]{1,3})\)\s*/;

function readManufacturer(segments: Segment[], batchCode?: string): FieldHit | undefined {
  const byLabel = byCaption(segments, {
    caption:
      /\b(?:manufactured\s*(?:&|and)?\s*packed\s*by|manufactured\s*by|packed\s*by|marketed\s*by|mktd\.?\s*by(?:\s*lic\.?\s*user)?|made\s*in\s*india\s*by|mfd\.?\s*by|manufacturer|mfg\.?\s*by)\b/i,
    maxGapPx: 90,
  });
  if (byLabel) {
    // "HINDUSTAN UNILEVER LTD (HUL). © HUL 2020." → the name ends at the bracket or the copyright.
    const cut = byLabel.value.replace(/\s*\(\s*[A-Z]{2,6}\s*\).*$/, '').replace(/\s*[©®].*$/, '');
    const trimmed = trimToCorporate(cut === byLabel.value ? byLabel.value : cut.replace(/[,\s]+$/, '').trim());
    return trimmed.length >= 3 ? { ...byLabel, value: trimmed } : byLabel;
  }

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
  const stripped = entity.text
    .replace(UNIT_CODE, '')
    // "MKTD. BY LIC. USER", "Manufactured 8y" (OCR for "by"), "Marketed by" — anything up to the last such word.
    .replace(/^.*\b(?:m(?:k|f)(?:t|)d\.?|manufactured|marketed|packed|made in india)\b.*\b(?:by|8y|user)\b[:\s]*/i, '')
    .replace(/\s*\(?\s*[A-Z]{2,6}\s*\)\.?.*$/, '')
    .replace(/\s*[©®].*$/, '')
    .replace(/^[^A-Za-z]+/, '');
  const corporateAt = stripped.search(CORPORATE);
  const commaAfter = corporateAt >= 0 ? stripped.indexOf(',', corporateAt) : -1;
  const name = (commaAfter > 0 ? stripped.slice(0, commaAfter) : stripped)
    .split(/,\s*(?=(?:vill|plot|p\.?o\.?|sy\.?|unit|shed|sector|i\.?g\.?c|no\.?\s*\d|\d))/i)[0]
    .replace(/\s*\((?:unit|plant)[^)]*\)\s*$/i, '')
    .trim();
  return { value: trimToCorporate(name || entity.text), segments: [entity], confidence: entity.confidence };
}

const INDIAN_STATE =
  /\b(?:andhra pradesh|arunachal|assam|bihar|chhattisgarh|goa|gujarat|haryana|himachal|jharkhand|karnataka|kerala|madhya pradesh|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|orissa|punjab|rajasthan|sikkim|tamil nadu|telangana|tripura|uttar pradesh|uttarakhand|west bengal|delhi|chandigarh|puducherry|jammu|kashmir|ladakh|mumbai|bengaluru|bangalore|hyderabad|chennai|kolkata|pune|ahmedabad|baddi|noida|gurugram|gurgaon)\b/i;

/** Lines that end an address block: licences, origin statements, pack claims, contacts. */
const ADDRESS_STOP = /\blic(?:ence|ense)?\.?\s*no|\bmade in\b|\bpaper box\b|\bsave water\b|\bcruelty\b|\bwww\.|e-?mail|toll|\bnet\s*(?:wt|qty|quantity)|\bmrp\b|\bbatch\b|\bimported\b/i;

function readAddress(segments: Segment[], manufacturer?: FieldHit): FieldHit | undefined {
  if (!manufacturer) {
    return byPattern(
      segments,
      /.+/,
      (s) => PIN_CODE.test(s.text) && letterCount(s.text) >= 8 && (INDIAN_STATE.test(s.text) || ADDRESS_LINE.test(s.text)),
    );
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
    .replace(/^\s*\(\s*[A-Z]{2,6}\s*\)[.,]?/, '')
    .replace(/[©®]\s*[A-Z]{2,6}\s*\d{4}\.?/g, '')
    .replace(/^[\s,.\-–]+/, '')
    .replace(/\s*mfg\.?\s*lic.*$/i, '')
    .trim();
  const addressy = PIN_CODE.test(inlineAddress.replace(/\s/g, '')) || ADDRESS_LINE.test(inlineAddress) || INDIAN_STATE.test(inlineAddress);
  if (inlineAddress.length > 8 && addressy) {
    if (PIN_CODE.test(inlineAddress.replace(/\s/g, ''))) {
      return { value: inlineAddress, segments: [anchor], confidence: anchor.confidence };
    }
    let cursor: Segment | undefined = anchor;
    const parts = [inlineAddress];
    const used = [anchor];
    for (let i = 0; i < 3 && cursor; i++) {
      const next: Segment | undefined = segmentBelow(segments, cursor, { maxGapPx: 70, minOverlap: 0.2 });
      if (!next || UNIT_CODE.test(next.text) || CAPTION_LIKE.test(next.text) || ADDRESS_STOP.test(next.text)) break;
      parts.push(next.text.replace(/\s*mfg\.?\s*lic.*$/i, '').trim());
      used.push(next);
      if (PIN_CODE.test(next.text.replace(/\s/g, ''))) break;
      cursor = next;
    }
    return { value: parts.filter(Boolean).join(' '), segments: used, confidence: meanConfidence(used) };
  }
  let cursor = anchor;
  for (let i = 0; i < 6; i++) {
    const next = segmentBelow(segments, cursor, { maxGapPx: 70, minOverlap: 0.2 });
    if (!next || CAPTION_LIKE.test(next.text) || ADDRESS_STOP.test(next.text)) break;
    cursor = next;
    // Notes between the name and the address: licence-from, trade-mark, "for name & address … see side".
    if (/^\(?\s*under\s+licen[cs]e/i.test(next.text) || /registered trade mark|for name\s*&\s*address|read the first|see side/i.test(next.text)) continue;
    // A unit-coded line: "B) HINDUSTAN UNILEVER LTD., UNIT 2, DAG NO. 21 …" — keep the address part.
    const text = next.text.replace(UNIT_CODE, '').replace(/^[^,]*\b(?:ltd|limited|pvt|company)\.?,?\s*/i, '');
    collected.push(text === next.text ? next : { ...next, text });
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
    /\b(?:consumer\s*(?:care|cell|complaints?|service)|customer\s*(?:care|service|support)|for\s*consumer\s*complaints?)\b/i,
    // "Dabur Cares", "Lever Care:", "For queries, contact:", "For complaints", "Call or write"
    /(?:\b\w+\s+cares?\s*[:\-–—]|\b\w+\s+cares\b|\bfor\s*(?:any\s*)?(?:complaints?|queries)\b|\bfeedback\b|\bcall\s*or\s*write\b)/i,
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
  const value = joinSegments(collected);
  // A consumer-care block carries a contact or at least reads as words; "A ASA" does not.
  const hasContact = PHONE.test(value) || EMAIL.test(value) || /www\.|\.com\b|\.in\b|toll|1800|call|write/i.test(value);
  if (!hasContact && !looksLikeWords(value)) return undefined;
  return {
    value,
    segments: collected,
    confidence: meanConfidence(collected),
  };
}

// "07/2026" and the dot-matrix "02/22" alike.
const MONTH_YEAR = /(?<![\d\-/.])\b(0?[1-9]|1[0-2])[/\-.](20\d{2}|\d{2})\b(?![\d\-/.])/g;
/** "24/06/2026", "24-06-26", "24.06.2026": a full day/month/year. */
const FULL_DATE = /(?<![\d\-/.])\b(0?[1-9]|[12]\d|3[01])[/\-.](0?[1-9]|1[0-2])[/\-.](20\d{2}|\d{2})\b(?![\d\-/.])/g;
const yearOf = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * Every month/year token on the label with a sortable key. Used when the
 * captions are missing, illegible, or — as on many cartons — printed in a
 * different orientation from the values they label.
 */
function allDates(segments: Segment[]): { value: string; segment: Segment; key: number }[] {
  const hits: { value: string; segment: Segment; key: number }[] = [];
  for (const segment of segments) {
    // A toll-free number "1800-10-22-221" is not a pair of dates.
    if (PHONE.test(segment.text) && !DATE_LIKE.test(segment.text.replace(PHONE, ''))) continue;
    // Full dates first: "24/06/2026" must not also be read as the month/year "06/2026".
    for (const m of segment.text.matchAll(FULL_DATE)) {
      const year = yearOf(m[3]);
      if (year < 2015 || year > 2036) continue;
      hits.push({ value: m[0], segment, key: year * 12 + Number(m[2]) + Number(m[1]) / 32 });
    }
    for (const m of segment.text.matchAll(MONTH_YEAR)) {
      const year = yearOf(m[2]);
      if (year < 2015 || year > 2036) continue;
      const after = segment.text.slice((m.index ?? 0) + m[0].length);
      const before = segment.text.slice(0, m.index ?? 0);
      if (/^\s*(?:%|(?:g|gm|kg|ml|l|ltr|mg|pcs)(?![A-Za-z]))/i.test(after)) continue;
      if (/\.\d{2}$/.test(m[0]) && m[1].length === 1) continue;
      if (/[(\d]\s*$/.test(before)) continue;
      // Part of a full date already taken above.
      if (hits.some((h) => h.segment === segment && h.value.endsWith(m[0]))) continue;
      hits.push({ value: m[0], segment, key: year * 12 + Number(m[1]) });
    }
    for (const m of segment.text.matchAll(MONTH_NAME_DATE)) {
      const year = yearOf(m[3]);
      if (year < 2015 || year > 2036) continue;
      hits.push({ value: m[0].trim(), segment, key: year * 12 + MONTHS.indexOf(m[2].toLowerCase()) + 1 });
    }
  }
  return hits.sort((a, b) => a.key - b.key);
}

/** "Mfg. Date - Expiry: 02/2025-01/2028" → the two dates of a range, when the value carries two. */
function dateRange(text: string): [string, string] | null {
  const re = new RegExp(`(${DATE_LIKE.source})\\s*(?:-|–|to)\\s*(${DATE_LIKE.source})`, 'i');
  const m = text.match(re);
  return m ? [m[1], m[2]] : null;
}

/** Trims a captioned date hit to the date itself when the caption was read as its own line. */
function dateOnly(hit: FieldHit): FieldHit {
  const range = dateRange(hit.value);
  if (range) return hit;
  const m = hit.value.match(DATE_LIKE) ?? hit.value.match(/\b\d{1,2}\s*(?:months?|years?|days?)\b/i);
  return m && m[0].length < hit.value.length ? { ...hit, value: m[0] } : hit;
}

function readPackingDate(segments: Segment[]): FieldHit | undefined {
  const byLabel = byCaption(segments, {
    caption:
      /\b(?:month\s*(?:&|and)?\s*year\s*of\s*(?:packing|manufacture)|date\s*of\s*(?:packing|manufacture)|packed\s*on|mfg\.?\s*date|mfd\.?\s*date|pkd\.?\s*on|packing\s*date|mfd\.?|mfg\.?)\b/i,
    accept: DATE_LIKE,
    maxGapPx: 90,
  });
  if (byLabel) return dateOnly(byLabel);
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
    caption: /\b(?:best\s*before|use\s*by|use\s*before|expiry\s*date|exp\.?\s*date|best\s*before\s*end|expiry|exp\.?)\b/i,
    accept: new RegExp(`${DATE_LIKE.source}|\\b\\d{1,2}\\s*(?:months?|years?|days?)\\b`, 'i'),
    maxGapPx: 90,
  });
  if (byLabel) return dateOnly(byLabel);
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

// "Mfg. Lic. No.: UK.AY-191/2010", "Lic. No.: AUS-782", "Lic. No.: 106-ISM(HR)" — but not "FSSAI Lic. No." (read separately).
const MFG_LIC = /(?<!fssai\s)(?<!fssai)\b(?:(?:mfg\.?|mfd\.?|manufacturing|drug|d\s*&\s*c|ayur(?:veda|vedic)?)\s*)?lic(?:ence|ense)?\.?\s*(?:no\.?|number|#)\s*[:.\-–—]?\s*/i;
const LIC_VALUE = /[A-Z0-9][A-Z0-9\/\-.()]{2,}(?:\s?[A-Z0-9\/\-.()]+){0,2}/;

/**
 * Statutory licence number. Food packs carry a 14-digit FSSAI licence; drugs,
 * cosmetics and ayurvedic products carry a manufacturing licence ("Mfg. Lic.
 * No.: UK.AY-191/2010") instead. Multi-unit cartons print one per factory, so
 * the one on the unit named by the batch-code prefix is preferred.
 */
function readFssai(segments: Segment[], batchCode?: string): FieldHit | undefined {
  const fssai =
    byCaption(segments, { caption: /\bfssai[a-z. ]*(?:lic\.?\s*no\.?)?\b/i, accept: /\d{8,}/, maxGapPx: 90 }) ??
    byPattern(segments, /\b\d{14}\b/);
  if (fssai) return fssai;

  const licenceOf = (seg: Segment): string | undefined => {
    const m = seg.text.match(MFG_LIC);
    if (!m) return undefined;
    const rest = seg.text.slice((m.index ?? 0) + m[0].length);
    const v = rest.match(LIC_VALUE);
    return v && /\d/.test(v[0]) ? v[0].replace(/[.,]$/, '') : undefined;
  };
  const withLicence = segments
    .map((seg) => ({ seg, value: licenceOf(seg) }))
    .filter((x): x is { seg: Segment; value: string } => Boolean(x.value));
  if (withLicence.length === 0) return undefined;

  // Prefer the unit the batch code points at: its code appears on the same or the previous line.
  const prefix = batchCode?.match(/^([A-Z]{1,3})/i)?.[1]?.toUpperCase();
  if (prefix) {
    const keyed = withLicence.find(({ seg }) => {
      const idx = segments.indexOf(seg);
      const window = segments.slice(Math.max(0, idx - 2), idx + 1);
      return window.some((s) => s.text.match(UNIT_CODE)?.[1]?.toUpperCase() === prefix);
    });
    if (keyed) return { value: keyed.value, segments: [keyed.seg], confidence: Math.min(0.85, keyed.seg.confidence) };
  }
  const first = withLicence[0];
  return { value: first.value, segments: [first.seg], confidence: Math.min(0.8, first.seg.confidence) };
}

/** A short alphanumeric code such as "RU3743 L8B" or "SG-2607-D12". */
// Trailing tokens are short or carry a digit — "RU3743 L8B", "SG-2607-D12", never "HN 490 VISION".
const BATCH_CODE = /^[A-Z]{1,3}[\s\-–—]?\d{3,8}(?:[\s\-–—](?:[A-Z]{1,3}|[A-Z0-9]*\d[A-Z0-9]*)){0,2}[.,]?$/i;

function readBatch(segments: Segment[]): FieldHit | undefined {
  const captioned = byCaption(segments, {
    caption: /\b(?:batch\s*(?:no\.?|number|code)?|lot\s*(?:no\.?|number)?|b\.?\s*no\.?)\b/i,
    // A code: has a digit, at most four tokens, and no word of four or more
    // lower-case letters (which is how "batch code & see below" is told apart).
    // Tokens may start with a misread symbol ("$G-2607-D12" for "SG-2607-D12").
    // …and it carries a letter or a hyphen, is at most three tokens, and is not
    // a long run of digits (a barcode fragment, a PIN code or a phone number).
    accept: /^(?=.*\d)(?=.*(?:[A-Za-z]|-))(?=(?:.*[A-Za-z0-9]){4,})(?!.*\b[a-z]{4,}\b)(?!.*\d{7,})\S+(?:\s+\S+){0,2}\s*$/,
    maxGapPx: 90,
  });
  // A genuine code anywhere on the panel beats a captioned value that does not
  // look like one — the caption's neighbour is often a stray fragment.
  const codes = segments.filter((s) => {
    const t = s.text.trim();
    return (
      BATCH_CODE.test(t) &&
      t === t.toUpperCase() &&
      s.confidence >= 0.5 &&
      !DATE_LIKE.test(t) &&
      !PRICE.test(t) &&
      !QUANTITY.test(t) &&
      !/^\d+$/.test(t.replace(/[\s-]/g, ''))
    );
  });
  if (captioned && (BATCH_CODE.test(captioned.value.trim()) || codes.length === 0)) return captioned;
  if (codes.length) {
    const top = [...codes].sort((a, b) => b.confidence - a.confidence)[0];
    return { value: top.text.trim(), segments: [top], confidence: Math.min(top.confidence, 0.7) };
  }
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
      t === t.toUpperCase() &&
      s.confidence >= 0.6 &&
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

/* ---------------------------------------------------------- Legend stage */

/**
 * Some cartons print the captions once as a legend — "*MRP ₹ (Incl. of all
 * taxes), #MFD. & @Expiry" — and then a single dot-matrix line keyed by the
 * symbols: "B1 *₹150 #02/22 @01/24". The symbols are the captions.
 */
const LEGEND_SYMBOL = /([*#@^†‡§'‘’"“”©®])\s*(m\.?r\.?p\.?|mfd\.?|mfg\.?|manufactured|packed|expiry|exp\.?|best\s*before|use\s*by|batch)/gi;
const SYMBOL_CLASS: Record<string, string> = { '*': "[*'‘’\"“”]", '#': '[#]', '@': '[@©®]', '^': '[\\^]', '†': '[†]', '‡': '[‡]', '§': '[§]' };

function legendFieldOf(word: string): DeclarationKey | null {
  const w = word.toLowerCase();
  if (/mrp|m\.r\.p/.test(w)) return 'MRP';
  if (/mfd|mfg|manufactured|packed/.test(w)) return 'DATE_OF_PACKING';
  if (/exp|best|use/.test(w)) return 'BEST_BEFORE';
  if (/batch/.test(w)) return 'BATCH_NUMBER';
  return null;
}

function applyLegend(fields: Partial<Record<DeclarationKey, FieldHit>>, segments: Segment[]) {
  const legend = new Map<string, DeclarationKey>();
  for (const seg of segments) {
    for (const m of seg.text.matchAll(LEGEND_SYMBOL)) {
      const key = legendFieldOf(m[2]);
      const symbol = /['‘’"“”]/.test(m[1]) ? '*' : /[©®]/.test(m[1]) ? '@' : m[1];
      if (key && !legend.has(symbol)) legend.set(symbol, key);
    }
  }
  if (legend.size === 0) return;

  for (const [symbol, key] of legend) {
    if (fields[key]) continue;
    const cls = SYMBOL_CLASS[symbol];
    if (!cls) continue;
    const valueRe =
      key === 'MRP'
        ? new RegExp(`${cls}\\s*(?:(?:₹|rs\\.?|[?=€¥£])\\s*(\\d{1,5}(?:[.,]\\d{1,2})?)|(\\d{1,5}[.,]\\d{2}))(?!\\s*[/-]\\d)`, 'i')
        : key === 'BATCH_NUMBER'
          ? new RegExp(`${cls}\\s*([A-Z0-9][A-Z0-9\\-/]{1,12})`, 'i')
          : new RegExp(`${cls}\\s*((?:0?[1-9]|1[0-2])[/\\-.](?:20)?\\d{2})`, 'i');
    for (const seg of segments) {
      // The legend line itself defines the symbol; values live on other lines.
      if (LEGEND_SYMBOL.test(seg.text)) { LEGEND_SYMBOL.lastIndex = 0; continue; }
      LEGEND_SYMBOL.lastIndex = 0;
      const m = seg.text.match(valueRe);
      if (!m) continue;
      const value = key === 'MRP' ? `MRP ₹${m[1] ?? m[2]}` : m[1];
      fields[key] = { value, segments: [seg], confidence: Math.min(0.85, seg.confidence) };
      break;
    }
  }
}

/* --------------------------------------------------- Caption-column stage */

/**
 * Pouches and cartons print the price/date/batch captions as a block —
 * "MRP ₹ / (incl. of all taxes) / Lot No.: / MFD.: / Use by:" — and inkjet the
 * values in a second column beside it, or in a row underneath a table header
 * ("NET WEIGHT  LOT NO.  MFG. DATE  USE BY  MRP"). The recogniser returns the
 * captions and the values as separate lines, so the caption readers, which look
 * inline and directly below, find nothing. This stage joins the columns: first
 * by row (a value on the same baseline to the right of its caption), then by
 * type over everything printed inside the block's reach.
 */
interface ColumnSpec {
  key: DeclarationKey;
  caption: RegExp;
  value: RegExp;
}
const DATE_ANY = new RegExp(DATE_LIKE.source, 'i');
const COLUMN_SPECS: ColumnSpec[] = [
  {
    key: 'MRP',
    caption: MRP_CAPTION,
    value: /(?:₹|rs\.?|inr|[?=€¥£])\s*(?!0\.)\d{1,5}(?:[.,]\d{1,2})?|\b(?!0\.)\d{1,5}[.,]\d{2}\b|\b\d{1,5}\s*\/-/i,
  },
  {
    key: 'DATE_OF_PACKING',
    caption:
      /\b(?:mfd\.?|mfg\.?(?:\s*date|\s*dt\.?)?|pkd\.?(?:\s*on|\s*date)?|packed(?:\s*on|\s*date)?|pkt\.?\s*dt\.?|date\s*of\s*(?:pkg\.?|packing|packaging|mfg\.?|manufacture)|dom|manufactured\s*on)\b/i,
    value: DATE_ANY,
  },
  {
    key: 'BEST_BEFORE',
    caption: /\b(?:use\s*by|used\s*by|use\s*before|best\s*before|expiry(?:\s*date)?|exp\.?(?:\s*date|\s*dt\.?)?|doe)\b/i,
    value: DATE_ANY,
  },
  {
    key: 'BATCH_NUMBER',
    caption: /\b(?:batch\s*(?:no\.?|number|code)?|lot\s*(?:no\.?|number)?|b\.?\s*no\.?|bn|code)\b/i,
    value: /\b(?=[A-Z0-9\-\/.:]*\d)(?=[A-Z0-9\-\/.:]*(?:[A-Z\-\/]|\d{4}))[A-Z0-9][A-Z0-9\-\/.:]{2,14}\b/,
  },
  {
    key: 'NET_QUANTITY',
    caption: NET_CAPTION,
    value: QTY_VALUE,
  },
];
const ANY_COLUMN_CAPTION = new RegExp(COLUMN_SPECS.map((c) => c.caption.source).join('|'), 'i');

/** The caption is printed alone: nothing after it reads as its value. */
const POINTS_ELSEWHERE = /\b(?:see|refer(?:\s*to)?|read|check)\s+(?:the\s+)?(?:neck|bottle|cap|lid|bottom|top|base|side\s*panel|below|above|pack|carton|sleeve)\b/i;

function captionOnly(seg: Segment, spec: ColumnSpec): boolean {
  if (!spec.caption.test(seg.text)) return false;
  if (POINTS_ELSEWHERE.test(seg.text)) return false;
  const rest = inlineRemainder(seg, spec.caption)
    .replace(/\(?\s*(?:incl?\.?|inclusive)[^)]*\)?/gi, '')
    .replace(/₹|rs\.?|inr|[:.\-–—|]/gi, '')
    .trim();
  return !spec.value.test(rest);
}

function valueOnRow(caption: Segment, segments: Segment[], spec: ColumnSpec): { seg: Segment; match: string } | undefined {
  const cy = (b: Segment) => (b.bbox.y0 + b.bbox.y1) / 2;
  const h = Math.max(10, caption.bbox.y1 - caption.bbox.y0);
  const row = segments
    .filter(
      (s) =>
        s !== caption &&
        Math.abs(cy(s) - cy(caption)) <= h * 0.75 &&
        s.bbox.x0 >= caption.bbox.x0 + (caption.bbox.x1 - caption.bbox.x0) * 0.5 &&
        s.bbox.x0 - caption.bbox.x1 < h * 30,
    )
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);
  for (const s of row) {
    // Another caption on the same row ("USP ₹") is not this caption's value.
    if (ANY_COLUMN_CAPTION.test(s.text) && !spec.value.test(inlineRemainder(s, ANY_COLUMN_CAPTION))) continue;
    const m = s.text.match(spec.value);
    if (!m) continue;
    if (spec.key === 'BATCH_NUMBER' && (DATE_ANY.test(m[0]) || PRICE.test(s.text) || /\d{1,2}\/\d{1,2}\/\d{2}/.test(m[0]))) continue;
    return { seg: s, match: m[0] };
  }
  return undefined;
}

function formatColumnValue(spec: ColumnSpec, match: string): string {
  if (spec.key === 'MRP') {
    const amount = match.replace(/^[?=€¥£]\s?/, '₹').trim();
    return /^(?:₹|rs|inr)/i.test(amount) ? `MRP ${amount}` : `MRP ₹${amount.replace(/\s*\/-$/, '')}`;
  }
  return match.trim();
}

function applyCaptionColumns(fields: Partial<Record<DeclarationKey, FieldHit>>, segments: Segment[]) {
  // Pass 1: the value on the caption's own row.
  for (const spec of COLUMN_SPECS) {
    if (fields[spec.key]) continue;
    for (const caption of segments) {
      if (!captionOnly(caption, spec)) continue;
      const found = valueOnRow(caption, segments, spec);
      if (!found) continue;
      fields[spec.key] = {
        value: formatColumnValue(spec, found.match),
        segments: [caption, found.seg],
        confidence: Math.min(0.85, found.seg.confidence),
      };
      break;
    }
  }

  // Pass 2: the block. Two or more lone captions define a legend; whatever is
  // printed inside its reach (to the right, and a little above and below, for
  // the header-row layout) is sorted by type.
  const missing = COLUMN_SPECS.filter((spec) => !fields[spec.key]);
  if (missing.length === 0) return;
  const captions = segments.filter((seg) => missing.some((spec) => captionOnly(seg, spec)));
  if (captions.length < 1) return;
  const top = Math.min(...captions.map((c) => c.bbox.y0));
  const bottom = Math.max(...captions.map((c) => c.bbox.y1));
  const left = Math.min(...captions.map((c) => c.bbox.x0));
  const h = medianCap(captions) || 20;
  const values = segments.filter(
    (s) =>
      !captions.includes(s) &&
      s.bbox.y1 >= top - h * 2 &&
      s.bbox.y0 <= bottom + h * (captions.length === 1 ? 6 : 4) &&
      s.bbox.x1 >= left &&
      !ANY_COLUMN_CAPTION.test(s.text) &&
      !CAPTION_LIKE.test(s.text),
  );
  if (values.length === 0) return;
  const hit = (value: string, seg: Segment): FieldHit => ({ value, segments: [seg], confidence: Math.min(0.75, seg.confidence) });

  const wantsPacking = captions.some((c) => captionOnly(c, COLUMN_SPECS[1]));
  const wantsExpiry = captions.some((c) => captionOnly(c, COLUMN_SPECS[2]));
  const dates = allDates(values).filter((d, i, arr) => i === 0 || d.key !== arr[i - 1].key);
  if (!fields.DATE_OF_PACKING && wantsPacking && dates.length) {
    fields.DATE_OF_PACKING = hit(dates[0].value, dates[0].segment);
  }
  if (!fields.BEST_BEFORE && wantsExpiry) {
    const later = dates.filter((d) => !fields.DATE_OF_PACKING || d.value !== fields.DATE_OF_PACKING.value);
    const last = later[later.length - 1];
    if (last && (dates.length >= 2 || !wantsPacking)) fields.BEST_BEFORE = hit(last.value, last.segment);
  }
  if (!fields.MRP && captions.some((c) => captionOnly(c, COLUMN_SPECS[0]))) {
    const amounts = values.flatMap((v) => {
      const marked = amountsIn(v.text).map((a) => ({ seg: v, amount: a.amount, text: a.text }));
      // Inside a price legend a bare "20.00" is the price.
      const bare = Array.from(v.text.matchAll(/\b(?!0\.)(\d{1,5})[.,](\d{2})\d?\b(?![\/\-.]\d)(?!\s*(?:g|gm|kg|ml|l|mg|%|per)\b)/gi))
        .filter((m) => !PER_UNIT.test(v.text.slice((m.index ?? 0) + m[0].length)) && !DATE_LIKE.test(m[0]))
        .map((m) => ({ seg: v, amount: Number(`${m[1]}.${m[2]}`), text: `₹${m[1]}.${m[2]}` }));
      return [...marked, ...bare];
    });
    const best = amounts.filter((a) => a.amount >= 1).sort((a, b) => b.amount - a.amount)[0];
    if (best) fields.MRP = hit(formatColumnValue(COLUMN_SPECS[0], best.text), best.seg);
  }
  if (!fields.BATCH_NUMBER && captions.some((c) => captionOnly(c, COLUMN_SPECS[3]))) {
    const code = values.find((v) => {
      const t = v.text.trim();
      return /^[A-Z0-9][A-Z0-9\-\/.: ]{2,14}$/.test(t) && /\d/.test(t) && /[A-Z]/.test(t) && !/\b[A-Z]{4,}\b/.test(t) && !DATE_ANY.test(t) && !PRICE.test(t) && !QUANTITY.test(t);
    });
    if (code) fields.BATCH_NUMBER = hit(code.text.trim(), code);
  }
  if (!fields.NET_QUANTITY && captions.some((c) => captionOnly(c, COLUMN_SPECS[4]))) {
    for (const v of values) {
      const m = v.text.match(COLUMN_SPECS[4].value);
      if (m && Number(m[0]) !== 0) { fields.NET_QUANTITY = hit(m[0], v); break; }
    }
  }
}

/* ------------------------------------------------------------ NLP stage */

/** Confidence given to a value recovered through the section tagger rather than a caption. */
const INFERRED_CAP = 0.82;

const CAPTION_PREFIX =
  /^[\s|:.\-–—»]*(?:(?:manufactured|mfd\.?|mfg\.?|marketed|packed|imported|produced)(?:\s*(?:&|and)\s*(?:packed|marketed))?\s*by|manufacturer|importer|regd\.?\s*office|registered\s*office|corporate\s*office|address|country\s*of\s*origin|made\s*in|product\s*of|fssai\s*(?:lic\.?|licen[cs]e)?\s*(?:no\.?|number)?|lic\.?\s*no\.?|batch\s*(?:no\.?|number|code)?|lot\s*(?:no\.?|number)?|b\.?\s*no\.?|consumer\s*(?:care|cell)(?:\s*details)?|customer\s*care|toll\s*free(?:\s*no\.?)?|helpline|e-?mail|website|net\s*(?:qty|quantity|wt\.?|weight|contents?)|m\.?r\.?p\.?|maximum\s*retail\s*price|best\s*before|use\s*by|expiry(?:\s*date)?|exp\.?\s*date|mfd\.?|mfg\.?\s*date|date\s*of\s*(?:packing|manufacture))\s*[:.\-–—]?\s*/i;

const stripCaption = (text: string) => text.replace(CAPTION_PREFIX, '').trim();

/**
 * Fills declarations the caption-driven readers missed using the line tags
 * from the section classifier. Each class has its own notion of a valid
 * value, so a mis-tagged line cannot inject nonsense: an MRP needs an amount,
 * a date needs a date, a licence needs fourteen digits.
 */
function applyNlpFallbacks(
  fields: Partial<Record<DeclarationKey, FieldHit>>,
  segments: Segment[],
  tags: LineTag[],
) {
  const tagged = (key: DeclarationKey, min: number) =>
    segments
      .map((seg, i) => ({ seg, tag: tags[i] }))
      .filter(({ tag }) => tag && tag.section === key && tag.confidence >= min)
      .sort((a, b) => b.tag.confidence - a.tag.confidence);

  const hit = (value: string, seg: Segment, tag: LineTag): FieldHit => ({
    value: value.trim(),
    segments: [seg],
    confidence: Math.min(INFERRED_CAP, seg.confidence, tag.confidence),
  });

  if (!fields.MRP) {
    for (const { seg, tag } of tagged('MRP', 0.7)) {
      const best = amountsIn(seg.text).sort((a, b) => b.amount - a.amount)[0];
      if (best) { fields.MRP = hit(`MRP ₹${best.amount}`, seg, tag); break; }
    }
  }
  if (!fields.NET_QUANTITY) {
    for (const { seg, tag } of tagged('NET_QUANTITY', 0.7)) {
      if (NUTRITION_LINE.test(seg.text)) continue;
      const q = quantityIn(seg.text);
      if (q) { fields.NET_QUANTITY = hit(q, seg, tag); break; }
    }
  }
  for (const key of ['DATE_OF_PACKING', 'BEST_BEFORE'] as const) {
    if (fields[key]) continue;
    for (const { seg, tag } of tagged(key, 0.6)) {
      const inline = seg.text.match(DATE_LIKE);
      if (inline) { fields[key] = hit(inline[0], seg, tag); break; }
      const below = segmentBelow(segments, seg, { maxGapPx: 90 });
      const m = below?.text.match(DATE_LIKE);
      if (below && m) { fields[key] = { value: m[0], segments: [seg, below], confidence: Math.min(INFERRED_CAP, below.confidence, tag.confidence) }; break; }
    }
  }
  if (!fields.MANUFACTURER_NAME) {
    for (const { seg, tag } of tagged('MANUFACTURER_NAME', 0.7)) {
      const stripped = stripCaption(seg.text.replace(UNIT_CODE, ''));
      const corporateAt = stripped.search(CORPORATE);
      const commaAfter = corporateAt >= 0 ? stripped.indexOf(',', corporateAt) : -1;
      const name = (commaAfter > 0 ? stripped.slice(0, commaAfter) : stripped).trim();
      if (name.length >= 3 && /[A-Za-z]{3}/.test(name)) { fields.MANUFACTURER_NAME = hit(trimToCorporate(name), seg, tag); break; }
    }
  }
  if (!fields.MANUFACTURER_ADDRESS) {
    const rows = tagged('MANUFACTURER_ADDRESS', 0.7);
    if (rows.length) {
      const first = rows[0];
      const used = [first.seg];
      const parts = [stripCaption(first.seg.text)];
      let cursor: Segment | undefined = first.seg;
      for (let i = 0; i < 2 && cursor; i++) {
        const next: Segment | undefined = segmentBelow(segments, cursor, { maxGapPx: 70, minOverlap: 0.2 });
        const idx = next ? segments.indexOf(next) : -1;
        if (!next || idx < 0 || tags[idx]?.section !== 'MANUFACTURER_ADDRESS') break;
        parts.push(next.text.trim());
        used.push(next);
        cursor = next;
      }
      const value = parts.filter(Boolean).join(', ');
      if (value.length >= 8 && !/mfg\.?\s*lic/i.test(value.slice(0, 12))) {
        fields.MANUFACTURER_ADDRESS = { value, segments: used, confidence: Math.min(INFERRED_CAP, meanConfidence(used), first.tag.confidence) };
      }
    }
  }
  if (!fields.CONSUMER_CARE) {
    // A bare web address, e-mail or toll-free number is the consumer-care line whatever the tagger thinks.
    const bare = segments.find((seg) => /^\s*(?:(?:https?:\/\/)?www\.[\w.-]+\.[a-z]{2,}\S*|[\w.+-]+@[\w-]+\.[\w.]+|(?:toll\s*free\s*(?:no\.?)?\s*[:\-]?\s*)?1800[\d\s\-]{6,})\s*$/i.test(seg.text));
    if (bare) fields.CONSUMER_CARE = { value: bare.text.trim(), segments: [bare], confidence: Math.min(INFERRED_CAP, bare.confidence) };
  }
  if (!fields.CONSUMER_CARE) {
    const rows = tagged('CONSUMER_CARE', 0.75).slice(0, 4).sort((a, b) => a.seg.bbox.y0 - b.seg.bbox.y0);
    if (rows.length) {
      const segs = rows.map((r) => r.seg);
      const value = joinSegments(segs);
      const hasContact =
        PHONE.test(value) || EMAIL.test(value) || /www\.|\.com\b|\.in\b|toll|1800|helpline|complaint|consumer|customer|call or write/i.test(value);
      if (hasContact) {
        fields.CONSUMER_CARE = { value, segments: segs, confidence: Math.min(INFERRED_CAP, meanConfidence(segs)) };
      }
    }
  }
  if (!fields.COUNTRY_OF_ORIGIN) {
    for (const { seg, tag } of tagged('COUNTRY_OF_ORIGIN', 0.7)) {
      const word = [...COUNTRIES].find((c) => new RegExp(`\\b${c}\\b`, 'i').test(seg.text));
      if (word) { fields.COUNTRY_OF_ORIGIN = hit(word.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1)), seg, tag); break; }
    }
  }
  if (!fields.IMPORTER_DETAILS) {
    for (const { seg, tag } of tagged('IMPORTER_DETAILS', 0.75)) {
      const v = stripCaption(seg.text);
      if (/[A-Za-z]{3}/.test(v) && !/^(?:iec|import licen)/i.test(seg.text)) { fields.IMPORTER_DETAILS = hit(v, seg, tag); break; }
    }
  }
  if (!fields.FSSAI_LICENSE) {
    for (const { seg, tag } of tagged('FSSAI_LICENSE', 0.6)) {
      const m = seg.text.replace(/\s/g, '').match(/\d{14}/);
      if (m) { fields.FSSAI_LICENSE = hit(m[0], seg, tag); break; }
    }
  }
  if (!fields.FSSAI_LICENSE) {
    // Manufacturing licences sit inside address lines; any line carrying the caption qualifies.
    for (const seg of segments) {
      const m = seg.text.match(MFG_LIC);
      if (!m) continue;
      const v = seg.text.slice((m.index ?? 0) + m[0].length).match(LIC_VALUE);
      if (v && /\d/.test(v[0])) { fields.FSSAI_LICENSE = { value: v[0].replace(/[.,]$/, ''), segments: [seg], confidence: Math.min(INFERRED_CAP, seg.confidence) }; break; }
    }
  }
  if (!fields.BATCH_NUMBER) {
    for (const { seg, tag } of tagged('BATCH_NUMBER', 0.7)) {
      const v = stripCaption(seg.text).replace(/[.,;:]+$/, '');
      if (BATCH_CODE.test(v)) { fields.BATCH_NUMBER = hit(v, seg, tag); break; }
    }
  }
  if (!fields.PRODUCT_IDENTITY) {
    for (const { seg, tag } of tagged('PRODUCT_IDENTITY', 0.75)) {
      if (nameLike(seg.text)) { fields.PRODUCT_IDENTITY = hit(seg.text, seg, tag); break; }
    }
  }
}

/**
 * Drops values that do not read as declarations — torn words, a lone digit after
 * a rupee sign, a contact block with no contact in it. Run after the caption
 * readers and again after the classifier fallbacks, which can add the same kinds
 * of noise.
 */
function sanitise(fields: Partial<Record<DeclarationKey, FieldHit>>, segments: Segment[]) {
  if (fields.MANUFACTURER_NAME) {
    const v = fields.MANUFACTURER_NAME.value;
    if (
      !looksLikeWords(v, 0.5) ||
      letterCount(v) < 5 ||
      /\b(?:incl?\.?\s*of|taxes|per\s*g|refer|scan|first\s*(?:two|three)|name\s*,?\s*address|see\s*(?:below|side|neck))\b/i.test(v)
    )
      delete fields.MANUFACTURER_NAME;
  }
  if (fields.MANUFACTURER_ADDRESS) {
    const v = fields.MANUFACTURER_ADDRESS.value;
    const addressy =
      PIN_CODE.test(v.replace(/\s/g, '')) ||
      INDIAN_STATE.test(v) ||
      ADDRESS_LINE.test(v) ||
      /\b\d{5,6}\b/.test(v) ||
      [...COUNTRIES].some((c) => new RegExp(`\\b${c}\\b`, 'i').test(v));
    if (letterCount(v) < 8 || !looksLikeWords(v, 0.5) || !addressy) delete fields.MANUFACTURER_ADDRESS;
  }
  if (fields.CONSUMER_CARE) {
    const hasContact = (t: string) => PHONE.test(t) || EMAIL.test(t) || /www\.|\.com\b|\.in\b|\.org\b|\b1800\b/i.test(t);
    if (!hasContact(fields.CONSUMER_CARE.value)) {
      // The caption line was read but not the number under it: walk down for the contact.
      const used = [...fields.CONSUMER_CARE.segments];
      let cursor: Segment | undefined = used[used.length - 1];
      let found = false;
      for (let i = 0; i < 3 && cursor; i++) {
        const next: Segment | undefined = segmentBelow(segments, cursor, { maxGapPx: 70, minOverlap: 0.2 });
        if (!next) break;
        used.push(next);
        cursor = next;
        if (hasContact(next.text)) { found = true; break; }
      }
      if (found) fields.CONSUMER_CARE = { value: joinSegments(used), segments: used, confidence: meanConfidence(used) };
      else delete fields.CONSUMER_CARE;
    }
  }
  if (fields.PRODUCT_IDENTITY) {
    const v = fields.PRODUCT_IDENTITY.value.trim();
    const opens = (v.match(/\(/g) ?? []).length;
    const closes = (v.match(/\)/g) ?? []).length;
    if (opens !== closes || /[,\-–(|:;]$/.test(v) || /^[,\-–)|:;]/.test(v)) delete fields.PRODUCT_IDENTITY;
  }
  if (fields.FSSAI_LICENSE) {
    const compact = fields.FSSAI_LICENSE.value.replace(/\s/g, '');
    if (/^\d{14}$/.test(compact)) fields.FSSAI_LICENSE = { ...fields.FSSAI_LICENSE, value: compact };
  }
  for (const key of ['DATE_OF_PACKING', 'BEST_BEFORE'] as const) {
    const hit = fields[key];
    const range = hit ? dateRange(hit.value) : null;
    if (hit && range) {
      fields.DATE_OF_PACKING = { ...hit, value: range[0] };
      fields.BEST_BEFORE = { ...hit, value: range[1] };
    }
  }
  for (const key of ['DATE_OF_PACKING', 'BEST_BEFORE'] as const) {
    const v = fields[key]?.value;
    if (v && !plausibleDateText(v)) delete fields[key];
  }
  if (fields.DATE_OF_PACKING && fields.BEST_BEFORE && fields.DATE_OF_PACKING.value.replace(/\D/g, '') === fields.BEST_BEFORE.value.replace(/\D/g, '')) {
    delete fields.BEST_BEFORE;
  }
  // Packing cannot follow expiry: a legend read with its rows shifted swaps them.
  if (fields.DATE_OF_PACKING && fields.BEST_BEFORE) {
    const key = (v: string) => {
      const probe = { text: v, confidence: 1, bbox: { x0: 0, y0: 0, x1: 1, y1: 1 }, words: [], capHeightPx: 1 } as Segment;
      const d = allDates([probe]);
      return d.length ? d[0].key : null;
    };
    const p = key(fields.DATE_OF_PACKING.value);
    const e = key(fields.BEST_BEFORE.value);
    if (p !== null && e !== null && p > e) {
      const swap = fields.DATE_OF_PACKING;
      fields.DATE_OF_PACKING = fields.BEST_BEFORE;
      fields.BEST_BEFORE = swap;
    }
  }
  if (fields.MRP) {
    const v = fixRupeeMisreads(fields.MRP.value);
    const m =
      v.match(/(?:₹|\brs\.?|\binr)\s*(\d{1,5})(?:[.,](\d{1,2}))?(?!\d)/i) ??
      [...v.matchAll(/(\d{1,5})[.,](\d{2})(?!\d)/g)].pop() ??
      v.match(/(\d{1,5})(?:[.,](\d{1,2}))?(?!\d)/);
    // "MRP ₹9" is the first digit of a price the recogniser lost; never a declaration.
    if (!m || (Number(m[1]) < 10 && !m[2])) delete fields.MRP;
    else fields.MRP.value = v;
  }
  // "7220.00": the sign glued onto the figure. When the pack also prints a unit
  // price and a net quantity, price × quantity says which reading is the MRP.
  if (fields.MRP && fields.NET_QUANTITY) {
    const glued = fields.MRP.value.match(/(?<![\d₹])7(\d{2,4}[.,]\d{2})\b/);
    const usp = segments.map((s) => s.text.match(/(\d+[.,]\d{1,3})\s*(?:per|\/)\s*(?:100\s*)?(g|gm|ml|kg|l)\b/i)).find(Boolean);
    const qty = fields.NET_QUANTITY.value.match(/(\d+(?:\.\d+)?)\s*(kg|g|gm|gms|ml|l|ltr|litres?)\b/i);
    if (glued && usp && qty) {
      const toBase = (n: number, u: string) => (/^(?:kg|l|ltr|litres?)$/i.test(u) ? n * 1000 : n);
      const expected = Number(usp[1].replace(',', '.')) * toBase(Number(qty[1]), qty[2]);
      const whole = Number(`7${glued[1].replace(',', '.')}`);
      const stripped = Number(glued[1].replace(',', '.'));
      if (Number.isFinite(expected) && expected > 0 && Math.abs(stripped - expected) < Math.abs(whole - expected)) {
        fields.MRP.value = fields.MRP.value.replace(glued[0], `₹${glued[1]}`);
      }
    }
  }
  if (fields.NET_QUANTITY) {
    const v = fields.NET_QUANTITY.value;
    // A breakdown already carrying its total ("2 N x 150 g (300 g)") is kept as printed.
    const q = (QTY_BREAKDOWN.test(v) || QTY_BREAKDOWN_REVERSED.test(v)) && /\(\s*\d/.test(v) ? v : quantityIn(v);
    if (!q) delete fields.NET_QUANTITY;
    else {
      fields.NET_QUANTITY.value = q;
      const m = q.match(/(\d+(?:\.\d+)?)\s*(g|gm|gms|ml)\b/i);
      if (m && Number(m[1]) < 5 && !NET_CAPTION.test(fields.NET_QUANTITY.segments[0].text)) delete fields.NET_QUANTITY;
    }
  }
}

/* ------------------------------------------------------- Nutrition table */

/** Column headings and nutrient rows of a nutrition table — unmistakable wherever they appear. */
const NUTRITION_ROW =
  /\b(?:kcal|kj|energy\s*(?:value|\(|:|\d)|protein|carbohydrates?|saturated|trans\s*fat|total\s*fat|cholesterol|dietary\s*fib(?:re|er)|(?:added|total)\s*sugars?|sodium|per\s*100\s*(?:g|ml|gm)|per\s*serv(?:e|ing)|serving\s*size|servings?\s*per|%\s*rda|rda\b|amount\s*per|nutrients?|calories|vitamin\s*[a-e]?\d*|magnesium|phosphorus|monounsaturated|polyunsaturated|omega\s*[36])\b/i;
const NUTRITION_HEADER = /\bnutrition(?:al)?\s*(?:information|facts|values?)|\bnutrient|typical\s*values|amount\s*per\s*serv/i;
/** A line that is only figures, units and separators: "12.3 g  0.41 g  2%". */
const FIGURES_ONLY = /^[\s\d.,%()|:\-–—]*(?:\d[\s\d.,%()|:\-–—]*)(?:\s*(?:g|gm|mg|mcg|µg|kcal|kj|ml|%)\b[\s\d.,%()|:\-–—]*)*$/i;

/**
 * The nutrition table: its header, every nutrient row anywhere on the panel,
 * and the figures-only rows that sit under the header in the same column.
 * Nothing in it is a declaration under the Packaged Commodities Rules, and
 * its numbers — "12.3 g", "486", "0.41", "2%" — are exactly what a quantity,
 * price or date reader would otherwise seize on.
 */
function nutritionSegments(segments: Segment[]): Set<Segment> {
  const out = new Set<Segment>();
  for (const seg of segments) {
    if (NUTRITION_HEADER.test(seg.text) || (NUTRITION_ROW.test(seg.text) && !NET_CAPTION.test(seg.text) && !MRP_CAPTION.test(seg.text))) out.add(seg);
  }
  // Figures-only rows within the vertical run of a table and overlapping it horizontally.
  const tableRows = [...out];
  if (tableRows.length >= 2) {
    const x0 = Math.min(...tableRows.map((s) => s.bbox.x0));
    const x1 = Math.max(...tableRows.map((s) => s.bbox.x1));
    const y0 = Math.min(...tableRows.map((s) => s.bbox.y0));
    const y1 = Math.max(...tableRows.map((s) => s.bbox.y1));
    const rowH = medianCap(tableRows) * 1.6 || 30;
    for (const seg of segments) {
      if (out.has(seg)) continue;
      const overlapsX = seg.bbox.x1 > x0 && seg.bbox.x0 < x1;
      const withinY = seg.bbox.y1 > y0 - rowH && seg.bbox.y0 < y1 + rowH * 2;
      // A nutrition row carries several figures or a percentage ("12.3 g  0.41 g  2%");
      // a single figure on its own ("20.00", "38 g") is a legend value and stays.
      const figures = (seg.text.match(/\d+(?:[.,]\d+)?/g) ?? []).length;
      if (overlapsX && withinY && FIGURES_ONLY.test(seg.text) && (figures >= 2 || /%/.test(seg.text))) out.add(seg);
    }
  }
  return out;
}

export function extractFields(
  allSegments: Segment[],
  imageHeight: number,
  allTags?: LineTag[],
): Partial<Record<DeclarationKey, FieldHit>> {
  // The nutrition table is removed before any reader sees the panel.
  const nutrition = nutritionSegments(allSegments);
  const segments = allSegments.filter((s) => !nutrition.has(s));
  const tags = allTags && allTags.length === allSegments.length ? allTags.filter((_, i) => !nutrition.has(allSegments[i])) : allTags;

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
    FSSAI_LICENSE: readFssai(segments, batch?.value),
    BATCH_NUMBER: batch,
  };

  Object.keys(fields).forEach((key) => {
    const hit = fields[key as DeclarationKey];
    if (!hit || !hit.value.trim()) delete fields[key as DeclarationKey];
  });

  applyLegend(fields, segments);
  // Torn caption reads must be gone before the column stage decides what is still missing.
  sanitise(fields, segments);
  applyCaptionColumns(fields, segments);
  sanitise(fields, segments);

  // Nothing states the origin, but the manufacturer's address ends in a country:
  // that is where the goods were made ("Surabaya 60293, Indonesia." → Indonesia).
  if (!fields.COUNTRY_OF_ORIGIN) {
    const addressText = [fields.MANUFACTURER_NAME, fields.MANUFACTURER_ADDRESS]
      .flatMap((h) => h?.segments ?? [])
      .map((seg) => seg.text)
      .join(' ');
    const found = [...COUNTRIES]
      .map((c) => ({ c, at: addressText.toLowerCase().lastIndexOf(c) }))
      .filter((x) => x.at >= 0 && new RegExp(`\\b${x.c}\\b`, 'i').test(addressText))
      .sort((a, b) => b.at - a.at)[0];
    if (found && fields.MANUFACTURER_ADDRESS) {
      const country = found.c.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
      fields.COUNTRY_OF_ORIGIN = {
        value: country.length <= 3 ? country.toUpperCase() : country,
        segments: fields.MANUFACTURER_ADDRESS.segments,
        confidence: Math.min(0.7, fields.MANUFACTURER_ADDRESS.confidence),
      };
    } else if (fields.MANUFACTURER_ADDRESS && (INDIAN_STATE.test(addressText) || PIN_CODE.test(addressText.replace(/\s/g, '')))) {
      // An Indian state or a six-digit PIN in the manufacturer's address: made in India.
      fields.COUNTRY_OF_ORIGIN = {
        value: 'India',
        segments: fields.MANUFACTURER_ADDRESS.segments,
        confidence: Math.min(0.65, fields.MANUFACTURER_ADDRESS.confidence),
      };
    }
  }

  if (tags && tags.length === segments.length) {
    applyNlpFallbacks(fields, segments, tags);

    // The product name: prefer a line the classifier is confident is a product
    // name over one chosen on size alone, and drop a name that is not words.
    const current = fields.PRODUCT_IDENTITY;
    const currentTag = current ? tags[segments.indexOf(current.segments[0])] : undefined;
    const currentIsGarbage = current
      ? !looksLikeWords(current.value, 0.75) ||
        letterCount(current.value) < 4 ||
        letterCount(current.value) < current.value.replace(/\s/g, '').length * 0.6 ||
        // A lone word is only a product name when the classifier says so ("Dabur", "Colgate"); "RATE" is not.
        (!/\s/.test(current.value.trim()) &&
          (!(currentTag && currentTag.section === 'PRODUCT_IDENTITY' && currentTag.confidence >= 0.5) ||
            current.segments[0].capHeightPx < medianCap(segments) * 1.25))
      : true;
    const currentWeak = !current || currentIsGarbage || (currentTag !== undefined && currentTag.section === 'OTHER' && currentTag.confidence >= 0.9);
    if (currentWeak) {
      const tagged = segments
        .map((seg, i) => ({ seg, tag: tags[i] }))
        .filter(
          ({ seg, tag }) =>
            tag.section === 'PRODUCT_IDENTITY' &&
            tag.confidence >= 0.7 &&
            nameLike(seg.text) &&
            looksLikeWords(seg.text, 0.75) &&
            !/[.!?]$/.test(seg.text.trim()) &&
            seg.text.trim().split(/\s+/).length <= 6 &&
            // A lone word is a product name only when it is set large and is a real word of some length.
            (/\s/.test(seg.text.trim()) || (letterCount(seg.text) >= 5 && seg.capHeightPx >= medianCap(segments) * 1.25)),
        )
        .sort((a, b) => b.tag.confidence * b.seg.confidence - a.tag.confidence * a.seg.confidence);
      if (tagged.length) {
        const { seg, tag } = tagged[0];
        fields.PRODUCT_IDENTITY = { value: seg.text.trim(), segments: [seg], confidence: Math.min(INFERRED_CAP, seg.confidence, tag.confidence) };
      } else if (currentIsGarbage) {
        delete fields.PRODUCT_IDENTITY;
      }
    }
  }

  // The classifier fallbacks and the name override can add the same kinds of noise the caption readers do.
  sanitise(fields, segments);

  return fields;
}

function medianCap(segments: Segment[]): number {
  const caps = segments.map((s) => s.capHeightPx).sort((a, b) => a - b);
  return caps.length ? caps[Math.floor(caps.length / 2)] : 0;
}

/** True when the text reads as words: at least `ratio` of the tokens have vowels and three or more letters. */
function looksLikeWords(text: string, ratio = 0.6): boolean {
  const tokens = text.split(/\s+/).filter((t) => /[A-Za-z]/.test(t));
  if (tokens.length === 0) return false;
  const abbreviation = /^(?:ltd|pvt|llp|inc|co|mfg|mfd|mktd|regd|no|st|rd|dist|distt|po|hp|mh|tn|ka|up|wb|ap|ts|gj|rj|mp|dl|hr|pb|uk|jk|blr|hyd|ph|tel|fssai)\.?,?$/i;
  const good = tokens.filter(
    (t) =>
      abbreviation.test(t) ||
      (/[aeiouy]/i.test(t) && t.replace(/[^A-Za-z]/g, '').length >= 3 && !/[^A-Za-z0-9&()'.,\-\/%+]/.test(t)),
  ).length;
  return good >= Math.ceil(tokens.length * ratio);
}

/** True when the text carries a year between 2015 and 2036 (two-digit years read as 20xx), or a month-only duration. */
function plausibleDateText(text: string): boolean {
  if (/\b\d{1,2}\s*(?:months?|years?|days?)\b/i.test(text)) return true;
  const years: number[] = [];
  for (const m of text.matchAll(/(?<!\d)(20\d{2})(?!\d)/g)) years.push(Number(m[1]));
  for (const m of text.matchAll(/[/\-.](\d{2})(?!\d)/g)) years.push(2000 + Number(m[1]));
  for (const m of text.matchAll(/(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]{0,6}\.?[\s/\-.,]*(?:20)?(\d{2})(?!\d)/gi)) years.push(2000 + Number(m[1]));
  return years.some((y) => y >= 2015 && y <= 2036);
}

function letterCount(text: string): number {
  return text.replace(/[^A-Za-z]/g, '').length;
}
