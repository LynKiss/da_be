/**
 * Tạo CSV string từ array of objects.
 *
 * - Auto-detect column từ keys của object đầu tiên (hoặc dùng explicit `columns` để fix order/header).
 * - Escape đúng RFC 4180: bao "" nếu có dấu phẩy, newline, hoặc dấu ".
 * - BOM ﻿ prepended cho Excel mở trực tiếp tiếng Việt không lỗi font.
 *
 * Dùng cho: orders, products, inventory ledger, audit logs, valuation, profitability.
 */
export interface CsvColumn<T> {
  key: keyof T | string;
  header: string;
  /** Custom getter — override default object[key] */
  get?: (row: T) => string | number | null | undefined;
}

export function toCsv<T extends Record<string, any>>(
  rows: T[],
  columns?: CsvColumn<T>[],
): string {
  if (!rows.length && !columns?.length) return '﻿';

  const cols: CsvColumn<T>[] =
    columns ??
    Object.keys(rows[0] ?? {}).map((k) => ({ key: k, header: k }));

  const headerLine = cols.map((c) => escapeCsvField(c.header)).join(',');
  const dataLines = rows.map((row) =>
    cols
      .map((c) => {
        const raw = c.get ? c.get(row) : (row as any)[c.key];
        return escapeCsvField(formatValue(raw));
      })
      .join(','),
  );

  return '﻿' + [headerLine, ...dataLines].join('\r\n');
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Helper: tạo Content-Disposition + Content-Type cho HTTP response trả về CSV.
 */
export function csvResponseHeaders(filename: string): Record<string, string> {
  const safeName = filename.replace(/[^a-z0-9._-]+/gi, '_');
  return {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${safeName}"`,
  };
}
