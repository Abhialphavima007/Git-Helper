import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { ConnectionProvider } from "./context/ConnectionContext";
import { LocalRepoProvider } from "./context/LocalRepoContext";
import { OperationProvider } from "./context/OperationContext";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ConnectionProvider>
          <LocalRepoProvider>
            <OperationProvider>
              <App />
            </OperationProvider>
          </LocalRepoProvider>
        </ConnectionProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
