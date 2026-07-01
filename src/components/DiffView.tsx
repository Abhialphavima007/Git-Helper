import { useQuery } from "@tanstack/react-query";
import { useLocalRepo } from "../context/LocalRepoContext";
import { api } from "../api/client";
import { ErrorNote, Spinner } from "./ui";

// Renders a unified diff for one file with line coloring. Fetches lazily so
// the diff is only requested when a row is expanded.
export function DiffView({ file, staged }: { file: string; staged: boolean }) {
  const { root } = useLocalRepo();
  const query = useQuery({
    queryKey: ["local-diff", root, file, staged],
    queryFn: () => api.local.getDiff(file, staged),
  });

  if (query.isLoading) return <div className="p-3"><Spinner /></div>;
  if (query.isError) return <div className="p-3"><ErrorNote error={query.error} /></div>;

  return <DiffLines diff={query.data?.diff ?? ""} />;
}

// Presentational unified-diff renderer with red/green line coloring.
export function DiffLines({ diff }: { diff: string }) {
  if (!diff.trim()) {
    return <p className="p-3 text-xs text-muted">No textual diff — this may be a binary or empty change.</p>;
  }
  const lines = diff.split("\n");
  return (
    <pre className="max-h-96 overflow-auto rounded-lg bg-ink/[0.03] p-3 font-mono text-xs leading-relaxed">
      {lines.map((line, i) => {
        let cls = "text-ink";
        if (line.startsWith("@@")) cls = "text-accent";
        else if (line.startsWith("+") && !line.startsWith("+++")) cls = "bg-ok-bg text-ok";
        else if (line.startsWith("-") && !line.startsWith("---")) cls = "bg-danger-bg text-danger";
        else if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("+++") || line.startsWith("---"))
          cls = "text-muted";
        return (
          <div key={i} className={`px-1 ${cls}`}>
            {line || " "}
          </div>
        );
      })}
    </pre>
  );
}
