import type { AppNotification, Inspection, Report, User } from '@shared/types';
import { downloadTextFile, uid } from '@/lib/utils';
import { formatDateTime, RULE_STATUS_LABEL, STATUS_LABEL } from '@shared/lib/format';
import { getDb, mutate } from './storage';
import * as api from './api';

/**
 * Report service.
 *
 * In production `generateReport` posts to POST /api/v1/reports and the backend
 * renders the PDF (WeasyPrint / Puppeteer) and the editable DOCX, returning a
 * signed URL. In the prototype the same document model is rendered client-side:
 * print-to-PDF for the PDF path and a Word-compatible HTML document for the
 * editable path, so the demo produces genuine artefacts.
 */

export const REPORT_DISCLAIMER =
  'AI-generated findings are intended to assist inspection and screening. Final determination shall be made by the authorized Legal Metrology official based on applicable law, rules and physical verification where required.';

export function listReports() {
  return [...getDb().reports].sort((a, b) => +new Date(b.generatedAt) - +new Date(a.generatedAt));
}

export function getReport(id: string) {
  return getDb().reports.find((r) => r.id === id);
}

export function reportForInspection(inspectionId: string) {
  return getDb().reports.find((r) => r.inspectionId === inspectionId);
}

export function generateReport(inspection: Inspection, officer: User, format: 'PDF' | 'DOCX' = 'PDF'): Report {
  const existing = reportForInspection(inspection.id);
  const id = existing?.id ?? `RPT-2026-${inspection.id.split('-').pop()}`;
  const now = new Date().toISOString();

  const report: Report = {
    id,
    inspectionId: inspection.id,
    productName: inspection.productName,
    brand: inspection.brand,
    generatedAt: now,
    generatedBy: officer.name,
    status: 'FINALISED',
    format,
    screeningScore: inspection.screeningScore,
    complianceStatus: inspection.status,
    violationCount: inspection.violations.length,
  };

  const audit = {
    id: uid('log'),
    at: now,
    actor: officer.name,
    action: 'Inspection report generated',
    detail: `${id} · ${format}`,
  };
  const notification: AppNotification = {
    id: uid('ntf'),
    title: 'Report generated successfully',
    body: `${id} for inspection ${inspection.id} is available for download.`,
    priority: 'LOW',
    category: 'REPORT',
    createdAt: now,
    read: false,
    link: '/app/reports',
  };

  mutate(
    (draft) => {
      const index = draft.reports.findIndex((r) => r.id === id);
      if (index >= 0) draft.reports[index] = report;
      else draft.reports.unshift(report);

      const target = draft.inspections.find((i) => i.id === inspection.id);
      if (target) {
        target.reportId = id;
        target.auditLog.push(audit);
      }

      draft.notifications.unshift(notification);
    },
    () => api.createReport({ report, audit, notification }),
  );

  return report;
}

export function setReportStatus(reportId: string, status: Report['status']) {
  mutate(
    (draft) => {
      const report = draft.reports.find((r) => r.id === reportId);
      if (report) report.status = status;
    },
    () => api.patchReport(reportId, status),
  );
}

/* ------------------------------------------------------ Document builders */

function row(label: string, value: string) {
  return `<tr><th>${label}</th><td>${value ?? '—'}</td></tr>`;
}

