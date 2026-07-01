import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useLocalRepo } from "./LocalRepoContext";

export interface Operation {
  kind: "clone";
  title: string;
  phase: string;
  percent: number; // 0–100; -1 means indeterminate
  status: "running" | "done" | "error";
  message: string;
  error?: string;
}

interface OperationContextValue {
  op: Operation | null;
  cloneRepo: (repoName: string, parentDir: string) => Promise<void>;
  dismiss: () => void;
}

const Ctx = createContext<OperationContextValue | null>(null);

export function OperationProvider({ children }: { children: ReactNode }) {
  const { openRepo } = useLocalRepo();
  const navigate = useNavigate();
  const [op, setOp] = useState<Operation | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }

  async function cloneRepo(repoName: string, parentDir: string) {
    setOp({ kind: "clone", title: `Cloning ${repoName}`, phase: "Starting", percent: 0, status: "running", message: "" });
    let jobId: string;
    let dest: string;
    try {
      const res = await api.clone.start(repoName, parentDir);
      jobId = res.jobId;
      dest = res.dest;
    } catch (err) {
      setOp({
        kind: "clone",
        title: `Cloning ${repoName}`,
        phase: "Failed",
        percent: 0,
        status: "error",
        message: "",
        error: err instanceof Error ? err.message : "Could not start the clone.",
      });
      return;
    }

    stopPolling();
    timer.current = setInterval(async () => {
      try {
        const job = await api.clone.status(jobId);
        setOp({
          kind: "clone",
          title: `Cloning ${repoName}`,
          phase: job.phase,
          percent: job.percent,
          status: job.status === "cloning" ? "running" : job.status,
          message: job.message,
          error: job.error,
        });
        if (job.status === "done") {
          stopPolling();
          await openRepo(dest);
          navigate("/local", { replace: true });
          // Leave a brief success state, then clear.
          setTimeout(() => setOp(null), 2500);
        } else if (job.status === "error") {
          stopPolling();
        }
      } catch {
        stopPolling();
        setOp((prev) =>
          prev ? { ...prev, status: "error", error: "Lost contact with the clone job." } : prev
        );
      }
    }, 450);
  }

  function dismiss() {
    stopPolling();
    setOp(null);
  }

  const value = useMemo<OperationContextValue>(() => ({ op, cloneRepo, dismiss }), [op]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOperation(): OperationContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useOperation must be used within OperationProvider");
  return ctx;
}
