export function exportCsv(name: string, head: string[], rows: unknown[][]) {
  const csv = [head, ...rows].map((r) => r.map((c) => '"' + String(c ?? "").replace(/"/g, '""') + '"').join(",")).join("\n");
  const a = document.createElement("a"); a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv); a.download = "vivaha_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_") + ".csv"; document.body.appendChild(a); a.click(); a.remove();
}
