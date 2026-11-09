"use client";

import { useState } from "react";
import Papa from "papaparse";
import { importRowsAction } from "@/app/actions";

const BATCH = 250;

type Log = { file: string; text: string; ok: boolean };

export function CsvImport({ regions }: { regions: { code: string; name: string }[] }) {
  const [region, setRegion] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [log, setLog] = useState<Log[]>([]);

  async function importFile(file: File) {
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    const [header, ...rows] = parsed.data;
    if (!header?.length) return { file: file.name, text: "порожній файл", ok: false };
    const name = file.name.replace(/\.csv$/i, "");
    let created = 0;
    let updated = 0;
    let skipped = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      setProgress(`${file.name}: ${Math.min(i + BATCH, rows.length)} з ${rows.length}`);
      const r = await importRowsAction({ header, rows: rows.slice(i, i + BATCH), regionCode: region || null, fileName: name });
      if (!r.ok) return { file: file.name, text: r.message ?? "помилка", ok: false };
      created += r.created ?? 0;
      updated += r.updated ?? 0;
      skipped += r.skipped ?? 0;
    }
    return { file: file.name, text: `нових ${created}, оновлено ${updated}, без змін ${skipped}`, ok: true };
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select className="input" value={region} onChange={(e) => setRegion(e.target.value)} disabled={busy}>
          <option value="">Регіон визначати з назви кампанії</option>
          {regions.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
        <label className={`btn btn-accent ${busy ? "opacity-60" : ""}`}>
          {busy ? "Імпортую…" : "Обрати CSV-файли"}
          <input
            type="file"
            accept=".csv,text/csv"
            multiple
            className="hidden"
            disabled={busy}
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              if (!files.length) return;
              setBusy(true);
              for (const f of files) {
                try {
                  const res = await importFile(f);
                  setLog((l) => [res, ...l]);
                } catch (err) {
                  setLog((l) => [{ file: f.name, text: err instanceof Error ? err.message : String(err), ok: false }, ...l]);
                }
              }
              setProgress(null);
              setBusy(false);
            }}
          />
        </label>
        {progress && <span className="text-[12px] text-muted">{progress}</span>}
      </div>
      {log.length > 0 && (
        <ul className="flex flex-col gap-1 text-[12.5px]">
          {log.map((l, i) => (
            <li key={i} className={l.ok ? "text-good" : "text-bad"}>
              {l.file}: {l.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
