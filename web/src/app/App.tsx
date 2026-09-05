import { RouterProvider } from "react-router-dom";
import { Providers } from "./Providers";
import { AppErrorBoundary } from "./ErrorBoundary";
import { router } from "./routes";

/**
 * The boundary is OUTSIDE the providers on purpose: if wagmi or the query
 * client fails to construct, there still has to be something left to render
 * the failure.
 */
export function App() {
  return (
    <AppErrorBoundary>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </AppErrorBoundary>
  );
}
