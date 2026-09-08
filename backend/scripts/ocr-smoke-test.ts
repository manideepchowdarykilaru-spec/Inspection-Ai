import { readFileSync } from 'node:fs';
import { recognisePackage, shutdown } from '../src/ocr/index';
import { COMPLIANCE_RULES } from '@shared/data/rules';
import { evaluateRules, scoreResults, determineStatus, deriveViolations } from '@shared/rules/ruleEngine';

const buffer = readFileSync(new URL('../../scratch/test-label.png', import.meta.url));

for (const panelWidthMm of [undefined, 150]) {
  const { declarations, ocr } = await recognisePackage({ buffer, imageId: 'img-test', panelWidthMm });
  const ruleResults = evaluateRules(declarations, COMPLIANCE_RULES);
  const { score, breakdown } = scoreResults(ruleResults);
  const status = determineStatus(ruleResults, score);
  const violations = deriveViolations(ruleResults, 'LM-TEST');

  console.log(`\n=== panelWidthMm=${panelWidthMm ?? 'none'} (dpi ${ocr.estimatedDpi || 'unknown'}) ===`);
  console.log(`score ${score}/100  status ${status}  findings ${violations.length}`);
  console.log(
    `  mandatory ${breakdown.mandatoryDeclarations.score}/${breakdown.mandatoryDeclarations.max}` +
      `  formatting ${breakdown.formatting.score}/${breakdown.formatting.max}` +
      `  readability ${breakdown.readability.score}/${breakdown.readability.max}` +
      `  packaging ${breakdown.packagingInformation.score}/${breakdown.packagingInformation.max}`,
  );
  violations.forEach((v) => console.log(`  [${v.severity}] ${v.title}`));
}
await shutdown();
