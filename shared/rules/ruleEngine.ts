import type {
  ComplianceRule,
  ComplianceStatus,
  Declaration,
  DeclarationKey,
  RuleResult,
  RuleStatus,
  ScoreBreakdown,
  Severity,
  Violation,
} from '@shared/types';
import { CATEGORY_MAX, COMPLIANCE_RULES, SCORE_BUCKET } from '@shared/data/rules';

/**
 * Configurable rule engine.
 *
 * Every rule is evaluated by a validator keyed on rule id. A validator receives
 * the extracted declarations plus the rule's own configurable params and returns
 * a status, a confidence, a plain-language explanation and the evidence region
 * that supports it. Adding a rule = adding a catalogue entry + a validator; no
 * screen needs to change.
 */

export interface RuleContext {
  declarations: Declaration[];
  byKey: Partial<Record<DeclarationKey, Declaration>>;
  rule: ComplianceRule;
  params: Record<string, number | string>;
}

interface ValidatorOutput {
  status: RuleStatus;
  detectedValue: string | null;
  expectation: string;
  explanation: string;
  confidence: number;
  declarationKey?: DeclarationKey;
}

type Validator = (ctx: RuleContext) => ValidatorOutput;

const NOT_DETECTED = 'Not detected on scanned label';

function presence(key: DeclarationKey, expectation: string, missingText: string): Validator {
  return ({ byKey }) => {
    const decl = byKey[key];
    const value = decl?.detectedValue ?? null;
    if (!value) {
      return {
        status: 'FAIL',
        detectedValue: null,
        expectation,
        explanation: missingText,
        confidence: decl?.confidence ?? 0.9,
        declarationKey: key,
      };
    }
    const lowConfidence = decl!.confidence < 0.75;
    return {
      status: lowConfidence ? 'REVIEW' : 'PASS',
      detectedValue: value,
      expectation,
      explanation: lowConfidence
        ? `Declaration was located but read with ${(decl!.confidence * 100).toFixed(0)}% confidence. Verify the printed text physically.`
        : `Declaration located on the label and read with ${(decl!.confidence * 100).toFixed(0)}% confidence.`,
      confidence: decl!.confidence,
      declarationKey: key,
    };
  };
}

