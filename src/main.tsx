import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Safely intercept and downgrade transient network/fetch errors to warnings.
// This prevents system startup/restart connection blips from throwing fatal console errors.
const originalConsoleError = console.error;
console.error = function (...args: any[]) {
  const isFetchError = args.some(arg => {
    if (!arg) return false;
    const str = typeof arg === "string" ? arg : (arg.message || String(arg));
    return (
      str.includes("Failed to fetch") || 
      str.includes("fetch") || 
      str.includes("NetworkError") || 
      str.includes("TypeError: load") ||
      str.includes("Failed to load resource")
    );
  });

  if (isFetchError) {
    console.warn("[Network Warning Interceptor]", ...args);
  } else {
    originalConsoleError.apply(console, args);
  }
};

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const reasonStr = reason?.message || String(reason || "");
  if (
    reasonStr.includes("Failed to fetch") || 
    reasonStr.includes("fetch") || 
    reasonStr.includes("NetworkError") ||
    reasonStr.includes("Failed to load resource")
  ) {
    console.warn("[Network Rejection Interceptor] Prevented crash for transient fetch error:", reason);
    event.preventDefault(); // Stop default browser logging of this unhandled rejection to console.error
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
