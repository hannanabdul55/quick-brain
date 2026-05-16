import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="max-w-xl w-full text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight text-foreground">
          QuickBrain
        </h1>
        <p className="text-lg text-muted-foreground">
          Your business brain in 60 seconds. Answer two questions and get a
          live, queryable knowledge base for your business — no terminal, no
          setup, no technical skills required.
        </p>
        <Link
          href="/onboard"
          className={cn(buttonVariants({ variant: "default", size: "lg" }), "text-base px-8 py-4 h-auto")}
        >
          Start your business brain
        </Link>
      </div>
    </main>
  );
}