const VALIDATORS: Record<string, Validator> = {
  /* --------------------------------------------- Mandatory declarations */
  'LMPC-R06-01': presence(
    'PRODUCT_IDENTITY',
    'Name / description identifying the commodity',
    'No product identity declaration could be isolated on the scanned panel.',
  ),
  'LMPC-R06-02': presence(
    'MANUFACTURER_NAME',
    'Name of manufacturer, packer or importer',
    'No manufacturer, packer or importer name was detected on the scanned panel.',
  ),
  'LMPC-R06-03': ({ byKey, params }) => {
    const decl = byKey.MANUFACTURER_ADDRESS;
    const value = decl?.detectedValue ?? null;
    const expectation = 'Complete address of manufacturing / packing premises with PIN code';
    if (!value) {
      return {
        status: 'FAIL',
        detectedValue: null,
        expectation,
        explanation: 'No address block was detected adjacent to the manufacturer declaration.',
        confidence: decl?.confidence ?? 0.9,
        declarationKey: 'MANUFACTURER_ADDRESS',
      };
    }
    const requirePin = Number(params.requirePinCode ?? 0) === 1;
    const hasPin = /\b\d{6}\b/.test(value.replace(/\s/g, ''));
    const isForeign = !/india/i.test(value) && !hasPin;
    if (requirePin && !hasPin && !isForeign) {
      return {
        status: 'REVIEW',
        detectedValue: value,
        expectation,
        explanation:
          'Address detected but no six-digit PIN code was recognised. Confirm whether the PIN code is printed on another panel.',
        confidence: decl!.confidence,
        declarationKey: 'MANUFACTURER_ADDRESS',
      };
    }
    return {
      status: 'PASS',
      detectedValue: value,
      expectation,
      explanation: isForeign
        ? 'Foreign manufacturing address detected; PIN code requirement is not applicable to the overseas premises.'
        : 'Complete address including PIN code detected.',
      confidence: decl!.confidence,
      declarationKey: 'MANUFACTURER_ADDRESS',
    };
  },
  'LMPC-R06-04': presence(
    'NET_QUANTITY',
    'Net quantity in standard units of weight / measure / number',
    'No net quantity declaration was detected. This is a mandatory declaration for every pre-packaged commodity.',
  ),
  'LMPC-R06-05': presence(
    'MRP',
    'Retail sale price declared as maximum retail price',
    'No retail sale price declaration was detected on the scanned panel.',
  ),
  'LMPC-R06-06': ({ byKey }) => {
    const decl = byKey.CONSUMER_CARE;
    const value = decl?.detectedValue ?? null;
    const expectation = 'Name, address, telephone number and e-mail of the consumer care contact';
    if (!value) {
      return {
        status: 'FAIL',
        detectedValue: null,
        expectation,
        explanation:
          'No consumer care declaration was detected. Rule 6(1)(f) requires contact details for redressal of consumer complaints.',
        confidence: decl?.confidence ?? 0.9,
        declarationKey: 'CONSUMER_CARE',
      };
    }
    const hasPhone = /(\+?\d[\d\s-]{7,})/.test(value);
    const hasEmail = /[\w.+-]+@[\w-]+\.[\w.]+/.test(value);
    if (!hasPhone || !hasEmail) {
      const missing = [!hasPhone && 'telephone number', !hasEmail && 'e-mail address']
        .filter(Boolean)
        .join(' and ');
      return {
        status: 'REVIEW',
        detectedValue: value,
        expectation,
        explanation: `Consumer care block detected but the ${missing} could not be recognised. Verify whether it is printed elsewhere on the package.`,
        confidence: decl!.confidence,
        declarationKey: 'CONSUMER_CARE',
      };
    }
    return {
      status: 'PASS',
      detectedValue: value,
      expectation,
      explanation: 'Consumer care name, telephone number and e-mail address were all detected.',
      confidence: decl!.confidence,
      declarationKey: 'CONSUMER_CARE',
    };
  },
  'LMPC-R06-07': ({ byKey }) => {
    const decl = byKey.DATE_OF_PACKING;
    const value = decl?.detectedValue ?? null;
    const expectation = 'Month and year of manufacture / packing / import';
    if (!value) {
      return {
        status: 'FAIL',
        detectedValue: null,
        expectation,
        explanation: 'No month-and-year of packing declaration was detected.',
        confidence: decl?.confidence ?? 0.9,
        declarationKey: 'DATE_OF_PACKING',
      };
    }
    const wellFormed = /(0[1-9]|1[0-2])[/\-.\s](20\d{2})/.test(value) || /[A-Za-z]{3,}\s*,?\s*20\d{2}/.test(value);
    return {
      status: wellFormed ? 'PASS' : 'REVIEW',
      detectedValue: value,
      expectation,
      explanation: wellFormed
        ? 'Month and year of packing detected in a recognised format.'
        : 'A date-like string was detected but the month/year could not be parsed reliably.',
      confidence: decl!.confidence,
      declarationKey: 'DATE_OF_PACKING',
    };
  },

  /* -------------------------------------------------------- Formatting */
  'LMPC-FMT-01': ({ byKey, params }) => {
    const decl = byKey.MRP;
    const value = decl?.detectedValue ?? null;
    const expectation = 'e.g. "MRP Rs. 650.00 (incl. of all taxes)"';
    if (!value) {
      return {
        status: 'NOT_APPLICABLE',
        detectedValue: null,
        expectation,
        explanation: 'Format cannot be evaluated because no price declaration was detected.',
        confidence: 0.9,
        declarationKey: 'MRP',
      };
    }
    const hasCurrency = /₹|\brs\.?\b/i.test(value);
    const hasPrefix = /\bmrp\b|maximum retail price/i.test(value);
    const requireTax = Number(params.requireInclusiveOfTaxes ?? 1) === 1;
    const hasTaxQualifier = /incl(usive)?\.?\s*(of)?\s*all\s*tax|incl\.? of all taxes|inclusive of all taxes/i.test(value);

    if (!hasCurrency) {
      return {
        status: 'FAIL',
        detectedValue: value,
        expectation,
        explanation: 'The price declaration does not carry the rupee symbol or the "Rs." prefix.',
        confidence: decl!.confidence,
        declarationKey: 'MRP',
      };
    }
    if (requireTax && !hasTaxQualifier && !hasPrefix) {
      return {
        status: 'FAIL',
        detectedValue: value,
        expectation,
        explanation:
          'The price is printed without the "Maximum Retail Price" prefix and without the "inclusive of all taxes" qualifier.',
        confidence: decl!.confidence,
        declarationKey: 'MRP',
      };
    }
    if (requireTax && !hasTaxQualifier) {
      return {
        status: 'REVIEW',
        detectedValue: value,
        expectation,
        explanation:
          'The "inclusive of all taxes" qualifier was not detected next to the price. Confirm whether it is printed on an adjacent panel.',
        confidence: decl!.confidence,
        declarationKey: 'MRP',
      };
    }
    return {
      status: 'PASS',
      detectedValue: value,
      expectation,
      explanation: 'Price declaration carries the MRP prefix, currency indicator and tax qualifier.',
      confidence: decl!.confidence,
      declarationKey: 'MRP',
    };
  },
  'LMPC-FMT-02': ({ byKey }) => {
    const decl = byKey.NET_QUANTITY;
    const value = decl?.detectedValue ?? null;
    const expectation = 'Numeral followed by an approved SI unit symbol, e.g. "500 g", "1 kg", "200 ml"';
    if (!value) {
      return {
        status: 'NOT_APPLICABLE',
        detectedValue: null,
        expectation,
        explanation: 'Format cannot be evaluated because no net quantity declaration was detected.',
        confidence: 0.9,
        declarationKey: 'NET_QUANTITY',
      };
    }
    const strict = /^\d+(\.\d+)?\s?(mg|g|kg|ml|l|cm|m|N)$/;
    const caseInsensitive = /^\d+(\.\d+)?\s?(mg|g|kg|ml|l|cm|m|n)$/i;
    const cleaned = value.trim();
    if (strict.test(cleaned)) {
      return {
        status: 'PASS',
        detectedValue: value,
        expectation,
        explanation: 'Quantity uses an approved SI unit symbol in the prescribed case.',
        confidence: decl!.confidence,
        declarationKey: 'NET_QUANTITY',
      };
    }
    if (caseInsensitive.test(cleaned)) {
      return {
        status: 'REVIEW',
        detectedValue: value,
        expectation,
        explanation:
          'Unit symbol is recognised but the letter case does not follow the prescribed SI symbol (e.g. "G" instead of "g"). Verify against the physical package.',
        confidence: decl!.confidence,
        declarationKey: 'NET_QUANTITY',
      };
    }
    return {
      status: 'FAIL',
      detectedValue: value,
      expectation,
      explanation:
        'Quantity is not expressed using an approved SI unit symbol — abbreviations such as "gms." and terminating full stops are not permitted.',
      confidence: decl!.confidence,
      declarationKey: 'NET_QUANTITY',
    };
  },
  'LMPC-FMT-03': ({ declarations }) => {
    const mandatoryKeys: DeclarationKey[] = [
      'PRODUCT_IDENTITY',
      'MANUFACTURER_NAME',
      'NET_QUANTITY',
      'MRP',
      'CONSUMER_CARE',
      'DATE_OF_PACKING',
    ];
    const missing = mandatoryKeys.filter(
      (k) => !declarations.find((d) => d.key === k)?.detectedValue,
    );
    const expectation = 'All mandatory declarations grouped on the principal display panel';
    if (missing.length === 0) {
      return {
        status: 'PASS',
        detectedValue: 'All mandatory declarations located on a single panel',
        expectation,
        explanation: 'Every mandatory declaration was detected within the scanned principal display panel.',
        confidence: 0.9,
      };
    }
    return {
      status: 'REVIEW',
      detectedValue: `${mandatoryKeys.length - missing.length} of ${mandatoryKeys.length} declarations located on the scanned panel`,
      expectation,
      explanation:
        'One or more mandatory declarations were not found on the scanned panel. Capture the remaining panels before concluding that they are absent.',
      confidence: 0.86,
    };
  },

  /* -------------------------------------------------------- Readability */
  'LMPC-RDB-01': ({ declarations, params }) => {
    const minMm = Number(params.minHeightMm ?? 1.5);
    const measured = declarations.filter((d) => d.detectedValue && d.readability);

    // A photograph carries no inherent scale. Without a physical reference the
    // print height genuinely cannot be measured, and the engine must say so
    // rather than convert pixels into millimetres it cannot justify.
    const unscaled = measured.filter((d) => !d.readability!.scaleKnown);
    if (measured.length > 0 && unscaled.length === measured.length) {
      const smallestPx = measured.reduce(
        (min, d) => Math.min(min, d.readability!.textHeightPx),
        Infinity,
      );
      return {
        status: 'REVIEW',
        detectedValue: `Smallest measured declaration: ${smallestPx} px (no scale reference)`,
        expectation: `Minimum printed height of ${minMm} mm for mandatory declarations`,
        explanation:
          'Print height cannot be derived from this image because the physical scale of the photograph is unknown. Record the panel width on the inspection, or measure the declaration on the package directly, before recording any finding on print height.',
        confidence: 0.6,
      };
    }
    const under = measured.filter((d) => d.readability!.estimatedMm < minMm);
    const borderline = measured.filter(
      (d) => d.readability!.estimatedMm >= minMm && d.readability!.estimatedMm < minMm * 1.12,
    );
    const expectation = `Minimum printed height of ${minMm} mm for mandatory declarations`;
    const smallest = measured.reduce(
      (min, d) => (d.readability!.estimatedMm < min.readability!.estimatedMm ? d : min),
      measured[0],
    );
    const detectedValue = smallest
      ? `Smallest measured declaration: ${smallest.label} at ~${smallest.readability!.estimatedMm} mm`
      : null;

    if (under.length >= 2) {
      return {
        status: 'FAIL',
        detectedValue,
        expectation,
        explanation: `${under.length} declarations (${under
          .map((d) => d.label)
          .join(', ')}) measure below the configured ${minMm} mm threshold. Image-based height estimation is approximate and should be confirmed with physical measurement.`,
        confidence: 0.82,
      };
    }
    if (under.length === 1 || borderline.length > 0) {
      const flagged = [...under, ...borderline];
      return {
        status: 'REVIEW',
        detectedValue,
        expectation,
        explanation: `${flagged
          .map((d) => d.label)
          .join(', ')} measured at or below the ${minMm} mm threshold. Estimation from a photograph carries a tolerance of roughly ±15%; physical verification is recommended.`,
        confidence: 0.79,
      };
    }
    return {
      status: 'PASS',
      detectedValue,
      expectation,
      explanation: `All measured declarations exceed the configured ${minMm} mm minimum height.`,
      confidence: 0.85,
    };
  },
  'LMPC-RDB-02': ({ declarations, params }) => {
    const minContrast = Number(params.minContrastRatio ?? 4.5);
    const minConfidence = Number(params.minOcrConfidence ?? 0.75);
    const measured = declarations.filter((d) => d.detectedValue && d.readability);
    const flagged = measured.filter(
      (d) =>
        d.readability!.contrastRatio < minContrast || d.readability!.ocrConfidence < minConfidence,
    );
    const expectation = `Contrast ratio ≥ ${minContrast}:1 and legible print on a contrasting ground`;
    const detectedValue = flagged.length
      ? `${flagged.length} declaration(s) below the legibility threshold`
      : 'All measured declarations legible';

    if (flagged.length >= 4) {
      return {
        status: 'FAIL',
        detectedValue,
        expectation,
        explanation: `${flagged
          .map((d) => d.label)
          .join(', ')} were printed at low contrast or read with low confidence, indicating the declarations are not conspicuously legible.`,
        confidence: 0.8,
      };
    }
    if (flagged.length > 0) {
      return {
        status: 'REVIEW',
        detectedValue,
        expectation,
        explanation: `${flagged
          .map((d) => d.label)
          .join(', ')} showed reduced contrast or OCR confidence. This may be caused by lighting or print wear — re-capture or verify physically.`,
        confidence: 0.83,
      };
    }
    return {
      status: 'PASS',
      detectedValue,
      expectation,
      explanation: 'All measured declarations met the configured contrast and confidence thresholds.',
      confidence: 0.88,
    };
  },

  /* ----------------------------------------------- Packaging & imports */
  'LMPC-PKG-01': presence(
    'COUNTRY_OF_ORIGIN',
    'Country of origin declared on the package',
    'No country of origin declaration was detected on the scanned panel.',
  ),
  'LMPC-IMP-01': ({ byKey }) => {
    const origin = byKey.COUNTRY_OF_ORIGIN?.detectedValue ?? '';
    const expectation = 'Name and complete address of the importer for imported commodities';
    const isImported = origin.trim().length > 0 && !/india/i.test(origin);
    if (!isImported) {
      return {
        status: 'NOT_APPLICABLE',
        detectedValue: origin || null,
        expectation,
        explanation:
          'Country of origin is India, so the importer declaration requirement is not triggered for this package.',
        confidence: 0.95,
        declarationKey: 'IMPORTER_DETAILS',
      };
    }
    const decl = byKey.IMPORTER_DETAILS;
    const value = decl?.detectedValue ?? null;
    if (!value) {
      return {
        status: 'FAIL',
        detectedValue: null,
        expectation,
        explanation: `Country of origin is declared as ${origin}, but no importer declaration was detected.`,
        confidence: decl?.confidence ?? 0.9,
        declarationKey: 'IMPORTER_DETAILS',
      };
    }
    const hasAddress = /\d{6}|\b(road|street|nagar|marg|plot|sector|industrial|park|floor)\b/i.test(value);
    if (!hasAddress || decl!.confidence < 0.8) {
      return {
        status: 'REVIEW',
        detectedValue: value,
        expectation,
        explanation:
          'An importer name was detected but the complete importer address could not be resolved with confidence. Physical verification of the importer block is required.',
        confidence: decl!.confidence,
        declarationKey: 'IMPORTER_DETAILS',
      };
    }
    return {
      status: 'PASS',
      detectedValue: value,
      expectation,
      explanation: 'Importer name and address detected for the imported commodity.',
      confidence: decl!.confidence,
      declarationKey: 'IMPORTER_DETAILS',
    };
  },
  'LMPC-PKG-02': presence(
    'BEST_BEFORE',
    'Best before / use-by declaration',
    'No best-before or use-by declaration was detected.',
  ),
  'LMPC-PKG-03': presence(
    'BATCH_NUMBER',
    'Batch, lot or code number',
    'No batch, lot or code number was detected on the scanned panel.',
  ),
  'LMPC-PKG-04': presence(
    'FSSAI_LICENSE',
    '14-digit FSSAI licence number',
    'No FSSAI licence number was detected on the scanned panel.',
  ),
};

