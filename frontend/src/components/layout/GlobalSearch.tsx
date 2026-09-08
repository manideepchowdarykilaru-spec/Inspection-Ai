import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, FileBarChart, FileCheck2, Search, ShieldAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getDb } from '@/services/storage';
import { STATUS_SHORT } from '@shared/lib/format';

interface Hit {
  id: string;
  type: 'Inspection' | 'Product' | 'Report' | 'Violation';
  title: string;
  subtitle: string;
  to: string;
}

const ICON = {
  Inspection: FileCheck2,
  Product: Boxes,
  Report: FileBarChart,
  Violation: ShieldAlert,
};

function search(term: string): Hit[] {
  const q = term.trim().toLowerCase();
  if (q.length < 2) return [];
  const db = getDb();
  const hits: Hit[] = [];

  db.inspections.forEach((i) => {
    if (`${i.id} ${i.productName} ${i.brand} ${i.inspectorName} ${i.location}`.toLowerCase().includes(q)) {
      hits.push({
        id: i.id,
        type: 'Inspection',
        title: `${i.id} · ${i.productName}`,
        subtitle: `${i.brand} · ${STATUS_SHORT[i.status]} · score ${i.screeningScore}`,
        to: `/app/inspections/${i.id}`,
      });
    }
    i.violations.forEach((v) => {
      if (`${v.title} ${v.ruleId}`.toLowerCase().includes(q)) {
        hits.push({
          id: v.id,
          type: 'Violation',
          title: v.title,
          subtitle: `${v.ruleId} · ${i.productName} · ${i.id}`,
          to: `/app/inspections/${i.id}?finding=${v.id}`,
        });
      }
    });
  });

  db.products.forEach((p) => {
    if (`${p.name} ${p.brand} ${p.manufacturer} ${p.barcode}`.toLowerCase().includes(q)) {
      hits.push({
        id: p.id,
        type: 'Product',
        title: p.name,
        subtitle: `${p.brand} · ${p.manufacturer}`,
        to: `/app/products/${p.id}`,
      });
    }
  });

  db.reports.forEach((r) => {
    if (`${r.id} ${r.productName} ${r.inspectionId}`.toLowerCase().includes(q)) {
      hits.push({
        id: r.id,
        type: 'Report',
        title: r.id,
        subtitle: `${r.productName} · ${r.brand}`,
        to: `/app/reports/${r.id}`,
      });
    }
  });

  return hits.slice(0, 12);
}

export function GlobalSearch({ className }: { className?: string }) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const hits = useMemo(() => search(term), [term]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const go = (hit: Hit) => {
    navigate(hit.to);
    setOpen(false);
    setTerm('');
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        ref={inputRef}
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
          setCursor(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setCursor((c) => Math.min(hits.length - 1, c + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setCursor((c) => Math.max(0, c - 1));
          } else if (e.key === 'Enter' && hits[cursor]) {
            go(hits[cursor]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls="global-search-results"
        aria-label="Search inspections, products, reports and violations"
        placeholder="Search inspections, products, reports…"
        className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-16 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
      />
      {term ? (
        <button
          type="button"
          onClick={() => setTerm('')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600"
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      ) : (
        <span className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-1 md:flex">
          <kbd className="kbd">Ctrl</kbd>
          <kbd className="kbd">K</kbd>
        </span>
      )}

      {open && term.trim().length >= 2 && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-11 z-50 max-h-[22rem] overflow-y-auto rounded-md border border-slate-200 bg-white shadow-elevated"
        >
          {hits.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-500">
              No records match “{term}”.
            </p>
          ) : (
            hits.map((hit, i) => {
              const Icon = ICON[hit.type];
              return (
                <button
                  key={`${hit.type}-${hit.id}`}
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(hit)}
                  className={cn(
                    'flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-0',
                    i === cursor ? 'bg-brand-50' : 'hover:bg-slate-50',
                  )}
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-slate-100 text-slate-500">
                    <Icon size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-800">{hit.title}</span>
                    <span className="block truncate text-2xs text-slate-500">{hit.subtitle}</span>
                  </span>
                  <span className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-2xs font-medium text-slate-500">
                    {hit.type}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
