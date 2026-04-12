'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useMissionControl } from '@/lib/store';
import type { Task, TaskStatus } from '@/lib/types';
import { formatDistanceToNow } from 'date-fns';

// ── Constants ────────────────────────────────────────────────────────────────

const CANVAS_POSITIONS_KEY = 'mc-canvas-positions';
const CARD_W = 224;
const CARD_H = 118;

const ZONES: Array<{
  id: TaskStatus;
  label: string;
  bg: string;
  border: string;
  x: number;
  y: number;
  w: number;
  h: number;
}> = [
  { id: 'planning',     label: '📋 Planning',      bg: 'rgba(163,113,247,0.08)', border: '#a371f7', x: 20,   y: 20,  w: 310, h: 340 },
  { id: 'inbox',        label: '📥 Inbox',          bg: 'rgba(219,97,162,0.08)',  border: '#db61a2', x: 350,  y: 20,  w: 310, h: 340 },
  { id: 'assigned',     label: '📌 Assigned',       bg: 'rgba(210,153,34,0.08)', border: '#d29922', x: 680,  y: 20,  w: 310, h: 340 },
  { id: 'in_progress',  label: '⚡ In Progress',    bg: 'rgba(88,166,255,0.08)',  border: '#58a6ff', x: 1010, y: 20,  w: 310, h: 340 },
  { id: 'testing',      label: '🔬 Testing',        bg: 'rgba(57,211,83,0.08)',   border: '#39d353', x: 20,   y: 380, w: 310, h: 340 },
  { id: 'review',       label: '👁 Review',         bg: 'rgba(163,113,247,0.08)', border: '#a371f7', x: 350,  y: 380, w: 310, h: 340 },
  { id: 'verification', label: '✅ Verification',   bg: 'rgba(248,81,73,0.08)',   border: '#f85149', x: 680,  y: 380, w: 310, h: 340 },
  { id: 'done',         label: '✔ Done',            bg: 'rgba(63,185,80,0.08)',   border: '#3fb950', x: 1010, y: 380, w: 310, h: 340 },
];

const CANVAS_W = 1340;
const CANVAS_H = 740;

const PRIORITY_COLORS: Record<string, string> = {
  low:    '#8b949e',
  normal: '#58a6ff',
  high:   '#d29922',
  urgent: '#f85149',
};

// ── localStorage helpers ─────────────────────────────────────────────────────

type Pos = { x: number; y: number };
type PosMap = Record<string, Pos>;

function loadPositions(): PosMap {
  try { return JSON.parse(localStorage.getItem(CANVAS_POSITIONS_KEY) || '{}'); }
  catch { return {}; }
}
function savePositions(p: PosMap) {
  try { localStorage.setItem(CANVAS_POSITIONS_KEY, JSON.stringify(p)); } catch {}
}

// Place a new card inside its status zone, slotting left→right, top→bottom
function computeDefaultPos(task: Task, existing: PosMap): Pos {
  const zone = ZONES.find(z => z.id === task.status);
  if (!zone) return { x: 80 + Math.random() * 400, y: 80 + Math.random() * 300 };
  const taken = Object.entries(existing)
    .filter(([, p]) => p.x >= zone.x && p.x < zone.x + zone.w && p.y >= zone.y && p.y < zone.y + zone.h)
    .length;
  const cols = Math.max(1, Math.floor((zone.w - 16) / (CARD_W + 8)));
  const col = taken % cols;
  const row = Math.floor(taken / cols);
  return {
    x: zone.x + 8 + col * (CARD_W + 8),
    y: zone.y + 38 + row * (CARD_H + 8),
  };
}

// ── Component ────────────────────────────────────────────────────────────────

interface CanvasViewProps { workspaceId?: string }

