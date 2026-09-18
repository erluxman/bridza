// kanban-order.js — pure helpers for dragging Kanban column headers. Kept out of
// board.jsx so they can be tested without loading the terminal drawer.
//
// The pipeline's stored column order (dragged headers) over the derived one:
// known stored ids first, in stored order, then any new columns in derived
// order. Stale stored ids are dropped.
export function applyKanbanOrder(derived, stored) {
  const kept = (stored || []).filter((id, i, a) => derived.includes(id) && a.indexOf(id) === i);
  return [...kept, ...derived.filter((id) => !kept.includes(id))];
}
export function moveColumn(order, fromId, toIndex) {
  const next = order.filter((id) => id !== fromId);
  next.splice(toIndex, 0, fromId);
  return next;
}
