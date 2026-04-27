'use client';

import { useMemo } from 'react';
import {
  ChevronUp,
  ChevronDown,
  ArrowUpDown,
  Settings2,
  ChevronRight as ChevronRightIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { StatusBadge } from '@/components/tests/status-badge';
import { cn, timeAgo } from '@/lib/utils';
import type { Test } from '@/lib/db/schema';

export interface TestWithStatus extends Test {
  latestStatus: string | null;
  lastRunAt: Date | null;
}

export type TestsTableColumnKey =
  | 'status'
  | 'lastRun'
  | 'lastModified'
  | 'area'
  | 'description'
  | 'targetUrl';

export type TestsTableSortKey =
  | 'name'
  | 'status'
  | 'lastRun'
  | 'lastModified'
  | 'area'
  | 'targetUrl';

export interface TestsTableSort {
  key: TestsTableSortKey;
  dir: 'asc' | 'desc';
}

const ALL_TOGGLEABLE_COLUMNS: TestsTableColumnKey[] = [
  'status',
  'lastRun',
  'lastModified',
  'area',
  'description',
  'targetUrl',
];

const COLUMN_LABELS: Record<TestsTableColumnKey, string> = {
  status: 'Status',
  lastRun: 'Last run',
  lastModified: 'Last modified',
  area: 'Area',
  description: 'Description',
  targetUrl: 'Target URL',
};

export function defaultVisibleColumns(scoped: boolean): Set<TestsTableColumnKey> {
  const cols: TestsTableColumnKey[] = ['status', 'lastRun', 'lastModified'];
  if (!scoped) cols.push('area');
  return new Set(cols);
}

const STORED_VERSION = 1;

export function parseStoredColumns(raw: string | null): Set<TestsTableColumnKey> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: number; cols?: unknown };
    if (parsed.v !== STORED_VERSION || !Array.isArray(parsed.cols)) return null;
    const valid = parsed.cols.filter((c): c is TestsTableColumnKey =>
      typeof c === 'string' && (ALL_TOGGLEABLE_COLUMNS as string[]).includes(c),
    );
    return new Set(valid);
  } catch {
    return null;
  }
}

export function serializeColumns(cols: Set<TestsTableColumnKey>): string {
  return JSON.stringify({ v: STORED_VERSION, cols: Array.from(cols) });
}

export function parseStoredSort(raw: string | null): TestsTableSort | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: number; key?: unknown; dir?: unknown };
    if (parsed.v !== STORED_VERSION) return null;
    const validKeys: TestsTableSortKey[] = ['name', 'status', 'lastRun', 'lastModified', 'area', 'targetUrl'];
    if (typeof parsed.key !== 'string' || !validKeys.includes(parsed.key as TestsTableSortKey)) return null;
    if (parsed.dir !== 'asc' && parsed.dir !== 'desc') return null;
    return { key: parsed.key as TestsTableSortKey, dir: parsed.dir };
  } catch {
    return null;
  }
}

export function serializeSort(sort: TestsTableSort): string {
  return JSON.stringify({ v: STORED_VERSION, key: sort.key, dir: sort.dir });
}

type NullableCompareResult = { kind: 'null'; value: number } | { kind: 'value'; value: number };

function compareNullable<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  cmp: (x: T, y: T) => number,
): NullableCompareResult {
  const an = a == null;
  const bn = b == null;
  if (an && bn) return { kind: 'null', value: 0 };
  if (an) return { kind: 'null', value: 1 }; // nulls last
  if (bn) return { kind: 'null', value: -1 };
  return { kind: 'value', value: cmp(a as T, b as T) };
}

function getSortValue(
  test: TestWithStatus,
  key: TestsTableSortKey,
  getAreaName: (id: string | null) => string | null,
): string | number | Date | null {
  switch (key) {
    case 'name':
      return test.name;
    case 'status':
      return test.latestStatus;
    case 'lastRun':
      return test.lastRunAt;
    case 'lastModified':
      return test.updatedAt;
    case 'area':
      return getAreaName(test.functionalAreaId ?? null);
    case 'targetUrl':
      return test.targetUrl ?? null;
  }
}