export function buildReportHtml(inspection: Inspection, officer: User, reportId: string) {
  const declarations = inspection.declarations
    .map(
      (d) =>
        `<tr><td>${d.label}</td><td>${d.detectedValue ?? '<em>Not detected</em>'}</td><td>${(d.confidence * 100).toFixed(0)}%</td></tr>`,
    )
    .join('');

  const rules = inspection.ruleResults
    .map(
      (r) =>
        `<tr><td>${r.ruleId}</td><td>${r.ruleName}<div class="ref">${r.legalReference}</div></td><td>${r.detectedValue ?? '—'}</td><td>${RULE_STATUS_LABEL[r.status]}</td><td>${(r.confidence * 100).toFixed(0)}%</td></tr>`,
    )
    .join('');

  const violations = inspection.violations.length
    ? inspection.violations
        .map(
          (v, i) => `
          <div class="violation">
            <h4>Finding ${i + 1}: ${v.title}</h4>
            <p><strong>Severity:</strong> ${v.severity} &nbsp;|&nbsp; <strong>Rule:</strong> ${v.ruleId} &nbsp;|&nbsp; <strong>Reference:</strong> ${v.legalReference}</p>
            <p><strong>Detected:</strong> ${v.detected}</p>
            <p><strong>Basis:</strong> ${v.explanation}</p>
            <p><strong>Recommended verification:</strong> ${v.recommendedAction}</p>
            <p><strong>Status:</strong> ${v.state}${v.officerNote ? ` &nbsp;|&nbsp; <strong>Officer note:</strong> ${v.officerNote}` : ''}</p>
          </div>`,
        )
        .join('')
    : '<p>No findings were raised by the screening engine for this package.</p>';

  const audit = inspection.auditLog
    .map((a) => `<tr><td>${formatDateTime(a.at)}</td><td>${a.actor}</td><td>${a.action}</td><td>${a.detail ?? ''}</td></tr>`)
    .join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${reportId} — Legal Metrology Compliance Inspection Report</title>
<style>
  body { font-family: Georgia, 'Times New Roman', serif; color:#0f172a; margin:32px; line-height:1.5; }
  h1 { font-size:20px; text-align:center; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px; }
  h2 { font-size:13px; text-align:center; font-weight:normal; color:#475569; margin-top:0; }
  h3 { font-size:13px; text-transform:uppercase; letter-spacing:.8px; border-bottom:2px solid #0b2545; padding-bottom:4px; margin-top:26px; }
  table { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; }
  th, td { border:1px solid #cbd5e1; padding:6px 8px; text-align:left; vertical-align:top; }
  th { background:#f1f5f9; width:220px; }
  thead th { width:auto; }
  .ref { color:#64748b; font-size:10px; }
  .violation { border-left:3px solid #b91c1c; padding:6px 12px; margin:12px 0; background:#fef2f2; }
  .violation h4 { margin:0 0 6px; font-size:13px; }
  .violation p { margin:3px 0; font-size:12px; }
  .score { font-size:26px; font-weight:bold; }
  .disclaimer { margin-top:26px; border:1px solid #94a3b8; background:#f8fafc; padding:10px 12px; font-size:11px; font-style:italic; }
  .sign { margin-top:40px; display:flex; justify-content:space-between; font-size:12px; }
  .hdr { text-align:center; border-bottom:3px double #0b2545; padding-bottom:10px; }
</style></head>
<body>
  <div class="hdr">
    <div style="font-size:11px; letter-spacing:2px; text-transform:uppercase; color:#475569;">${officer.department}</div>
    <h1>Legal Metrology Compliance Inspection Report</h1>
    <h2>Legal Metrology (Packaged Commodities) Rules, 2011 — AI-assisted screening record</h2>
  </div>

  <h3>1. Inspection particulars</h3>
  <table>
    ${row('Report ID', reportId)}
    ${row('Inspection ID', inspection.id)}
    ${row('Date &amp; time of inspection', formatDateTime(inspection.inspectedAt))}
    ${row('Inspecting officer', `${officer.name} (${officer.officialId})`)}
    ${row('Designation', officer.designation)}
    ${row('Region / jurisdiction', inspection.region)}
    ${row('Place of inspection', inspection.location)}
    ${row('Source of sample', inspection.source.replace(/_/g, ' '))}
  </table>

  <h3>2. Product particulars</h3>
  <table>
    ${row('Commodity', inspection.productName)}
    ${row('Brand', inspection.brand)}
    ${row('Category', inspection.category)}
    ${row('Manufacturer / packer', inspection.declarations.find((d) => d.key === 'MANUFACTURER_NAME')?.detectedValue ?? 'Not declared')}
    ${row('Address', inspection.declarations.find((d) => d.key === 'MANUFACTURER_ADDRESS')?.detectedValue ?? 'Not declared')}
    ${row('Importer', inspection.declarations.find((d) => d.key === 'IMPORTER_DETAILS')?.detectedValue ?? 'Not applicable')}
    ${row('Country of origin', inspection.declarations.find((d) => d.key === 'COUNTRY_OF_ORIGIN')?.detectedValue ?? 'Not declared')}
  </table>

  <h3>3. Declarations extracted from the label</h3>
  <table><thead><tr><th>Declaration</th><th>Value read from package</th><th>OCR confidence</th></tr></thead>
  <tbody>${declarations}</tbody></table>

  <h3>4. Rule validation</h3>
  <table><thead><tr><th>Rule</th><th>Requirement</th><th>Detected</th><th>Result</th><th>Confidence</th></tr></thead>
  <tbody>${rules}</tbody></table>

  <h3>5. Findings</h3>
  ${violations}

  <h3>6. AI screening result</h3>
  <table>
    ${row('AI screening score', `<span class="score">${inspection.screeningScore} / 100</span>`)}
    ${row('Mandatory declarations', `${inspection.scoreBreakdown.mandatoryDeclarations.score} / ${inspection.scoreBreakdown.mandatoryDeclarations.max}`)}
    ${row('Formatting', `${inspection.scoreBreakdown.formatting.score} / ${inspection.scoreBreakdown.formatting.max}`)}
    ${row('Readability', `${inspection.scoreBreakdown.readability.score} / ${inspection.scoreBreakdown.readability.max}`)}
    ${row('Packaging information', `${inspection.scoreBreakdown.packagingInformation.score} / ${inspection.scoreBreakdown.packagingInformation.max}`)}
    ${row('Final screening status', STATUS_LABEL[inspection.status])}
  </table>

  <h3>7. Inspector remarks</h3>
  <p>${inspection.remarks ?? 'No remarks recorded.'}</p>

  <h3>8. Evidence and audit trail</h3>
  <p>${inspection.evidenceIds.length} evidence item(s) linked to this inspection.</p>
  <table><thead><tr><th>Timestamp</th><th>Actor</th><th>Action</th><th>Detail</th></tr></thead>
  <tbody>${audit}</tbody></table>

  <div class="disclaimer">${REPORT_DISCLAIMER}</div>

  <div class="sign">
    <div>Generated by LM-Inspect AI on ${formatDateTime(new Date().toISOString())}</div>
    <div>__________________________<br/>${officer.name}<br/>${officer.designation}</div>
  </div>
</body></html>`;
}

export function printReport(html: string) {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  const doc = frame.contentWindow?.document;
  if (!doc) return;
  doc.open();
  doc.write(html);
  doc.close();
  frame.contentWindow?.focus();
  setTimeout(() => {
    frame.contentWindow?.print();
    setTimeout(() => document.body.removeChild(frame), 1000);
  }, 350);
}

/** Word-compatible export. Opens in Word/LibreOffice as a fully editable document. */
export function downloadEditableReport(html: string, reportId: string) {
  const doc = html.replace(
    '<head>',
    '<head><meta name="ProgId" content="Word.Document"><meta name="Generator" content="LM-Inspect AI">',
  );
  downloadTextFile(`${reportId}.doc`, doc, 'application/msword');
}

export function downloadReportJson(inspection: Inspection, reportId: string) {
  downloadTextFile(
    `${reportId}.json`,
    JSON.stringify({ reportId, disclaimer: REPORT_DISCLAIMER, inspection }, null, 2),
    'application/json',
  );
}
