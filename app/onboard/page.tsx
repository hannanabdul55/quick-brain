"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { OnboardingProgress, type StageItem } from "@/components/onboard/onboarding-progress";
import { ErrorBanner } from "@/components/onboard/error-banner";
import { createTenantBodySchema } from "@/lib/onboarding/schemas";

// Locked stage list — matches server-emitted stage IDs and labels from 02-CONTEXT.md
const ALL_STAGES: StageItem[] = [
  { id: "creating-brain", label: "Creating your brain" },
  { id: "reading-invoices", label: "Reading your invoices and emails" },
  { id: "building-graph", label: "Building the knowledge graph" },
  { id: "indexing", label: "Indexing for search" },
  { id: "ready", label: "Ready" },
];

type PageState = "form" | "submitting" | "streaming" | "error";

interface ProgressState {
  stage: string;
  label: string;
  progress: number;
}

export default function OnboardPage() {
  const router = useRouter();
  const [pageState, setPageState] = useState<PageState>("form");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [progressState, setProgressState] = useState<ProgressState>({
    stage: ALL_STAGES[0]!.id,
    label: ALL_STAGES[0]!.label,
    progress: 0,
  });
  const eventSourceRef = useRef<EventSource | null>(null);

  // Cleanup EventSource on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  function openEventSource(tenantId: string) {
    const es = new EventSource(`/api/tenants/${tenantId}/onboard`);
    eventSourceRef.current = es;

    es.addEventListener("stage", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as {
          stage: string;
          label: string;
          progress: number;
        };
        setProgressState({
          stage: data.stage,
          label: data.label,
          progress: data.progress,
        });
      } catch {
        // Ignore malformed stage events
      }
    });

    es.addEventListener("done", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { tenantId: string };
        es.close();
        eventSourceRef.current = null;
        router.push(`/dash/${data.tenantId}`);
      } catch {
        es.close();
        eventSourceRef.current = null;
        setErrorMsg("Stream closed unexpectedly");
        setPageState("error");
      }
    });

    es.addEventListener("error", (e: MessageEvent) => {
      es.close();
      eventSourceRef.current = null;
      try {
        const data = JSON.parse(e.data) as { message: string };
        setErrorMsg(data.message || "Stream closed unexpectedly");
      } catch {
        setErrorMsg("Stream closed unexpectedly");
      }
      setPageState("error");
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const body = {
      businessName: formData.get("businessName") as string,
      businessType: formData.get("businessType") as string,
      ownerName: formData.get("ownerName") as string,
    };

    // Client-side zod validation
    const result = createTenantBodySchema.safeParse(body);
    if (!result.success) {
      setErrorMsg("Please fill in all three fields");
      setPageState("error");
      return;
    }

    setPageState("submitting");

    try {
      const response = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      });

      if (response.status === 201) {
        const json = (await response.json()) as { tenantId: string; slug: string };
        setProgressState({
          stage: ALL_STAGES[0]!.id,
          label: ALL_STAGES[0]!.label,
          progress: 0,
        });
        setPageState("streaming");
        openEventSource(json.tenantId);
      } else {
        let errText = "Failed to create tenant — please try again";
        try {
          const json = (await response.json()) as { error?: string };
          if (json.error) errText = json.error;
        } catch {
          // Use default message
        }
        setErrorMsg(errText);
        setPageState("error");
      }
    } catch {
      setErrorMsg("Network error — please check your connection and try again");
      setPageState("error");
    }
  }

  function handleRetry() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setErrorMsg("");
    setPageState("form");
  }

  const isSubmitting = pageState === "submitting";

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md mx-auto space-y-4">
        {/* Form state and submitting state */}
        {(pageState === "form" || pageState === "submitting") && (
          <Card>
            <CardHeader>
              <CardTitle>Set up your business brain</CardTitle>
              <CardDescription>
                Tell us a little about your business and we&apos;ll have your
                brain ready in under 60 seconds.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label
                    htmlFor="business-name"
                    className="text-sm font-medium text-foreground"
                  >
                    Business name
                  </label>
                  <Input
                    id="business-name"
                    name="businessName"
                    type="text"
                    placeholder="e.g. Mara's Coffee"
                    required
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="business-type"
                    className="text-sm font-medium text-foreground"
                  >
                    Business type
                  </label>
                  <Input
                    id="business-type"
                    name="businessType"
                    type="text"
                    placeholder="e.g. Coffee shop, retail, consulting"
                    required
                    disabled={isSubmitting}
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="owner-name"
                    className="text-sm font-medium text-foreground"
                  >
                    Owner name
                  </label>
                  <Input
                    id="owner-name"
                    name="ownerName"
                    type="text"
                    placeholder="e.g. Mara Okafor"
                    required
                    disabled={isSubmitting}
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full mt-2"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? "Creating tenant…" : "Create my brain"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Streaming state */}
        {pageState === "streaming" && (
          <OnboardingProgress
            stage={progressState.stage}
            label={progressState.label}
            progress={progressState.progress}
            allStages={ALL_STAGES}
          />
        )}

        {/* Error state */}
        {pageState === "error" && (
          <ErrorBanner message={errorMsg} onRetry={handleRetry} />
        )}
      </div>
    </main>
  );
}
