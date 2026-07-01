import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, type ConflictContent, type ConflictFile } from "../api/client";
import { useLocalRepo } from "../context/LocalRepoContext";
import { Card, ErrorNote, Mono, Spinner } from "../components/ui";

export function LocalConflictsPage() {
  const { root } = useLocalRepo();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const conflictsQuery = useQuery({
    queryKey: ["local-conflicts", root],
    queryFn: () => api.local.getConflicts(),
    enabled: !!root,
  });

  // Keep a valid selection as the list changes (e.g. after resolving one).
  useEffect(() => {
    const list = conflictsQuery.data;
    if (!list) return;
    if (selected && list.some((c) => c.path === selected)) return;
    setSelected(list[0]?.path ?? null);
  }, [conflictsQuery.data, selected]);

  const list = conflictsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted">Resolve conflicts</p>
          <h1 className="mt-1 font-display text-2xl font-bold text-ink">Merge conflict resolver</h1>
        </div>
        <Link to="/local" className="text-sm font-medium text-accent hover:text-accent-hover">
          ← Status
        </Link>
      </header>

      {conflictsQuery.isLoading && <Spinner label="Looking for conflicts…" />}
      {conflictsQuery.isError && <ErrorNote error={conflictsQuery.error} />}

      {conflictsQuery.data && list.length === 0 && (
        <Card className="border-ok/30 bg-ok-bg p-8 text-center">
          <p className="text-sm font-semibold text-ok">No conflicts 🎉</p>
          <p className="mt-1 text-sm text-ink">
            Every file is resolved. Finish the merge by committing.{" "}
            <Link to="/local/commit" className="font-medium text-accent hover:text-accent-hover">
              Go to commit →
            </Link>
          </p>
        </Card>
      )}

      {list.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card className="h-fit p-3">
            <p className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted">
              {list.length} conflicted file{list.length === 1 ? "" : "s"}
            </p>
            <ul className="space-y-1">
              {list.map((c) => (
                <li key={c.path}>
                  <button
                    onClick={() => setSelected(c.path)}
                    className={`w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-xs ${
                      selected === c.path ? "bg-accent/10 text-accent" : "text-ink hover:bg-paper"
                    }`}
                    title={c.path}
                  >
                    {c.path}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {selected ? (
            <ConflictEditor
              key={selected}
              file={selected}
              meta={list.find((c) => c.path === selected)}
              onResolved={() => {
                qc.invalidateQueries({ queryKey: ["local-conflicts", root] });
                qc.invalidateQueries({ queryKey: ["local-state", root] });
              }}
            />
          ) : (
            <Card className="p-6 text-sm text-muted">Select a file to resolve.</Card>
          )}
        </div>
      )}
    </div>
  );
}

function ConflictEditor({
  file,
  meta,
  onResolved,
}: {
  file: string;
  meta?: ConflictFile;
  onResolved: () => void;
}) {
  const { root } = useLocalRepo();
  const [result, setResult] = useState<string>("");

  const query = useQuery({
    queryKey: ["local-conflict", root, file],
    queryFn: () => api.local.getConflict(file),
  });

  // Seed the editable result from the working-tree copy (with markers) once.
  useEffect(() => {
    if (query.data) setResult(query.data.merged);
  }, [query.data]);

  const resolveMutation = useMutation({
    mutationFn: (content: string) => api.local.resolve(file, content),
    onSuccess: onResolved,
  });

  if (query.isLoading) return <Card className="p-6"><Spinner label="Loading the three sides…" /></Card>;
  if (query.isError) return <Card className="p-6"><ErrorNote error={query.error} /></Card>;

  const c = query.data as ConflictContent;
  const markerCount = (result.match(/^(<{7}|={7}|>{7})/gm) || []).length;
  const stillHasMarkers = markerCount > 0;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-sm text-ink">{file}</p>
          <p className="text-xs text-muted">
            {meta?.hasOurs === false
              ? "Added or deleted on one side"
              : meta?.hasTheirs === false
              ? "Added or deleted on one side"
              : "Changed on both sides"}
          </p>
        </div>
        <p className="mt-1 text-xs text-muted">
          Pick a starting point, edit the <b>Result</b> until it reads correctly, then mark it resolved. Remove every{" "}
          <Mono>{"<<<<<<<"}</Mono>/<Mono>{"======="}</Mono>/<Mono>{">>>>>>>"}</Mono> marker.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => setResult(c.ours ?? "")}
            disabled={c.ours === null}
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-paper disabled:opacity-40"
          >
            Take “ours” (your side)
          </button>
          <button
            onClick={() => setResult(c.theirs ?? "")}
            disabled={c.theirs === null}
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-paper disabled:opacity-40"
          >
            Take “theirs” (incoming)
          </button>
          <button
            onClick={() => setResult(c.merged)}
            className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-ink hover:bg-paper"
          >
            Reset to markers
          </button>
        </div>
      </Card>

      {/* Two reference panes */}
      <div className="grid gap-3 md:grid-cols-2">
        <SidePane title="Ours — your current branch" body={c.ours} accent="ok" />
        <SidePane title="Theirs — the incoming change" body={c.theirs} accent="accent" />
      </div>

      {/* Editable result */}
      <Card className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-ink">Result — what gets saved</h3>
          <span className={stillHasMarkers ? "text-xs font-medium text-warn" : "text-xs text-ok"}>
            {stillHasMarkers ? `${markerCount} conflict marker${markerCount === 1 ? "" : "s"} left` : "No markers — looks clean"}
          </span>
        </div>
        <textarea
          className="h-72 w-full resize-y rounded-lg border border-line bg-card px-3 py-2 font-mono text-xs leading-relaxed text-ink focus-visible:border-accent"
          value={result}
          onChange={(e) => setResult(e.target.value)}
          spellCheck={false}
        />
        {resolveMutation.isError && (
          <div className="mt-2">
            <ErrorNote error={resolveMutation.error} />
          </div>
        )}
        <div className="mt-3 flex items-center gap-3">
          <button
            onClick={() => resolveMutation.mutate(result)}
            disabled={resolveMutation.isPending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {resolveMutation.isPending ? "Saving…" : "Mark resolved"}
          </button>
          {stillHasMarkers && (
            <span className="text-xs text-muted">
              Tip: markers are still present. You can still save, but make sure that's intentional.
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}

function SidePane({ title, body, accent }: { title: string; body: string | null; accent: "ok" | "accent" }) {
  return (
    <Card className="p-0">
      <div className={`border-b border-line px-3 py-2 text-xs font-semibold ${accent === "ok" ? "text-ok" : "text-accent"}`}>
        {title}
      </div>
      {body === null ? (
        <p className="p-3 text-xs text-muted">Not present on this side (added or deleted).</p>
      ) : (
        <pre className="max-h-72 overflow-auto p-3 font-mono text-xs leading-relaxed text-ink">{body || " "}</pre>
      )}
    </Card>
  );
}
