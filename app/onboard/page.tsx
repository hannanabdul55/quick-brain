"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function OnboardPage() {
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    console.log({
      businessName: data.get("businessName"),
      businessType: data.get("businessType"),
      ownerName: data.get("ownerName"),
    });
    // Real submit logic arrives in Plan 04
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Set up your business brain</CardTitle>
            <CardDescription>
              Tell us a little about your business and we will have your brain
              ready in under 60 seconds.
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
                />
              </div>

              <Button type="submit" className="w-full mt-2">
                Create my brain
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