/* ------------------------------------------------------------ Execution */

export function evaluateRules(
  declarations: Declaration[],
  rules: ComplianceRule[] = COMPLIANCE_RULES,
): RuleResult[] {
  const byKey = declarations.reduce<Partial<Record<DeclarationKey, Declaration>>>((acc, d) => {
    acc[d.key] = d;
    return acc;
  }, {});

  return rules
    .filter((rule) => rule.active)
    .map((rule) => {
      const validator = VALIDATORS[rule.id];
      const output: ValidatorOutput = validator
        ? validator({ declarations, byKey, rule, params: rule.params ?? {} })
        : {
            status: 'REVIEW',
            detectedValue: null,
            expectation: rule.description,
            explanation: 'No validator is registered for this rule; manual verification required.',
            confidence: 0.5,
          };

      const key = output.declarationKey ?? rule.declarationKey;
      const region = key ? byKey[key]?.region : undefined;

      return {
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        legalReference: rule.legalReference,
        declarationKey: key,
        detectedValue: output.detectedValue ?? (output.status === 'FAIL' ? NOT_DETECTED : null),
        expectation: output.expectation,
        status: output.status,
        severity: rule.severity,
        confidence: Number(output.confidence.toFixed(2)),
        explanation: output.explanation,
        evidenceRegion: region,
        weight: rule.weight,
      } satisfies RuleResult;
    });
}

