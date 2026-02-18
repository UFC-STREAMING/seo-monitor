import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Globe, Plus, ExternalLink, MoreHorizontal } from "lucide-react";
import { AddSiteDialog } from "@/components/sites/add-site-dialog";
import { DeleteSiteButton } from "@/components/sites/delete-site-button";

interface SiteWithCount {
  id: string;
  domain: string;
  niche: string;
  site_type: string;
  location_code: number | null;
  locations: { name: string; country_iso: string } | null;
  ip: string | null;
  hosting: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  keywords: { count: number }[];
}

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const filter = params.filter ?? "all";

  let query = supabase
    .from("sites")
    .select("*, keywords(count), locations(name, country_iso)")
    .order("domain");

  if (filter === "casino") {
    query = query.eq("niche", "casino");
  } else if (filter === "nutra") {
    query = query.eq("niche", "nutra");
  }

  const { data: sites } = await query;

  const typedSites = (sites ?? []) as unknown as SiteWithCount[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Sites</h1>
        <AddSiteDialog />
      </div>

      {/* Filter buttons */}
      <div className="flex gap-2">
        <Link href="/sites">
          <Button variant={filter === "all" ? "default" : "outline"} size="sm">
            All
          </Button>
        </Link>
        <Link href="/sites?filter=casino">
          <Button
            variant={filter === "casino" ? "default" : "outline"}
            size="sm"
          >
            Casino
          </Button>
        </Link>
        <Link href="/sites?filter=nutra">
          <Button
            variant={filter === "nutra" ? "default" : "outline"}
            size="sm"
          >
            Nutra
          </Button>
        </Link>
      </div>

      {/* Sites table */}
      {typedSites.length > 0 ? (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Domain</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Niche</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-center">Keywords</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {typedSites.map((site) => {
                const keywordCount = site.keywords?.[0]?.count ?? 0;

                return (
                  <TableRow key={site.id}>
                    <TableCell>
                      <Link
                        href={`/sites/${site.id}`}
                        className="flex items-center gap-2 font-medium text-primary hover:underline"
                      >
                        <Globe className="h-4 w-4" />
                        {site.domain}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {site.locations ? (
                        <Badge variant="outline">
                          {site.locations.country_iso}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {site.niche}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="uppercase">
                        {site.site_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">{keywordCount}</TableCell>
                    <TableCell className="text-center">
                      {site.is_active ? (
                        <Badge className="bg-green-600 hover:bg-green-700">
                          Active
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link href={`/sites/${site.id}`}>
                          <Button variant="ghost" size="sm">
                            <ExternalLink className="h-4 w-4" />
                            View
                          </Button>
                        </Link>
                        <DeleteSiteButton siteId={site.id} domain={site.domain} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
          <Globe className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="mb-2 text-lg font-medium">No sites yet</p>
          <p className="mb-4 text-sm text-muted-foreground">
            Add your first site to start monitoring
          </p>
          <AddSiteDialog />
        </div>
      )}
    </div>
  );
}
