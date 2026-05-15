// src/admin/Pagination.jsx
// Shared pagination controls — matches existing admin design tokens.
export default function Pagination({ page, totalPages, onPage }) {
  if (totalPages <= 1) return null;

  const pages = [];
  // Show at most 7 page buttons: always first, last, current ±1, and ellipsis gaps.
  const range = new Set([1, totalPages, page, page - 1, page + 1].filter(p => p >= 1 && p <= totalPages));
  const sorted = [...range].sort((a, b) => a - b);
  let prev = null;
  for (const p of sorted) {
    if (prev !== null && p - prev > 1) pages.push("…");
    pages.push(p);
    prev = p;
  }

  return (
    <div className="ad-pagination">
      <button
        className="ad-pg-btn"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label="Previous page"
      >
        ‹ Prev
      </button>

      <div className="ad-pg-numbers">
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`ellipsis-${i}`} className="ad-pg-ellipsis">…</span>
          ) : (
            <button
              key={p}
              className={`ad-pg-num ${p === page ? "active" : ""}`}
              onClick={() => onPage(p)}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </button>
          )
        )}
      </div>

      <button
        className="ad-pg-btn"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        aria-label="Next page"
      >
        Next ›
      </button>
    </div>
  );
}
