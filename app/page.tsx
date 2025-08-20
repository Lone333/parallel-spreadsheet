'use client';

import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import Spreadsheet from 'react-spreadsheet';
import './page.css';

type Point = { row: number; column: number };
type Range = { start: Point; end: Point };
type Cell = { value: string | number | ''; readOnly?: boolean; className?: string };
type RunMapEntry = { row: number; targetCols: number[]; targetHeaders: string[] };
type RunMap = Record<string, RunMapEntry>;

// Processor options with descriptions
const PROCESSORS = [
  { value: 'lite', label: 'Lite', description: 'Basic information retrieval' },
  { value: 'base', label: 'Base', description: 'Simple web research' },
  { value: 'core', label: 'Core', description: 'Complex web research' },
  { value: 'pro', label: 'Pro', description: 'Exploratory web research' }
];

// Helper to normalize headers for fuzzy matching
function norm(s: string) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '').trim();
}

export default function Page() {
  // Initial data with some sample companies
  const [data, setData] = useState<Cell[][]>([
    [{ value: 'Company' }, { value: 'Stage' }, { value: 'Employee Count' }],
    [{ value: 'Mintlify' }, { value: '' }, { value: '' }],
    [{ value: 'Etched' }, { value: '' }, { value: '' }],
    [{ value: 'LangChain' }, { value: '' }, { value: '' }],
    [{ value: 'Mixpanel' }, { value: '' }, { value: '' }],
    [{ value: 'Octolane AI' }, { value: '' }, { value: '' }],
    [{ value: 'Cognition AI' }, { value: '' }, { value: '' }],
    [{ value: 'Mercor' }, { value: '' }, { value: '' }],
    [{ value: 'Browserbase' }, { value: '' }, { value: '' }],
    [{ value: 'Supabase' }, { value: '' }, { value: '' }],
    [{ value: 'Martian' }, { value: '' }, { value: '' }],
  ]);

  const [range, setRange] = useState<Range | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [processor, setProcessor] = useState('lite');
  const [successCount, setSuccessCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [lastEnrichTime, setLastEnrichTime] = useState<number | null>(null);
  const [hoveredCell] = useState<Point | null>(null);
  const [initialPendingCount, setInitialPendingCount] = useState<number>(0);
  const [flashCells, setFlashCells] = useState<Set<string>>(new Set());
  const esRef = useRef<EventSource | null>(null);
  const successCountRef = useRef(0);
  const errorCountRef = useRef(0);
  const initialPendingCountRef = useRef(0);
  const [liveMessage, setLiveMessage] = useState('');
  const [currentTaskGroupId, setCurrentTaskGroupId] = useState<string | null>(null);

  const dataRef = useRef(data);
  const syncRef = <T,>(ref: React.MutableRefObject<T>, value: T) => { ref.current = value; };

  useEffect(() => { syncRef(dataRef, data); }, [data]);
  useEffect(() => { syncRef(successCountRef, successCount); }, [successCount]);
  useEffect(() => { syncRef(errorCountRef, errorCount); }, [errorCount]);
  useEffect(() => { syncRef(initialPendingCountRef, initialPendingCount); }, [initialPendingCount]);

  // Ensure any open EventSource is closed when the component unmounts
  useEffect(() => {
    return () => {
      if (esRef.current) {
        try { esRef.current.close(); } catch { }
        esRef.current = null;
      }
    };
  }, []);


  // Header helpers
  const headers = useMemo(() => (data[0] || []).map((c) => (c?.value ?? '').toString()), [data]);
  const headerIndex: Record<string, number> = useMemo(() => {
    const map: Record<string, number> = {};
    headers.forEach((h, i) => (map[norm(h)] = i));
    return map;
  }, [headers]);

  // Pending state management
  const cellKey = useCallback((p: Point) => `${p.row}:${p.column}`, []);

  const addPending = useCallback((cells: Point[]) =>
    setPending(prev => {
      const next = new Set(prev);
      cells.forEach(p => next.add(`${p.row}:${p.column}`));
      return next;
    }), []);

  const clearPending = useCallback((cells: Point[]) =>
    setPending(prev => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      cells.forEach(p => next.delete(`${p.row}:${p.column}`));
      return next;
    }), []);

  const isPending = (r: number, c: number) => pending.has(`${r}:${c}`);


  // Selection handler
  const onSelect = useCallback(
    (selected: unknown) => {
      try {
        const selectionType = selected?.constructor?.name || '';
        if (selectionType === 'EmptySelection') return;

        const sel = selected as { toRange?: (data: Cell[][]) => Range | null };
        const r = sel?.toRange?.(data);

        if (r?.start && r?.end) {
          const maxRow = data.length - 1;
          const maxCol = (data[0] || []).length - 1;
          const start: Point = {
            row: Math.max(0, Math.min(maxRow, r.start.row)),
            column: Math.max(0, Math.min(maxCol, r.start.column)),
          };
          const end: Point = {
            row: Math.max(0, Math.min(maxRow, r.end.row)),
            column: Math.max(0, Math.min(maxCol, r.end.column)),
          };
          const normRange: Range = {
            start: { row: Math.min(start.row, end.row), column: Math.min(start.column, end.column) },
            end: { row: Math.max(start.row, end.row), column: Math.max(start.column, end.column) },
          };
          setRange(normRange);
        }
      } catch (error) {
        console.error('Error in onSelect:', error);
      }
    },
    [data]
  );

  // Apply enrichment results
  const applyRowResult = useCallback(
    (row: number, content: unknown, targetHeaders?: string[], targetCols?: number[]) => {
      const obj: Record<string, unknown> =
        content && typeof content === 'object' && !Array.isArray(content)
          ? content as Record<string, unknown>
          : {};

      setData((prev) => {
        const next = prev.map((rowArr) => rowArr.slice());
        const headerRow = next[0] || [];
        const rowArr = next[row] || [];
        const tCols =
          targetCols && targetCols.length
            ? targetCols
            : (targetHeaders || [])
              .map((h) => headerIndex[norm(h)])
              .filter((x) => Number.isInteger(x)) as number[];

        for (const [k, v] of Object.entries(obj)) {
          let col = headerIndex[norm(k)];

          if (!Number.isInteger(col) && targetHeaders && targetHeaders.length) {
            const nk = norm(k);
            const idx = targetHeaders.findIndex((th) => norm(th) === nk);
            if (idx >= 0) col = tCols[idx];
          }

          if (Number.isInteger(col) && col! >= 0 && col! < headerRow.length) {
            rowArr[col!] = { ...(rowArr[col!] || {}), value: v as string | number | '' };
            clearPending([{ row, column: col! }]);
            setSuccessCount(prev => prev + 1);
            const key = cellKey({ row, column: col! });
            setFlashCells(prev => new Set(prev).add(key));
            setTimeout(() => setFlashCells(prev => { const next = new Set(prev); next.delete(key); return next; }), 800);
          }
        }

        return next;
      });
    },
    [headerIndex, clearPending, cellKey]
  );

  const addColumn = useCallback(() => {
    setData(prev => {
      const next = prev.map(row => [...row, { value: '' }]);
      const newCol = prev[0]?.length || 0;
      setRange({ start: { row: 0, column: newCol }, end: { row: 0, column: newCol } });
      return next;
    });
  }, []);

  const deleteColumn = useCallback(() => {
    if (!range || data[0].length <= 1) return;
    const colToDelete = range.start.column;
    setData(prev => prev.map(row => row.filter((_, idx) => idx !== colToDelete)));
    setRange(null);
  }, [range, data]);

  const addRow = useCallback(() => {
    setData(prev => [...prev, Array(prev[0]?.length || 5).fill({ value: '' })]);
  }, []);

  const deleteRow = useCallback(() => {
    if (!range || range.start.row === 0 || data.length <= 2) return;
    setData(prev => prev.filter((_, idx) => idx !== range.start.row));
    setRange(null);
  }, [range, data]);

  const clearSelection = useCallback(() => setRange(null), []);

  // Cancel enrichment function
  const cancelEnrichment = useCallback(async () => {
    if (!currentTaskGroupId || !busy) return;

    try {
      const res = await fetch('/api/parallel', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskgroup_id: currentTaskGroupId })
      });

      if (res.ok) {
        console.log('Successfully cancelled task group:', currentTaskGroupId);
      } else {
        const error = await res.text();
        console.error('Failed to cancel task group:', error);
      }
    } catch (err) {
      console.error('Error cancelling enrichment:', err);
    }

    // Close EventSource
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    // Clear all pending states and reset UI
    setPending(new Set());
    setBusy(false);
    setCurrentTaskGroupId(null);
    setLiveMessage('Enrichment cancelled');

    // Show cancelled status
    setLastEnrichTime(null);
    setSuccessCount(0);
    setErrorCount(0);
  }, [currentTaskGroupId, busy]);

  // Main enrichment function
  const enrich = useCallback(async () => {
    if (!range || busy) return;

    const startTime = Date.now();

    // Save range before clearing selection
    const startRow = Math.max(1, range.start.row);
    const endRow = Math.max(startRow, range.end.row);
    const startCol = range.start.column;
    const endCol = range.end.column;

    // Clear selection to remove active border (matches button click behavior)
    clearSelection();

    // Blur the active element to remove focus outline (matches button click behavior)
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    const headersRow = (data[0] || []).map((c) => (c?.value ?? '').toString());
    const selectedCells: Point[] = [];
    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) selectedCells.push({ row: r, column: c });
    }

    addPending(selectedCells);
    setInitialPendingCount(selectedCells.length);
    setSuccessCount(0);
    setErrorCount(0);
    setLiveMessage(`Research started. 0 of ${selectedCells.length} cells filled.`);

    const rowsPayload: {
      row: number;
      context: Record<string, string | number | ''>;
      targetHeaders: string[];
      targetCols: number[];
    }[] = [];

    for (let r = startRow; r <= endRow; r++) {
      const rowVals = data[r]?.map(c => c?.value ?? '') || [];
      const context = Object.fromEntries(headersRow.map((h, i) => [h, rowVals[i] as string | number | '']));
      const tCols = Array.from({ length: endCol - startCol + 1 }, (_, i) => startCol + i);
      const tHeaders = tCols.map(c => headersRow[c]);

      rowsPayload.push({ row: r, context, targetHeaders: tHeaders, targetCols: tCols });
    }

    try {
      setBusy(true);

      const res = await fetch('/api/parallel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sheet: {
            headers: headersRow,
            rows: data.slice(1).map((row) => (row || []).map((c) => (c?.value ?? ''))),
          },
          selection: { startRow, endRow, startCol, endCol },
          rows: rowsPayload,
          processor,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Parallel init failed: ${res.status} - ${errorText}`);
      }

      const responseData = await res.json();
      const { taskgroup_id, run_map } = responseData as { taskgroup_id: string; run_map: RunMap };

      // Store the taskgroup_id for potential cancellation
      setCurrentTaskGroupId(taskgroup_id);

      const es = new EventSource(`/api/parallel?taskgroup_id=${encodeURIComponent(taskgroup_id)}`);
      esRef.current = es;

      const handleEventData = (obj: unknown) => {
        const data = obj as Record<string, unknown>;
        const eventType = data?.type;

        if (eventType === 'task_run.state' || eventType === 'task_run') {
          const run = data?.run as Record<string, unknown>;
          const runStatus = run?.status;
          const runId = run?.run_id as string | undefined;

          if (runStatus === 'completed' && data?.output) {
            const output = data.output as Record<string, unknown>;
            const out = output.content || data.output;

            if (runId && run_map[runId]) {
              const meta = run_map[runId];
              applyRowResult(meta.row, out, meta.targetHeaders, meta.targetCols);
              setLiveMessage(`Filling… ${successCountRef.current + 1} of ${initialPendingCountRef.current} cells done`);
            }
          } else if (runStatus === 'failed') {
            setErrorCount(prev => prev + 1);
            if (runId && run_map[runId]) {
              const meta = run_map[runId];
              const cellsToClear: Point[] = [];
              for (const col of meta.targetCols) {
                cellsToClear.push({ row: meta.row, column: col });
              }
              clearPending(cellsToClear);
              setLiveMessage(`Some cells failed. ${successCountRef.current} filled, ${errorCountRef.current + 1} failed`);
            }
          }
        } else if (eventType === 'task_group_status') {
          const status = data?.status as Record<string, unknown>;
          const isActive = status?.is_active;
          if (isActive === false) {
            es.close();
            esRef.current = null;
            clearPending(selectedCells);
            clearTimeout(timeout);
            setLastEnrichTime(Date.now() - startTime);
            setBusy(false);
            setCurrentTaskGroupId(null);
          }
        }
      };

      es.addEventListener('task_run.state', (evt: MessageEvent) => {
        try {
          const obj = JSON.parse(evt.data);
          handleEventData(obj);
        } catch (error) {
          console.error('Error parsing task_run.state event:', error);
        }
      });

      es.addEventListener('task_group_status', (evt: MessageEvent) => {
        try {
          const obj = JSON.parse(evt.data);
          handleEventData(obj);
        } catch (error) {
          console.error('Error parsing task_group_status event:', error);
        }
      });

      es.onmessage = (evt) => {
        try {
          if (!evt.data || evt.data.trim() === '' || evt.data.startsWith(':')) return;

          const obj = JSON.parse(evt.data);
          handleEventData(obj);
        } catch (error) {
          console.error('Error processing event:', error);
        }
      };

      es.onerror = (error) => {
        console.error('EventSource error:', error);
        es.close();
        esRef.current = null;
        setBusy(false);
        setCurrentTaskGroupId(null);
        clearPending(selectedCells);
      };
      // keep busy=true until task group completes or errors

      const timeout = setTimeout(() => {
        es.close();
        esRef.current = null;
        clearPending(selectedCells);
        setBusy(false);
        setCurrentTaskGroupId(null);
      }, 600000);

      const originalOnError = es.onerror;
      es.onerror = (error) => {
        clearTimeout(timeout);
        originalOnError.call(es, error);
      };
    } catch (err) {
      console.error(err);
      setBusy(false);
      setCurrentTaskGroupId(null);
      clearPending(selectedCells);
    }
  }, [range, data, applyRowResult, busy, processor, clearSelection, addPending, clearPending]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Block all modifications during enrichment
      if (busy) {
        if (key === 'escape') {
          clearSelection();
        }
        return;
      }

      if (mod && key === 'k') {
        e.preventDefault();
        addColumn();
      } else if (mod && key === 'j') {
        e.preventDefault();
        addRow();
      } else if (mod && key === 'enter') {
        e.preventDefault();
        if (range) enrich();
      } else if (mod && key === 'backspace') {
        e.preventDefault();
        if (range) {
          const isFullColumn = range.start.row === 0 && range.end.row === data.length - 1 && range.start.column === range.end.column;
          const isFullRow = range.start.column === 0 && range.end.column === data[0].length - 1 && range.start.row === range.end.row && range.start.row > 0;
          if (isFullColumn) deleteColumn();
          else if (isFullRow) deleteRow();
        }
      } else if (key === 'escape') {
        clearSelection();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [busy, range, data, addColumn, addRow, enrich, deleteColumn, deleteRow, clearSelection]);

  const selectionStats = useMemo(() =>
    range ? {
      rows: range.end.row - range.start.row + 1,
      cols: range.end.column - range.start.column + 1,
      cells: (range.end.row - range.start.row + 1) * (range.end.column - range.start.column + 1)
    } : null, [range]);

  return (
    <div className="app-container">
      {/* Background gradient */}
      <div className="background-gradient" />

      {/* Main container */}
      <div className="main-content">
        {/* Header */}
        <header className="header">
          <div className="header-content">
            <div className="logo-section">
              <div className="logo">
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect width="32" height="32" rx="8" fill="url(#logo-gradient)" />
                  <g transform="translate(16, 16)">
                    <circle r="5" fill="none" stroke="white" strokeWidth="1.5" />
                    <circle r="2" fill="white" />
                    <path d="M0,-8 L0,-6 M0,6 L0,8 M-8,0 L-6,0 M6,0 L8,0" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M-5.66,-5.66 L-4.24,-4.24 M4.24,4.24 L5.66,5.66 M5.66,-5.66 L4.24,-4.24 M-4.24,4.24 L-5.66,5.66" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
                  </g>
                  <defs>
                    <linearGradient id="logo-gradient" x1="0" y1="0" x2="32" y2="32">
                      <stop stopColor="#fb6c3d" />
                      <stop offset="1" stopColor="#ff7a50" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
              <div>
                <h1 className="app-title">Parallel Spreadsheet</h1>
                <p className="app-subtitle">AI-powered data enrichment</p>
              </div>
            </div>

            {/* Controls section */}
            <div className="header-controls">
              {/* Power selector */}
              <div className="processor-selector">
                <div className="processor-segmented" role="tablist" aria-label="Power">
                  {PROCESSORS.map(p => (
                    <button
                      key={p.value}
                      role="tab"
                      aria-selected={processor === p.value}
                      className={`processor-chip ${processor === p.value ? 'active' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); setProcessor(p.value); }}
                      disabled={busy}
                      title={p.description}
                      aria-label={`Set research mode: ${p.label}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="header-divider" />

              <button
                onMouseDown={(e) => { e.preventDefault(); addColumn(); }}
                className="btn btn-secondary btn-compact"
                title="Add Column (⌘K)"
                aria-label="Add Column"
                disabled={busy}
              >
                + Column
              </button>

              <button
                onMouseDown={(e) => { e.preventDefault(); addRow(); }}
                className="btn btn-secondary btn-compact"
                title="Add Row (⌘J)"
                aria-label="Add Row"
                disabled={busy}
              >
                + Row
              </button>
            </div>

            <div className="header-stats">
              {range && !busy && !lastEnrichTime && (
                <div className="stat-badge">
                  <span className="stat-number">{selectionStats?.cells}</span>
                  <span className="stat-label">cells selected</span>
                </div>
              )}

              {busy && (
                <>
                  <button className="btn-cancel" onClick={cancelEnrichment} title="Cancel enrichment" aria-label="Cancel enrichment">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M11 3L3 11M3 3L11 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                  <div className="stat-badge">
                    <div className="spinner" style={{ width: '12px', height: '12px', marginRight: '6px' }} />
                    <span className="stat-label">{initialPendingCount - pending.size} of {initialPendingCount} cells</span>
                  </div>
                </>
              )}

              {!busy && lastEnrichTime && (
                <>
                  <div className="stat-badge success">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path d="M11.6667 3.5L5.25 10L2.33333 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {(lastEnrichTime / 1000).toFixed(1)}s
                  </div>
                  {successCount > 0 && (
                    <div className="stat-badge">
                      <span className="stat-number">{successCount}</span>
                      <span className="stat-label">enriched</span>
                    </div>
                  )}
                  {errorCount > 0 && (
                    <div className="stat-badge error">
                      <span className="stat-number">{errorCount}</span>
                      <span className="stat-label">failed</span>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Enrich button - rightmost */}
            <button
              onClick={enrich}
              disabled={!range || busy}
              className="btn btn-primary"
              title="Enrich Selection (⌘↵)"
              aria-label="Enrich Selection"
            >
              {busy ? (
                <>
                  <div className="spinner" />
                  <span>Enriching…</span>
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M8 1V5M8 11V15M1 8H5M11 8H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M3.5 3.5L5.5 5.5M10.5 10.5L12.5 12.5M12.5 3.5L10.5 5.5M5.5 10.5L3.5 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                  <span>Enrich</span>
                </>
              )}
            </button>
          </div>
        </header>


        {/* Live region for screen readers */}
        <div className="sr-only" aria-live="polite">{liveMessage}</div>

        {/* Spreadsheet */}
        <div className="spreadsheet-wrapper">
          <div className={`spreadsheet-container ${busy ? 'spreadsheet-readonly' : ''}`}>
            <Spreadsheet
              data={data.map((row, r) =>
                row.map((cell, c) => {
                  const base = cell || { value: '' };
                  const key = `${r}:${c}`;
                  const computedClass = isPending(r, c) ? 'cell-pending' :
                    hoveredCell?.row === r && hoveredCell?.column === c ? 'cell-hover' :
                      flashCells.has(key) ? 'cell-flash' : '';
                  const className = [computedClass, base.className || ''].filter(Boolean).join(' ');
                  return { ...base, className, value: base.value || '', readOnly: busy || base.readOnly };
                })
              )}
              onChange={(newData) => {
                if (busy) return;
                setData(newData.map(row => row.map(cell => cell || { value: '' })) as Cell[][]);
              }}
              onSelect={busy ? undefined : onSelect}
              darkMode={true}
            />
          </div>
        </div>

        {/* Footer */}
        <footer className="footer">
          <div className="footer-content">
            <div className="footer-left">
              <span className="footer-text">Powered by</span>
              <a
                href="https://parallel.ai"
                target="_blank"
                rel="noopener noreferrer"
                className="footer-link"
              >
                Parallel AI
              </a>
            </div>
            <div className="footer-right">
              <kbd className="kbd">⌘K</kbd>
              <span className="kbd-label">Add Column</span>
              <kbd className="kbd">⌘J</kbd>
              <span className="kbd-label">Add Row</span>
              <kbd className="kbd">⌘↵</kbd>
              <span className="kbd-label">Enrich</span>
            </div>
          </div>
        </footer>
      </div>

      {/* Styles moved to app/page.css */}
    </div>
  );
}
