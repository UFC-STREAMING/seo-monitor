"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Niche, SiteType } from "@/types/database";

function getFlagEmoji(countryIso: string): string {
  const codePoints = countryIso
    .toUpperCase()
    .split("")
    .map((char) => 0x1f1e6 + char.charCodeAt(0) - 65);
  return String.fromCodePoint(...codePoints);
}

interface LocationOption {
  code: number;
  name: string;
  country_iso: string;
}

export function AddSiteDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [domain, setDomain] = useState("");
  const [niche, setNiche] = useState<Niche | "">("");
  const [siteType, setSiteType] = useState<SiteType | "">("");
  const [locationCode, setLocationCode] = useState("");
  const [ip, setIp] = useState("");
  const [hosting, setHosting] = useState("");
  const [locations, setLocations] = useState<LocationOption[]>([]);

  useEffect(() => {
    if (open && locations.length === 0) {
      fetch("/api/locations")
        .then((r) => r.json())
        .then((data) => setLocations(data))
        .catch(() => {});
    }
  }, [open, locations.length]);

  function resetForm() {
    setDomain("");
    setNiche("");
    setSiteType("");
    setLocationCode("");
    setIp("");
    setHosting("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!domain.trim()) {
      toast.error("Domain is required");
      return;
    }
    if (!niche) {
      toast.error("Niche is required");
      return;
    }
    if (!siteType) {
      toast.error("Type is required");
      return;
    }
    if (!locationCode) {
      toast.error("Country is required");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain: domain.trim(),
          niche,
          site_type: siteType,
          location_code: parseInt(locationCode, 10),
          ip: ip.trim() || null,
          hosting: hosting.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || "Failed to add site");
        return;
      }

      toast.success(`Site "${domain}" added successfully`);
      resetForm();
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error("An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" />
          Add Site
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add New Site</DialogTitle>
          <DialogDescription>
            Add a new site to your monitoring dashboard. All existing keywords
            for the selected country will be automatically assigned.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="domain">Domain *</Label>
            <Input
              id="domain"
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="niche">Niche *</Label>
              <Select
                value={niche}
                onValueChange={(val) => setNiche(val as Niche)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select niche" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="casino">Casino</SelectItem>
                  <SelectItem value="nutra">Nutra</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Type *</Label>
              <Select
                value={siteType}
                onValueChange={(val) => setSiteType(val as SiteType)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="money">Money</SelectItem>
                  <SelectItem value="emd">EMD</SelectItem>
                  <SelectItem value="pbn">PBN</SelectItem>
                  <SelectItem value="nutra">Nutra</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="country">Country *</Label>
            <Select value={locationCode} onValueChange={setLocationCode}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select country" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc) => (
                  <SelectItem key={loc.code} value={String(loc.code)}>
                    {getFlagEmoji(loc.country_iso)} {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ip">IP Address</Label>
              <Input
                id="ip"
                placeholder="192.168.1.1"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="hosting">Hosting</Label>
              <Input
                id="hosting"
                placeholder="Cloudflare, AWS..."
                value={hosting}
                onChange={(e) => setHosting(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Adding..." : "Add Site"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
