"use client";

// Lightweight unified-diff renderer (no heavy syntax-highlighter dep).
export function DiffView({ diff }: { diff: string }) {
  const lines = diff.replace(/\n$/, "").split("\n");
  return (
    <pre className="font-mono text-[12px] leading-relaxed overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/80">
      <code className="block">
        {lines.map((line, i) => {
          let cls = "text-zinc-400";
          let bg = "";
          if (line.startsWith("+++") || line.startsWith("---")) {
            cls = "text-zinc-500";
          } else if (line.startsWith("@@")) {
            cls = "text-cyan-400";
          } else if (line.startsWith("+")) {
            cls = "text-emerald-300";
            bg = "bg-emerald-500/10";
          } else if (line.startsWith("-")) {
            cls = "text-red-300";
            bg = "bg-red-500/10";
          }
          return (
            <span key={i} className={`block px-3 py-[1px] ${bg} ${cls}`}>
              {line || " "}
            </span>
          );
        })}
      </code>
    </pre>
  );
}
