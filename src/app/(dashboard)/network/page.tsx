"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Network, AlertTriangle } from "lucide-react";
import dynamic from "next/dynamic";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
});

interface SiteNode {
  id: string;
  domain: string;
  siteType: string;
  niche: string;
  ip: string | null;
}

interface LinkEdge {
  source: string;
  target: string;
  anchor: string;
  isActive: boolean;
}

export default function NetworkPage() {
  const [nodes, setNodes] = useState<SiteNode[]>([]);
  const [links, setLinks] = useState<LinkEdge[]>([]);
  const [footprints, setFootprints] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const graphRef = useRef<HTMLDivElement>(null);

  const fetchNetwork = useCallback(async () => {
    const supabase = createClient();

    // Only fetch casino sites (network is casino only)
    const [{ data: sites }, { data: siteLinks }] = await Promise.all([
      supabase.from("sites").select("*").eq("niche", "casino"),
      supabase.from("site_links").select("*"),
    ]);

    if (!sites) {
      setLoading(false);
      return;
    }

    const siteNodes: SiteNode[] = sites.map((s) => ({
      id: s.id,
      domain: s.domain,
      siteType: s.site_type,
      niche: s.niche,
      ip: s.ip,
    }));

    const edges: LinkEdge[] = (siteLinks ?? []).map((l) => ({
      source: l.source_site_id,
      target: l.target_site_id,
      anchor: l.anchor_text ?? "",
      isActive: l.is_active,
    }));

    // Detect IP footprints
    const ipMap = new Map<string, string[]>();
    sites.forEach((s) => {
      if (s.ip) {
        const existing = ipMap.get(s.ip) ?? [];
        existing.push(s.domain);
        ipMap.set(s.ip, existing);
      }
    });

    const warnings: string[] = [];
    ipMap.forEach((domains, ip) => {
      if (domains.length > 1) {
        warnings.push(`Same IP ${ip}: ${domains.join(", ")}`);
      }
    });

    setNodes(siteNodes);
    setLinks(edges);
    setFootprints(warnings);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchNetwork();
  }, [fetchNetwork]);

  const graphData = {
    nodes: nodes.map((n) => ({
      id: n.id,
      name: n.domain,
      val: n.siteType === "money" ? 15 : n.siteType === "emd" ? 10 : 5,
      color:
        n.siteType === "money"
          ? "#ef4444"
          : n.siteType === "emd"
            ? "#f59e0b"
            : "#3b82f6",
    })),
    links: links.map((l) => ({
      source: l.source,
      target: l.target,
      color: l.isActive ? "#22c55e" : "#ef4444",
    })),
  };

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Casino Network</h1>
      <p className="text-muted-foreground">
        Visual mapping of PBN links to money sites and EMDs. Read-only view.
      </p>

      {/* Legend */}
      <div className="flex gap-6 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-red-500" />
          Money Site
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-amber-500" />
          EMD
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-full bg-blue-500" />
          PBN
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1 w-6 bg-green-500" />
          Active link
        </div>
        <div className="flex items-center gap-2">
          <div className="h-1 w-6 bg-red-500" />
          Broken link
        </div>
      </div>

      {/* Footprint warnings */}
      {footprints.length > 0 && (
        <Card className="border-orange-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-500">
              <AlertTriangle className="h-5 w-5" />
              Footprint Warnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {footprints.map((fp, i) => (
                <li key={i} className="text-sm">
                  {fp}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Network graph */}
      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-center text-muted-foreground">Loading...</p>
          ) : nodes.length > 0 ? (
            <div ref={graphRef} className="h-[500px] w-full">
              <ForceGraph2D
                graphData={graphData}
                nodeLabel="name"
                nodeAutoColorBy="color"
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                linkColor={(link: any) => link.color ?? "#ccc"}
                linkDirectionalArrowLength={6}
                linkDirectionalArrowRelPos={1}
                width={typeof window !== "undefined" ? Math.min(window.innerWidth - 340, 1200) : 800}
                height={500}
              />
            </div>
          ) : (
            <div className="flex flex-col items-center py-12">
              <Network className="mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-muted-foreground">
                No casino sites in the network yet
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Links table */}
      <Card>
        <CardHeader>
          <CardTitle>Network Links</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source (PBN)</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Anchor Text</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {links.map((l, i) => {
                const source = nodes.find((n) => n.id === l.source);
                const target = nodes.find((n) => n.id === l.target);
                return (
                  <TableRow key={i}>
                    <TableCell>{source?.domain ?? l.source}</TableCell>
                    <TableCell>{target?.domain ?? l.target}</TableCell>
                    <TableCell>{l.anchor}</TableCell>
                    <TableCell>
                      <Badge variant={l.isActive ? "outline" : "destructive"}>
                        {l.isActive ? "Active" : "Broken"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {links.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No links configured
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
