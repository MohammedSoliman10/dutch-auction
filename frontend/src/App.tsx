import "@rainbow-me/rainbowkit/styles.css";

import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { WagmiProvider } from "wagmi";

import { Footer } from "./components/layout/Footer";
import { Header } from "./components/layout/Header";
import { wagmiConfig } from "./config/wagmi";

// Route-level code splitting (FR-017 / SC-010).
const GalleryPage = lazy(() => import("./pages/GalleryPage"));
const AuctionPage = lazy(() => import("./pages/AuctionPage"));
const MintPage = lazy(() => import("./pages/MintPage"));
const CreateAuctionPage = lazy(() => import("./pages/CreateAuctionPage"));
const MyAuctionsPage = lazy(() => import("./pages/MyAuctionsPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

const queryClient = new QueryClient();

export default function App() {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={darkTheme({
            accentColor: "#ff5a1f",
            accentColorForeground: "black",
            borderRadius: "large",
          })}
        >
          <BrowserRouter>
            <div className="flex min-h-screen flex-col bg-ink text-display">
              <Header />
              <div className="flex-1">
                <Suspense
                  fallback={
                    <div
                      role="status"
                      aria-live="polite"
                      className="flex min-h-[50vh] items-center justify-center px-6 text-muted"
                    >
                      Loading...
                    </div>
                  }
                >
                  <Routes>
                    <Route path="/" element={<GalleryPage />} />
                    <Route path="/auction/:address" element={<AuctionPage />} />
                    <Route path="/mint" element={<MintPage />} />
                    <Route path="/create" element={<CreateAuctionPage />} />
                    <Route path="/my" element={<MyAuctionsPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </Suspense>
              </div>
              <Footer />
            </div>
          </BrowserRouter>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
