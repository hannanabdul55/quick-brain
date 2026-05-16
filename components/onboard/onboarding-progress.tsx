"use client";

import { Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StageItem {
  id: string;
  label: string;
}

export interface OnboardingProgressProps {
  stage: string;
  label: string;
  progress: number;
  allStages: StageItem[];
}

export function OnboardingProgress({
  stage,
  label,
  progress,
  allStages,
}: OnboardingProgressProps) {
  const currentIndex = allStages.findIndex((s) => s.id === stage);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Progress bar */}
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-neutral-200"
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-neutral-900 transition-all duration-500"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* Stage checklist */}
        <ul className="space-y-2">
          {allStages.map((s, index) => {
            const isDone = index < currentIndex;
            const isCurrent = index === currentIndex;
            const isPending = index > currentIndex;

            return (
              <li
                key={s.id}
                className={cn(
                  "flex items-center gap-2 text-sm",
                  isDone && "text-foreground",
                  isCurrent && "font-medium text-foreground",
                  isPending && "text-muted-foreground"
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  {isDone && (
                    <span className="text-green-600 font-bold">&#10003;</span>
                  )}
                  {isCurrent && (
                    <Loader2 className="h-4 w-4 animate-spin text-neutral-900" />
                  )}
                  {isPending && (
                    <span className="h-2 w-2 rounded-full bg-neutral-300 block" />
                  )}
                </span>
                {s.label}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
