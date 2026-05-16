"use client";

import { Button } from "@/components/ui/button";

export interface ErrorBannerProps {
  message: string;
  onRetry: () => void;
}

export function ErrorBanner({ message, onRetry }: ErrorBannerProps) {
  return (
    <div className="bg-red-50 border border-red-200 text-red-900 p-4 rounded-md space-y-3">
      <p className="text-sm font-medium">{message}</p>
      <Button variant="outline" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
