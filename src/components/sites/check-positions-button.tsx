"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function CheckPositionsButton({ siteId }: { siteId?: string }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleCheck() {
    setLoading(true);
    try {
      const res = await fetch("/api/positions/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          siteIds: siteId ? [siteId] : undefined,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to check positions");
        return;
      }

      toast.success(
        `Checked ${data.checked} keywords (${data.apiCalls} API calls). ${data.deindexed > 0 ? `${data.deindexed} deindexed detected!` : ""}`
      );
      router.refresh();
    } catch (err) {
      toast.error("Network error");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button onClick={handleCheck} disabled={loading} variant="outline">
      <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
      {loading ? "Checking..." : "Check Positions"}
    </Button>
  );
}