export function compareTests(
  a: TestWithStatus,
  b: TestWithStatus,
  key: TestsTableSortKey,
  dir: 'asc' | 'desc',
  getAreaName: (id: string | null) => string | null,
): number {
  const av = getSortValue(a, key, getAreaName);
  const bv = getSortValue(b, key, getAreaName);
  const result = compareNullable(av, bv, (x, y) => {
    if (x instanceof Date && y instanceof Date) return x.getTime() - y.getTime();
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    const xs = String(x).toLowerCase();
    const ys = String(y).toLowerCase();
    return xs < ys ? -1 : xs > ys ? 1 : 0;
  });
  if (result === null) return 0;
  return dir === 'asc' ? result : -result;
}

export interface TestsTableViewProps {
  tests: TestWithStatus[];
  scoped: boolean;
  selectedTestIds: Set<string>;
  toggleSelect: (id: string, shiftKey: boolean) => void;
  onOpenTest: (id: string) => void;
  highlightedTestId: string | null;
  getAreaName: (areaId: string | null) => string | null;
  sort: TestsTableSort;
  onSortChange: (s: TestsTableSort) => void;
  visibleColumns: Set<TestsTableColumnKey>;
  onVisibleColumnsChange: (cols: Set<TestsTableColumnKey>) => void;
}

const DEFAULT_DESC_KEYS: ReadonlySet<TestsTableSortKey> = new Set(['lastRun', 'lastModified']);