/* -------------------------------------------------------------- Scoring */

const EARNED: Record<RuleStatus, number> = {
  PASS: 1,
  REVIEW: 0.5,
  FAIL: 0,
  NOT_APPLICABLE: 0,
};

export function scoreResults(results: RuleResult[]): {
  score: number;
  breakdown: ScoreBreakdown;
} {
  const buckets: Record<keyof typeof CATEGORY_MAX, { earned: number; applicable: number }> = {
    'Mandatory Declaration': { earned: 0, applicable: 0 },
    Formatting: { earned: 0, applicable: 0 },
    Readability: { earned: 0, applicable: 0 },
    'Packaging Information': { earned: 0, applicable: 0 },
  };

  results.forEach((r) => {
    const bucket = buckets[SCORE_BUCKET[r.category]];
    if (!bucket) return;
    if (r.status === 'NOT_APPLICABLE') return;
    bucket.applicable += r.weight;
    bucket.earned += r.weight * EARNED[r.status];
  });

  const normalise = (key: keyof typeof CATEGORY_MAX) => {
    const { earned, applicable } = buckets[key];
    const max = CATEGORY_MAX[key];
    if (applicable === 0) return { score: max, max };
    return { score: Math.round((earned / applicable) * max), max };
  };

  const breakdown: ScoreBreakdown = {
    mandatoryDeclarations: normalise('Mandatory Declaration'),
    formatting: normalise('Formatting'),
    readability: normalise('Readability'),
    packagingInformation: normalise('Packaging Information'),
  };

  const score =
    breakdown.mandatoryDeclarations.score +
    breakdown.formatting.score +
    breakdown.readability.score +
    breakdown.packagingInformation.score;

  return { score, breakdown };
}

