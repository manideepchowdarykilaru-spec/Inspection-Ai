import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  FileBarChart,
  Layers,
  ListChecks,
  Lock,
  ScanLine,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

const CAPABILITIES = [
  {
    icon: ScanLine,
    title: 'AI-Powered Label Analysis',
    body: 'Package images are preprocessed, read with OCR and segmented into individual declarations — product identity, net quantity, retail price, manufacturer, consumer care, dates and country of origin.',
  },
  {
    icon: ListChecks,
    title: 'Rule-Based Compliance Validation',
    body: 'Extracted declarations are evaluated against a configurable catalogue of Legal Metrology rules. Every result carries the rule reference, the detected value and the reason it was flagged.',
  },
  {
    icon: FileBarChart,
    title: 'Digital Inspection Reports',
    body: 'Findings, evidence, the audit trail and officer remarks are compiled into a departmental inspection report that can be exported as PDF or an editable document.',
  },
];

const PIPELINE = [
  'Image capture',
  'Preprocessing',
  'OCR extraction',
  'Declaration detection',
  'Rule validation',
  'Screening score',
  'Officer review',
  'Inspection report',
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-navy-900">
            <ScanLine size={18} className="text-accent-400" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold tracking-tight text-slate-900">LM-Inspect AI</p>
            <p className="truncate text-2xs text-slate-500">
              Legal Metrology Packaged Commodity Compliance System
            </p>
          </div>
          <Link to="/login">
            <Button size="sm" variant="primary">
              Official sign in
            </Button>
          </Link>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-slate-200 bg-navy-900">
        <div className="gov-stripe absolute inset-0 opacity-60" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:py-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-2xs font-semibold uppercase tracking-wider text-accent-400">
              <BadgeCheck size={13} /> Decision-support for enforcement officers
            </span>
            <h1 className="mt-5 text-balance text-3xl font-extrabold leading-tight tracking-tight text-white sm:text-4xl lg:text-[2.75rem]">
              AI-Powered Legal Metrology Compliance Inspection
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-navy-200 sm:text-base">
              Automated detection, extraction and validation of packaged commodity declarations under the
              Legal Metrology (Packaged Commodities) Rules, 2011 — with evidence-linked findings and
              departmental reporting.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/login">
                <Button size="lg" variant="secondary" icon={<ScanLine size={16} />}>
                  Start Inspection
                </Button>
              </Link>
              <Link to="/login">
                <Button
                  size="lg"
                  variant="outline"
                  className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
                  icon={<ArrowRight size={16} />}
                >
                  Explore Platform
                </Button>
              </Link>
            </div>
            <dl className="mt-9 grid max-w-lg grid-cols-3 gap-4 border-t border-white/10 pt-6">
              {[
                { k: '17', v: 'Configurable rules' },
                { k: '12', v: 'Declarations tracked' },
                { k: '4', v: 'Evidence classes' },
              ].map((s) => (
                <div key={s.v}>
                  <dt className="text-2xl font-extrabold text-white">{s.k}</dt>
                  <dd className="mt-0.5 text-2xs leading-relaxed text-navy-300">{s.v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="relative">
            <div className="rounded-lg border border-white/10 bg-white/5 p-5 backdrop-blur">
              <p className="text-2xs font-bold uppercase tracking-wider text-accent-400">Inspection pipeline</p>
              <ol className="mt-4 space-y-2.5">
                {PIPELINE.map((step, i) => (
                  <li key={step} className="flex items-center gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/5 text-2xs font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="text-sm text-navy-100">{step}</span>
                    {i < 5 && (
                      <span className="ml-auto rounded bg-accent-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent-400">
                        automated
                      </span>
                    )}
                    {i >= 5 && (
                      <span className="ml-auto rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-navy-200">
                        officer
                      </span>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-5 md:grid-cols-3">
          {CAPABILITIES.map((c) => (
            <article key={c.title} className="surface p-5">
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-navy-50 text-navy-800">
                <c.icon size={19} />
              </span>
              <h2 className="text-sm font-bold tracking-tight text-slate-900">{c.title}</h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">{c.body}</p>
            </article>
          ))}
        </div>

        <div className="mt-10 grid gap-5 rounded-lg border border-slate-200 bg-slate-50 p-6 md:grid-cols-[auto_1fr] md:items-start">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-white text-navy-800 ring-1 ring-slate-200">
            <ShieldCheck size={19} />
          </span>
          <div>
            <h2 className="text-sm font-bold tracking-tight text-slate-900">
              Screening assistance, not legal determination
            </h2>
            <p className="mt-2 max-w-3xl text-xs leading-relaxed text-slate-600">
              The system detects, extracts and validates declarations to help officers prioritise
              verification. Every result is presented as a potential non-compliance requiring official
              verification. The final determination under the Legal Metrology Act, 2009 rests with the
              authorised official, based on applicable law and physical verification of the package where
              required.
            </p>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-2xs text-slate-500 sm:px-6">
          <span className="inline-flex items-center gap-1.5">
            <Layers size={12} /> Prototype developed for Smart India Hackathon
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Lock size={12} /> Authorized access only · inspection data is protected
          </span>
        </div>
      </footer>
    </div>
  );
}
