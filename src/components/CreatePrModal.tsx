import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import { ErrorNote, Mono } from "./ui";

// Create a pull request — the Azure DevOps way to merge one branch into another.
export function CreatePrModal({
  repoId,
  source,
  defaultTarget,
  targets,
  onClose,
  onCreated,
}: {
  repoId: string;
  source: string;
  defaultTarget: string;
  targets: string[];
  onClose: () => void;
  onCreated: (prId: number) => void;
}) {
  const [target, setTarget] = useState(defaultTarget);
  const [title, setTitle] = useState(`Merge ${source} into ${defaultTarget}`);
  const [description, setDescription] = useState("");

  const createM = useMutation({
    mutationFn: () => api.createPullRequest(repoId, { source, target, title: title.trim(), description }),
    onSuccess: (pr) => onCreated(pr.id),
  });

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border border-line bg-card p-6 shadow-card" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-display text-lg font-semibold text-ink">New pull request</h2>
        <p className="mt-1 text-sm text-muted">
          Merge <Mono>{source}</Mono> into a target branch on Azure DevOps.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Merge into</label>
            <select
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                setTitle(`Merge ${source} into ${e.target.value}`);
              }}
              className="w-full rounded-lg border border-line bg-card px-2.5 py-2 font-mono text-sm text-ink focus-visible:border-accent"
            >
              {targets.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Title</label>
            <input
              className="w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus-visible:border-accent"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink">Description (optional)</label>
            <textarea
              className="h-20 w-full resize-y rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink focus-visible:border-accent"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {createM.isError && (
          <div className="mt-3">
            <ErrorNote error={createM.error} hint="Creating a PR needs a PAT with Code: Read & write." />
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-ink hover:bg-paper">
            Cancel
          </button>
          <button
            onClick={() => createM.mutate()}
            disabled={createM.isPending || !title.trim() || source === target}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {createM.isPending ? "Creating…" : "Create pull request"}
          </button>
        </div>
      </div>
    </div>
  );
}
