"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
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
import type { Location } from "@/types/database";

// Country ISO to flag emoji mapping
function getFlagEmoji(countryIso: string): string {
  const codePoints = countryIso
    .toUpperCase()
    .split("")
    .map((char) => 0x1f1e6 + char.charCodeAt(0) - 65);
  return String.fromCodePoint(...codePoints);
}

interface AddKeywordDialogProps {
  siteId: string;
}

export function AddKeywordDialog({ siteId }: AddKeywordDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [locationCode, setLocationCode] = useState("");
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);

  useEffect(() => {
    if (open && locations.length === 0) {
      fetchLocations();
    }
  }, [open]);

  async function fetchLocations() {
    setLocationsLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("locations")
        .select("*")
        .order("name");

      if (error) {
        toast.error("Failed to load locations");
        return;
      }
      setLocations(data ?? []);
    } catch {
      toast.error("Failed to load locations");
    } finally {
      setLocationsLoading(false);
    }
  }

  function resetForm() {
    setKeyword("");
    setLocationCode("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!keyword.trim()) {
      toast.error("Keyword is required");
      return;
    }
    if (!locationCode) {
      toast.error("Country is required");
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();

      const { error } = await supabase.from("keywords").insert({
        site_id: siteId,
        keyword: keyword.trim(),
        location_code: parseInt(locationCode, 10),
      });

      if (error) {
        toast.error(`Failed to add keyword: ${error.message}`);
        return;
      }

      toast.success(`Keyword "${keyword}" added successfully`);
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
          Add Keyword
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Keyword</DialogTitle>
          <DialogDescription>
            Add a new keyword to track positions for this site.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="keyword">Keyword *</Label>
            <Input
              id="keyword"
              placeholder="e.g. best online casino"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="country">Country *</Label>
            <Select value={locationCode} onValueChange={setLocationCode}>
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    locationsLoading ? "Loading countries..." : "Select country"
                  }
                />
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

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || locationsLoading}>
              {loading ? "Adding..." : "Add Keyword"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
