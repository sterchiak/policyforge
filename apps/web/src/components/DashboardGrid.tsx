// apps/web/src/components/DashboardGrid.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type CardDef = {
  id: string;               // stable id (used for persistence)
  label: string;            // human label (used in Customize list)
  render: () => React.ReactNode;
  defaultHidden?: boolean;  // optional default hidden
};

export type DashboardGridProps = {
  cards: CardDef[];
  columns?: number; // default 3 on md+
};

function storageKey(email: string | undefined | null) {
  const who = (email || "anon").toLowerCase();
  return `PF_DASH_LAYOUT:${who}`;
}

type LayoutState = {
  order: string[];
  hidden: string[];
};

function useLayoutState(email: string | undefined | null, initial: CardDef[]) {
  const key = storageKey(email);
  const [state, setState] = useState<LayoutState>(() => {
    if (typeof window === "undefined") {
      return {
        order: initial.map((c) => c.id),
        hidden: initial.filter((c) => c.defaultHidden).map((c) => c.id),
      };
    }
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        return {
          order: initial.map((c) => c.id),
          hidden: initial.filter((c) => c.defaultHidden).map((c) => c.id),
        };
      }
      const parsed = JSON.parse(raw) as LayoutState;
      const known = new Set(initial.map((c) => c.id));
      const order = parsed.order.filter((id) => known.has(id));
      for (const c of initial) if (!order.includes(c.id)) order.push(c.id);
      const hidden = parsed.hidden.filter((id) => known.has(id));
      return { order, hidden };
    } catch {
      return {
        order: initial.map((c) => c.id),
        hidden: initial.filter((c) => c.defaultHidden).map((c) => c.id),
      };
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);

  const reset = () =>
    setState({
      order: initial.map((c) => c.id),
      hidden: initial.filter((c) => c.defaultHidden).map((c) => c.id),
    });

  return { state, setState, reset };
}

function SortableCard({
  id,
  children,
  enabled,
}: {
  id: string;
  enabled: boolean;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !enabled });

  // While dragging, keep the element in the layout but invisible.
  // This preserves its original height so the grid doesn't stretch.
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1, // <- key bit
    cursor: enabled ? "grab" : "default",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...(enabled ? listeners : {})}>
      {children}
    </div>
  );
}

export default function DashboardGrid({ cards, columns = 3 }: DashboardGridProps) {
  const { data: session } = useSession();
  const email = (session?.user as any)?.email as string | undefined;

  const { state, setState, reset } = useLayoutState(email, cards);

  const orderedCards = useMemo(
    () => state.order.map((id) => cards.find((c) => c.id === id)!).filter(Boolean),
    [state.order, cards]
  );
  const visible = orderedCards.filter((c) => !state.hidden.includes(c.id));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [reorderOn, setReorderOn] = useState(false);
  const [showManage, setShowManage] = useState(false);

  // Overlay state
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeSize, setActiveSize] = useState<{ width: number; height: number } | null>(null);

  const activeCard = useMemo(
    () => (activeId ? cards.find((c) => c.id === activeId) : undefined),
    [activeId, cards]
  );

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setActiveId(id);
    // Lock overlay size to the initial rect of the dragged card
    const rect = e.active.rect.current?.initial;
    if (rect) {
      setActiveSize({ width: rect.width, height: rect.height });
    } else {
      setActiveSize(null);
    }
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const oldIndex = state.order.indexOf(String(active.id));
      const newIndex = state.order.indexOf(String(over.id));
      setState((s) => ({ ...s, order: arrayMove(s.order, oldIndex, newIndex) }));
    }
    setActiveId(null);
    setActiveSize(null);
  };

  const onDragCancel = () => {
    setActiveId(null);
    setActiveSize(null);
  };

  const toggleHidden = (id: string) =>
    setState((s) => {
      const hidden = new Set(s.hidden);
      if (hidden.has(id)) hidden.delete(id);
      else hidden.add(id);
      return { ...s, hidden: Array.from(hidden) };
    });

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            className={`rounded border px-3 py-1.5 text-sm ${reorderOn ? "bg-gray-900 text-white" : ""}`}
            onClick={() => setReorderOn((v) => !v)}
            title="Reorder cards"
          >
            {reorderOn ? "Done Reordering" : "Reorder Cards"}
          </button>
          <button className="rounded border px-3 py-1.5 text-sm" onClick={reset} title="Reset layout">
            Reset Layout
          </button>
        </div>
        <button
          className="rounded border px-3 py-1.5 text-sm"
          onClick={() => setShowManage((v) => !v)}
          title="Show/hide cards"
        >
          {showManage ? "Close" : "Customize"}
        </button>
      </div>

      {showManage && (
        <div className="rounded border bg-white p-3">
          <div className="mb-2 text-sm font-medium text-gray-900">Visible Cards</div>
          <ul className="grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
            {cards.map((c) => {
              const checked = !state.hidden.includes(c.id);
              return (
                <li key={c.id} className="flex items-center gap-2">
                  <input
                    id={`vis-${c.id}`}
                    type="checkbox"
                    className="h-4 w-4"
                    checked={checked}
                    onChange={() => toggleHidden(c.id)}
                  />
                  <label htmlFor={`vis-${c.id}`}>{c.label}</label>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Grid with overlay clone while dragging */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <SortableContext items={visible.map((c) => c.id)} strategy={rectSortingStrategy}>
          <div
            className={`grid gap-6 ${
              columns === 1 ? "grid-cols-1" : columns === 2 ? "md:grid-cols-2" : "md:grid-cols-3"
            }`}
          >
            {visible.map((c) => (
              <SortableCard key={c.id} id={c.id} enabled={reorderOn}>
                {c.render()}
              </SortableCard>
            ))}
          </div>
        </SortableContext>

        {/* The ghost that follows the pointer; fixed size prevents stretching */}
        <DragOverlay adjustScale={false}>
          {reorderOn && activeCard ? (
            <div
              className="rounded border bg-white shadow-xl"
              style={{
                width: activeSize?.width,
                height: activeSize?.height,
              }}
            >
              {activeCard.render()}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
