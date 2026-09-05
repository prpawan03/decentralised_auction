import { lazy } from "react";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { RootLayout } from "./RootLayout";
import { NotFoundPage, RouteErrorBoundary } from "./ErrorBoundary";

/**
 * Real URLs, lazily loaded.
 *
 *   /                    the auction board
 *   /auctions/:id        one auction — linkable, bookmarkable, refresh-safe
 *   /create              list an item
 *   /portfolio           the connected account
 *   /u/:address          ANY account, no wallet required
 *
 * The old app had a single URL and switched screens with booleans, so nothing
 * could be linked, the back button did nothing, and a refresh always dumped
 * you back at the top.
 *
 * Every route carries the same errorElement, so a lazy chunk that fails to
 * load shows a real page instead of a blank screen.
 */

const AuctionsPage = lazy(() => import("@/features/auctions/AuctionsPage"));
const AuctionDetailPage = lazy(() => import("@/features/auctions/AuctionDetailPage"));
const CreateListingPage = lazy(() => import("@/features/listing/CreateListingPage"));
const PortfolioPage = lazy(() => import("@/features/portfolio/PortfolioPage"));

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { index: true, element: <AuctionsPage />, errorElement: <RouteErrorBoundary /> },
      { path: "auctions/:id", element: <AuctionDetailPage />, errorElement: <RouteErrorBoundary /> },
      { path: "create", element: <CreateListingPage />, errorElement: <RouteErrorBoundary /> },
      { path: "portfolio", element: <PortfolioPage />, errorElement: <RouteErrorBoundary /> },
      { path: "u/:address", element: <PortfolioPage />, errorElement: <RouteErrorBoundary /> },
      /* Old bookmark shape, kept working rather than 404ing. */
      { path: "auctions", element: <Navigate to="/" replace /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