/**
 * Screening status.
 *
 * A high-severity mandatory failure always lands in NON_COMPLIANT regardless of
 * the numeric score, so a single missing consumer-care block cannot be diluted
 * by an otherwise well-printed label.
 */
export function determineStatus(results: RuleResult[], score: number): ComplianceStatus {
  const detectedAnything = results.some((r) => r.status === 'PASS' || r.status === 'REVIEW');
  if (!detectedAnything) return 'NOT_DETECTED';

  const highFailure = results.some((r) => r.status === 'FAIL' && r.severity === 'HIGH');
  const anyFailure = results.some((r) => r.status === 'FAIL');
  // A low-severity advisory (typically image quality) does not by itself send a
  // well-declared package to manual review.
  const materialReview = results.some((r) => r.status === 'REVIEW' && r.severity !== 'LOW');

  if (highFailure || score < 70) return 'NON_COMPLIANT';
  if (anyFailure || materialReview || score < 90) return 'NEEDS_REVIEW';
  return 'COMPLIANT';
}

/* ----------------------------------------------------------- Violations */

const SEVERITY_ORDER: Record<Severity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

const RECOMMENDED_ACTION: Record<RuleStatus, string> = {
  FAIL: 'Verify the package physically against the applicable declaration requirement and record the finding before initiating action.',
  REVIEW:
    'Re-capture the panel in better lighting or verify the declaration on the physical package before recording a determination.',
  PASS: '',
  NOT_APPLICABLE: '',
};

export function deriveViolations(results: RuleResult[], inspectionId: string): Violation[] {
  return results
    .filter((r) => r.status === 'FAIL' || r.status === 'REVIEW')
    .map((r, index) => ({
      id: `${inspectionId}-V${String(index + 1).padStart(2, '0')}`,
      inspectionId,
      ruleId: r.ruleId,
      title: r.status === 'FAIL' ? r.ruleName : `${r.ruleName} — verification required`,
      category: r.category,
      // A REVIEW finding is advisory: it never carries more than MEDIUM severity.
      severity: r.status === 'REVIEW' && r.severity === 'HIGH' ? 'MEDIUM' : r.severity,
      detected: r.detectedValue ?? NOT_DETECTED,
      explanation: r.explanation,
      recommendedAction: RECOMMENDED_ACTION[r.status],
      legalReference: r.legalReference,
      confidence: r.confidence,
      evidenceRegion: r.evidenceRegion,
      state: 'OPEN' as const,
    }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function ruleById(id: string) {
  return COMPLIANCE_RULES.find((r) => r.id === id);
}
