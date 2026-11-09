"use client";

import { Download } from "lucide-react";

/** Downloads the given table as CSV (semicolon-separated, with BOM, so Excel opens it with Cyrillic intact). */
export function CsvButton({ rows, filename }: { rows: string[][]; filename: string }) {
  const download = () => {
    const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const text = "﻿" + rows.map((r) => r.map(esc).join(";")).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <button className="btn" onClick={download}>
      <Download size={14} /> CSV
    </button>
  );
}