export function CanvasView({ workspaceId: _workspaceId }: CanvasViewProps) {
  const { tasks, updateTaskStatus, addEvent } = useMissionControl();
  const containerRef = useRef<HTMLDivElement>(null);

  // View transform
  const [xform, setXform] = useState({ x: 40, y: 30, scale: 0.82 });
  const xformRef = useRef(xform);
  useEffect(() => { xformRef.current = xform; }, [xform]);

  // Card positions
  const [positions, setPositions] = useState<PosMap>({});
  const posRef = useRef(positions);
  useEffect(() => { posRef.current = positions; }, [positions]);

  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragOffset = useRef<Pos>({ x: 0, y: 0 });

  // Pan state
  const [panning, setPanning] = useState(false);
  const panOrigin = useRef({ mx: 0, my: 0, tx: 0, ty: 0 });

  // ── Initialise positions from localStorage ──────────────────────────────
  useEffect(() => {
    const saved = loadPositions();
    const next: PosMap = {};
    tasks.forEach(task => {
      next[task.id] = saved[task.id] ?? computeDefaultPos(task, next);
    });
    setPositions(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  // Place newly-added tasks that have no position yet
  useEffect(() => {
    setPositions(prev => {
      let changed = false;
      const next = { ...prev };
      tasks.forEach(task => {
        if (!next[task.id]) {
          next[task.id] = computeDefaultPos(task, next);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [tasks]);

  // ── Zoom with scroll wheel ───────────────────────────────────────────────
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.92 : 1.09;
    const t = xformRef.current;
    const newScale = Math.min(2.5, Math.max(0.2, t.scale * factor));
    const ratio = newScale / t.scale;
    setXform({ x: mx - ratio * (mx - t.x), y: my - ratio * (my - t.y), scale: newScale });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // ── Global mouse move / up ───────────────────────────────────────────────
  const onGlobalMove = useCallback((e: MouseEvent) => {
    if (panning) {
      setXform(t => ({
        ...t,
        x: e.clientX - panOrigin.current.mx + panOrigin.current.tx,
        y: e.clientY - panOrigin.current.my + panOrigin.current.ty,
      }));
    }
    if (draggingId) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const t = xformRef.current;
      const cx = (e.clientX - rect.left - t.x) / t.scale;
      const cy = (e.clientY - rect.top - t.y) / t.scale;
      setPositions(prev => ({
        ...prev,
        [draggingId]: { x: cx - dragOffset.current.x, y: cy - dragOffset.current.y },
      }));
    }
  }, [panning, draggingId]);

  const onGlobalUp = useCallback(async () => {
    if (panning) setPanning(false);

    if (draggingId) {
      const pos = posRef.current[draggingId];
      if (pos) {
        // Detect which zone the card centre fell into
        const cx = pos.x + CARD_W / 2;
        const cy = pos.y + CARD_H / 2;
        const zone = ZONES.find(z =>
          cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h,
        );
        const task = tasks.find(t => t.id === draggingId);
        if (zone && task && zone.id !== task.status) {
          updateTaskStatus(draggingId, zone.id);
          try {
            const res = await fetch(`/api/tasks/${draggingId}`, {
              method: 'PATCH',
              headers: {
                'Content-Type': 'application/json',
                'x-mc-board-override': 'true',
              },
              body: JSON.stringify({ status: zone.id, board_override: true }),
            });
            if (res.ok) {
              addEvent({
                id: draggingId + '-' + Date.now(),
                type: zone.id === 'done' ? 'task_completed' : 'task_status_changed',
                task_id: draggingId,
                message: `Canvas: task moved to ${zone.id}`,
                created_at: new Date().toISOString(),
              });
            }
          } catch (err) {
            console.warn('Canvas drop — API call failed (change applied locally):', err);
          }
        }
        savePositions(posRef.current);
      }
      setDraggingId(null);
    }
  }, [panning, draggingId, tasks, updateTaskStatus, addEvent]);

  useEffect(() => {
    window.addEventListener('mousemove', onGlobalMove);
    window.addEventListener('mouseup', onGlobalUp);
    return () => {
      window.removeEventListener('mousemove', onGlobalMove);
      window.removeEventListener('mouseup', onGlobalUp);
    };
  }, [onGlobalMove, onGlobalUp]);

  // ── Background pan start ─────────────────────────────────────────────────
  const onBgDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || draggingId) return;
    e.preventDefault();
    setPanning(true);
    panOrigin.current = { mx: e.clientX, my: e.clientY, tx: xform.x, ty: xform.y };
  };

  // ── Card drag start ───────────────────────────────────────────────────────
  const onCardDown = (e: React.MouseEvent, taskId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = xformRef.current;
    const cx = (e.clientX - rect.left - t.x) / t.scale;
    const cy = (e.clientY - rect.top - t.y) / t.scale;
    const pos = posRef.current[taskId] ?? { x: 0, y: 0 };
    dragOffset.current = { x: cx - pos.x, y: cy - pos.y };
    setDraggingId(taskId);
  };

  // ── Minimap ───────────────────────────────────────────────────────────────
  const MM = 0.095;
  const mmW = Math.round(CANVAS_W * MM);
  const mmH = Math.round(CANVAS_H * MM);

  const resetView = (e: React.MouseEvent) => {
    e.stopPropagation();
    setXform({ x: 40, y: 30, scale: 0.82 });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden relative bg-mc-bg select-none"
      style={{ cursor: panning ? 'grabbing' : draggingId ? 'grabbing' : 'grab' }}
      onMouseDown={onBgDown}
    >
      {/* ── Canvas world ───────────────────────────────────────────────── */}
      <div
        style={{
          position: 'absolute',
          left: 0, top: 0,
          transform: `translate(${xform.x}px,${xform.y}px) scale(${xform.scale})`,
          transformOrigin: '0 0',
          width: CANVAS_W,
          height: CANVAS_H,
        }}
      >
        {/* Zones */}
        {ZONES.map(z => (
          <div
            key={z.id}
            style={{
              position: 'absolute',
              left: z.x, top: z.y, width: z.w, height: z.h,
              background: z.bg,
              border: `1.5px solid ${z.border}70`,
              borderRadius: 10,
              pointerEvents: 'none',
            }}
          >
            <div style={{
              padding: '7px 11px',
              fontSize: 10.5,
              fontWeight: 700,
              color: z.border,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              borderBottom: `1px solid ${z.border}30`,
            }}>
              {z.label}
            </div>
          </div>
        ))}

        {/* Cards */}
        {tasks.map(task => {
          const pos = positions[task.id];
          if (!pos) return null;
          const zone = ZONES.find(z => z.id === task.status);
          return (
            <CanvasCard
              key={task.id}
              task={task}
              x={pos.x}
              y={pos.y}
              accentColor={zone?.border ?? '#8b949e'}
              isDragging={draggingId === task.id}
              onMouseDown={onCardDown}
            />
          );
        })}
      </div>

      {/* ── Zoom controls ──────────────────────────────────────────────── */}
      <div
        className="absolute top-4 right-4 flex flex-col gap-1.5 z-20"
        onMouseDown={e => e.stopPropagation()}
      >
        {([
          { label: '+', act: () => setXform(t => ({ ...t, scale: Math.min(2.5, t.scale * 1.2) })) },
          { label: '−', act: () => setXform(t => ({ ...t, scale: Math.max(0.2, t.scale * 0.83) })) },
        ] as const).map(({ label, act }) => (
          <button
            key={label}
            onClick={act}
            className="w-8 h-8 bg-mc-bg-secondary border border-mc-border rounded flex items-center justify-center text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary font-bold text-base"
          >{label}</button>
        ))}
        <button
          onClick={resetView}
          title="Reset view"
          className="w-8 h-8 bg-mc-bg-secondary border border-mc-border rounded flex items-center justify-center text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary text-sm"
        >⟳</button>
      </div>

      {/* ── Minimap ────────────────────────────────────────────────────── */}
      <div
        className="absolute bottom-4 right-4 z-20 bg-mc-bg-secondary border border-mc-border rounded-lg overflow-hidden"
        style={{ width: mmW + 16, padding: 8 }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div style={{ position: 'relative', width: mmW, height: mmH }}>
          {/* Zone outlines in minimap */}
          {ZONES.map(z => (
            <div key={z.id} style={{
              position: 'absolute',
              left: z.x * MM, top: z.y * MM,
              width: z.w * MM, height: z.h * MM,
              background: z.bg,
              border: `1px solid ${z.border}50`,
              borderRadius: 2,
            }} />
          ))}
          {/* Card dots in minimap */}
          {tasks.map(task => {
            const pos = positions[task.id];
            if (!pos) return null;
            const zone = ZONES.find(z => z.id === task.status);
            return (
              <div key={task.id} style={{
                position: 'absolute',
                left: pos.x * MM, top: pos.y * MM,
                width: CARD_W * MM, height: CARD_H * MM,
                background: zone?.border ?? '#8b949e',
                opacity: 0.72,
                borderRadius: 1,
              }} />
            );
          })}
          {/* Viewport indicator */}
          {containerRef.current && (
            <div style={{
              position: 'absolute',
              left: Math.max(0, -xform.x / xform.scale * MM),
              top: Math.max(0, -xform.y / xform.scale * MM),
              width: Math.min(mmW, containerRef.current.clientWidth / xform.scale * MM),
              height: Math.min(mmH, containerRef.current.clientHeight / xform.scale * MM),
              border: '1.5px solid #58a6ff',
              borderRadius: 2,
              pointerEvents: 'none',
            }} />
          )}
        </div>
        <div className="text-center mt-1" style={{ fontSize: 9, color: 'var(--mc-text-secondary)' }}>
          {Math.round(xform.scale * 100)}%
        </div>
      </div>

      {/* ── Hint ───────────────────────────────────────────────────────── */}
      <div
        className="absolute bottom-4 left-4 z-20 text-mc-text-secondary pointer-events-none"
        style={{ fontSize: 10 }}
      >
        Drag cards between zones · Scroll to zoom · Drag background to pan
      </div>
    </div>
  );
}

// ── CanvasCard ───────────────────────────────────────────────────────────────

interface CanvasCardProps {
  task: Task;
  x: number;
  y: number;
  accentColor: string;
  isDragging: boolean;
  onMouseDown: (e: React.MouseEvent, id: string) => void;
}

function CanvasCard({ task, x, y, accentColor, isDragging, onMouseDown }: CanvasCardProps) {
  const priorityColor = PRIORITY_COLORS[task.priority] ?? '#8b949e';

  return (
    <div
      onMouseDown={e => onMouseDown(e, task.id)}
      style={{
        position: 'absolute',
        left: x, top: y,
        width: CARD_W,
        zIndex: isDragging ? 200 : 2,
        transform: isDragging ? 'scale(1.05) rotate(1.2deg)' : 'scale(1)',
        boxShadow: isDragging
          ? '0 16px 40px rgba(0,0,0,0.55)'
          : '0 2px 8px rgba(0,0,0,0.28)',
        borderRadius: 8,
        overflow: 'hidden',
        userSelect: 'none',
        cursor: isDragging ? 'grabbing' : 'grab',
        transition: isDragging ? 'box-shadow 0.1s' : 'box-shadow 0.15s, transform 0.12s',
        background: 'var(--mc-bg-secondary)',
        border: '1px solid var(--mc-border)',
      }}
    >
      {/* Top accent stripe */}
      <div style={{ height: 3, background: accentColor }} />
      <div style={{ padding: '9px 12px 10px' }}>
        {/* Title */}
        <div
          style={{
            fontSize: 12,
            fontWeight: 600,
            lineHeight: 1.4,
            color: 'var(--mc-text)',
            marginBottom: 7,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {task.title}
        </div>

        {/* Badges */}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 }}>
          <span style={{
            fontSize: 9.5, padding: '2px 6px', borderRadius: 4,
            background: `${accentColor}20`, color: accentColor,
            border: `1px solid ${accentColor}40`, fontWeight: 600,
            textTransform: 'capitalize',
          }}>
            {task.status.replace('_', ' ')}
          </span>
          <span style={{
            fontSize: 9.5, padding: '2px 6px', borderRadius: 4,
            background: `${priorityColor}18`, color: priorityColor,
          }}>
            {task.priority}
          </span>
        </div>

        {/* Assigned agent */}
        {task.assigned_agent && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>
              {(task.assigned_agent as { avatar_emoji?: string }).avatar_emoji ?? '🤖'}
            </span>
            <span style={{
              fontSize: 10, color: 'var(--mc-text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {task.assigned_agent.name}
            </span>
          </div>
        )}

        {/* Last updated */}
        <div style={{ fontSize: 9, color: 'rgba(139,148,158,0.5)', marginTop: 3 }}>
          {formatDistanceToNow(new Date(task.updated_at ?? task.created_at), { addSuffix: true })}
        </div>
      </div>
    </div>
  );
}
