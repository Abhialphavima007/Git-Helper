import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useConnection } from "./context/ConnectionContext";
import { useLocalRepo } from "./context/LocalRepoContext";
import { Layout } from "./components/Layout";
import { ConnectPage } from "./pages/ConnectPage";
import { DashboardPage } from "./pages/DashboardPage";
import { BranchesPage } from "./pages/BranchesPage";
import { PullRequestsPage } from "./pages/PullRequestsPage";
import { PullRequestDetailPage } from "./pages/PullRequestDetailPage";
import { ReposPage } from "./pages/ReposPage";
import { OpenRepoPage } from "./pages/OpenRepoPage";
import { LocalStatusPage } from "./pages/LocalStatusPage";
import { LocalChangesPage } from "./pages/LocalChangesPage";
import { LocalCommitPage } from "./pages/LocalCommitPage";
import { LocalBranchesPage } from "./pages/LocalBranchesPage";
import { LocalComparePage } from "./pages/LocalComparePage";
import { LocalGraphPage } from "./pages/LocalGraphPage";
import { LocalConflictsPage } from "./pages/LocalConflictsPage";
import { Spinner } from "./components/ui";

// Gate the Azure DevOps screens: needs an active connection.
function RequireAzure({ children }: { children: ReactNode }) {
  const { connected } = useConnection();
  if (!connected) return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

// Gate the local-git screens: needs local mode enabled + an open repository.
function RequireLocal({ children }: { children: ReactNode }) {
  const { open, localEnabled } = useLocalRepo();
  if (!localEnabled) return <Navigate to="/" replace />;
  if (!open) return <Navigate to="/local/open" replace />;
  return <Layout>{children}</Layout>;
}

export default function App() {
  const conn = useConnection();
  const local = useLocalRepo();

  if (!conn.ready || !local.ready) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner label="Checking your connection…" />
      </div>
    );
  }

  const anyMode = conn.connected || local.open;

  return (
    <Routes>
      {/* Landing: Azure dashboard if connected, else local if open, else connect. */}
      <Route
        path="/"
        element={
          conn.connected ? (
            <Layout>
              <DashboardPage />
            </Layout>
          ) : local.open ? (
            <Navigate to="/local" replace />
          ) : (
            <ConnectPage />
          )
        }
      />
      <Route path="/connect" element={<ConnectPage />} />

      {/* Azure DevOps (remote) */}
      <Route path="/repos" element={<RequireAzure><ReposPage /></RequireAzure>} />
      <Route path="/branches" element={<RequireAzure><BranchesPage /></RequireAzure>} />
      <Route path="/pulls" element={<RequireAzure><PullRequestsPage /></RequireAzure>} />
      <Route path="/pulls/:prId" element={<RequireAzure><PullRequestDetailPage /></RequireAzure>} />

      {/* Local git */}
      <Route
        path="/local/open"
        element={
          !local.localEnabled ? (
            <Navigate to="/" replace />
          ) : anyMode ? (
            <Layout>
              <OpenRepoPage />
            </Layout>
          ) : (
            <OpenRepoPage />
          )
        }
      />
      <Route path="/local" element={<RequireLocal><LocalStatusPage /></RequireLocal>} />
      <Route path="/local/changes" element={<RequireLocal><LocalChangesPage /></RequireLocal>} />
      <Route path="/local/commit" element={<RequireLocal><LocalCommitPage /></RequireLocal>} />
      <Route path="/local/branches" element={<RequireLocal><LocalBranchesPage /></RequireLocal>} />
      <Route path="/local/compare" element={<RequireLocal><LocalComparePage /></RequireLocal>} />
      <Route path="/local/graph" element={<RequireLocal><LocalGraphPage /></RequireLocal>} />
      <Route path="/local/conflicts" element={<RequireLocal><LocalConflictsPage /></RequireLocal>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