export function TestsTableView({
  tests,
  scoped: _scoped,
  selectedTestIds,
  toggleSelect,
  onOpenTest,
  highlightedTestId,
  getAreaName,
  sort,
  onSortChange,
  visibleColumns,
  onVisibleColumnsChange,
}: TestsTableViewProps) {
  const sortedTests = useMemo(() => {
    const copy = tests.slice();
    copy.sort((a, b) => compareTests(a, b, sort.key, sort.dir, getAreaName));
    return copy;
  }, [tests, sort.key, sort.dir, getAreaName]);

  const handleHeaderClick = (key: TestsTableSortKey) => {
    if (sort.key === key) {
      onSortChange({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange({ key, dir: DEFAULT_DESC_KEYS.has(key) ? 'desc' : 'asc' });
    }
  };

  const toggleColumn = (col: TestsTableColumnKey) => {
    const next = new Set(visibleColumns);
    if (next.has(col)) next.delete(col);
    else next.add(col);
    onVisibleColumnsChange(next);
  };

  const SortHeader = ({
    label,
    sortKey,
    align = 'left',
  }: {
    label: string;
    sortKey: TestsTableSortKey;
    align?: 'left' | 'right';
  }) => {
    const active = sort.key === sortKey;
    return (
      <button
        type="button"
        onClick={() => handleHeaderClick(sortKey)}
        className={cn(
          'inline-flex items-center gap-1 hover:text-foreground transition-colors',
          align === 'right' && 'flex-row-reverse',
          active ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        <span>{label}</span>
        {active ? (
          sort.dir === 'asc' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col">
      {/* Toolbar — Columns picker */}
      <div className="flex items-center justify-end px-4 py-2 border-b border-border/50 bg-muted/20">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 text-xs">
              <Settings2 className="h-3.5 w-3.5 mr-1.5" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-xs">Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {ALL_TOGGLEABLE_COLUMNS.map((col) => (
              <DropdownMenuCheckboxItem
                key={col}
                checked={visibleColumns.has(col)}
                onCheckedChange={() => toggleColumn(col)}
                onSelect={(e) => e.preventDefault()}
              >
                {COLUMN_LABELS[col]}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 border-b border-border/50 text-xs">
            <tr>
              <th className="px-4 py-2 w-8" />
              <th className="px-3 py-2 text-left font-medium">
                <SortHeader label="Name" sortKey="name" />
              </th>
              {visibleColumns.has('status') && (
                <th className="px-3 py-2 text-left font-medium w-28">
                  <SortHeader label="Status" sortKey="status" />
                </th>
              )}
              {visibleColumns.has('lastRun') && (
                <th className="px-3 py-2 text-left font-medium w-32">
                  <SortHeader label="Last run" sortKey="lastRun" />
                </th>
              )}
              {visibleColumns.has('lastModified') && (
                <th className="px-3 py-2 text-left font-medium w-32">
                  <SortHeader label="Last modified" sortKey="lastModified" />
                </th>
              )}
              {visibleColumns.has('area') && (
                <th className="px-3 py-2 text-left font-medium w-40">
                  <SortHeader label="Area" sortKey="area" />
                </th>
              )}
              {visibleColumns.has('description') && (
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Description
                </th>
              )}
              {visibleColumns.has('targetUrl') && (
                <th className="px-3 py-2 text-left font-medium w-48">
                  <SortHeader label="Target URL" sortKey="targetUrl" />
                </th>
              )}
              <th className="px-4 py-2 w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {sortedTests.map((test) => {
              const isHighlighted = highlightedTestId === test.id;
              const areaName = getAreaName(test.functionalAreaId ?? null);
              return (
                <tr
                  key={test.id}
                  id={`test-row-${test.id}`}
                  onClick={() => onOpenTest(test.id)}
                  className={cn(
                    'hover:bg-muted/30 transition-colors cursor-pointer group',
                    isHighlighted && 'bg-primary/5 ring-1 ring-inset ring-primary/20',
                  )}
                >
                  <td className="px-4 py-2 align-middle">
                    <Checkbox
                      checked={selectedTestIds.has(test.id)}
                      onCheckedChange={() => {}}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSelect(test.id, e.shiftKey);
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 align-middle">
                    <div className="font-medium truncate group-hover:text-primary transition-colors max-w-[28rem]">
                      {test.name}
                    </div>
                  </td>
                  {visibleColumns.has('status') && (
                    <td className="px-3 py-2 align-middle">
                      <StatusBadge status={test.latestStatus} />
                    </td>
                  )}
                  {visibleColumns.has('lastRun') && (
                    <td
                      className="px-3 py-2 align-middle text-muted-foreground"
                      title={test.lastRunAt ? new Date(test.lastRunAt).toLocaleString() : undefined}
                    >
                      {test.lastRunAt ? timeAgo(test.lastRunAt) : '—'}
                    </td>
                  )}
                  {visibleColumns.has('lastModified') && (
                    <td
                      className="px-3 py-2 align-middle text-muted-foreground"
                      title={test.updatedAt ? new Date(test.updatedAt).toLocaleString() : undefined}
                    >
                      {test.updatedAt ? timeAgo(test.updatedAt) : '—'}
                    </td>
                  )}
                  {visibleColumns.has('area') && (
                    <td className="px-3 py-2 align-middle text-muted-foreground">
                      <span className="truncate block max-w-[10rem]" title={areaName ?? undefined}>
                        {areaName ?? '—'}
                      </span>
                    </td>
                  )}
                  {visibleColumns.has('description') && (
                    <td className="px-3 py-2 align-middle text-muted-foreground">
                      <span
                        className="truncate block max-w-[24rem]"
                        title={test.description ?? undefined}
                      >
                        {test.description ?? '—'}
                      </span>
                    </td>
                  )}
                  {visibleColumns.has('targetUrl') && (
                    <td className="px-3 py-2 align-middle text-muted-foreground">
                      <span
                        className="truncate block max-w-[16rem]"
                        title={test.targetUrl ?? undefined}
                      >
                        {test.targetUrl ?? '—'}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-2 align-middle">
                    <ChevronRightIcon className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
