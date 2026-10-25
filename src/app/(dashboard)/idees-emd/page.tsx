"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

// Idées EMD (Leo 25/10/2026) : par produit et pays, vrais clics offres, ventes,
// taux de conversion et Search Console des fiches nutra, pour choisir où lancer
// un EMD. Alimenté chaque matin par nutra-factory (scripts/sync-idees-emd.ts).

interface Idee {
  produit: string; pays: string; vrais_clics_7j: number; vrais_clics_30j: number; ventes_30j: number; revenu_30j: number;
  taux_conversion: number | null; gsc_impressions_28j: number; gsc_clics_28j: number; gsc_position: number | null;
  gsc_top_requete: string | null; nb_fiches: number; sites: string[]; emd_existant: string | null; score: number; maj_le: string;
}
interface SiteGsc { domaine: string; pays: string | null; gsc_clics_28j: number; gsc_impressions_28j: number; vrais_clics_offres_30j: number }

const nf = (n: number | null | undefined) => (n == null ? "—" : Math.round(Number(n)).toLocaleString("fr-FR"));

export default function IdeesEmdPage() {
  const [idees, setIdees] = useState<Idee[]>([]);
  const [sites, setSites] = useState<SiteGsc[]>([]);
  const [pays, setPays] = useState("tous");
  const [sansEmd, setSansEmd] = useState(true);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Tables pas encore dans les types générés (database.ts).
      const sb = createClient() as unknown as SupabaseClient;
      const tout: Idee[] = [];
      for (let f = 0; ; f += 1000) {
        const { data } = await sb.from("emd_idees").select("*").order("score", { ascending: false }).range(f, f + 999);
        if (!data?.length) break;
        tout.push(...(data as unknown as Idee[]));
        if (data.length < 1000) break;
      }
      const { data: s } = await sb.from("nutra_site_gsc").select("*").order("gsc_impressions_28j", { ascending: false });
      setIdees(tout); setSites((s as unknown as SiteGsc[]) || []); setLoading(false);
    })();
  }, []);

  const listePays = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of idees) m.set(i.pays, (m.get(i.pays) || 0) + i.score);
    return [...m].sort((a, b) => b[1] - a[1]).map(([p]) => p);
  }, [idees]);

  const vues = useMemo(() => idees.filter((i) =>
    (pays === "tous" || i.pays === pays) && (!sansEmd || !i.emd_existant) && (!q || i.produit.toLowerCase().includes(q.toLowerCase())),
  ).slice(0, 300), [idees, pays, sansEmd, q]);

  const maj = idees[0]?.maj_le ? new Date(idees[0].maj_le).toLocaleString("fr-FR") : "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Idées EMD</h1>
        <p className="text-sm text-muted-foreground">
          Par produit et pays : vrais clics sur les offres (robots exclus), ventes et taux de conversion Everflow sur 30 jours,
          impressions Google des fiches nutra sur 28 jours. Score = ventes × 50 + vrais clics + impressions / 20. Mis à jour : {maj}.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select className="h-9 rounded-md border bg-background px-3 text-sm" value={pays} onChange={(e) => setPays(e.target.value)}>
          <option value="tous">Tous les pays</option>
          {listePays.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={sansEmd} onChange={(e) => setSansEmd(e.target.checked)} />
          Seulement sans EMD
        </label>
        <Input className="h-9 w-56" placeholder="Chercher un produit" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="text-sm text-muted-foreground">{vues.length} lignes</span>
      </div>

      <Card>
        <CardHeader><CardTitle>Produits × pays</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          {loading ? <p className="text-sm text-muted-foreground">Chargement…</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produit</TableHead><TableHead>Pays</TableHead><TableHead className="text-right">Score</TableHead>
                  <TableHead className="text-right">Vrais clics 7 j</TableHead><TableHead className="text-right">Vrais clics 30 j</TableHead>
                  <TableHead className="text-right">Ventes 30 j</TableHead><TableHead className="text-right">Revenu</TableHead><TableHead className="text-right">Conversion</TableHead>
                  <TableHead className="text-right">Impressions Google</TableHead><TableHead className="text-right">Clics Google</TableHead><TableHead className="text-right">Position</TableHead>
                  <TableHead>Requête principale</TableHead><TableHead>Fiches</TableHead><TableHead>EMD</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vues.map((i) => (
                  <TableRow key={`${i.produit}|${i.pays}`}>
                    <TableCell className="font-medium">{i.produit}</TableCell>
                    <TableCell><Badge variant="outline">{i.pays}</Badge></TableCell>
                    <TableCell className="text-right font-semibold">{nf(i.score)}</TableCell>
                    <TableCell className="text-right">{nf(i.vrais_clics_7j)}</TableCell>
                    <TableCell className="text-right">{nf(i.vrais_clics_30j)}</TableCell>
                    <TableCell className="text-right">{nf(i.ventes_30j)}</TableCell>
                    <TableCell className="text-right">{i.revenu_30j ? `${nf(i.revenu_30j)} €` : "—"}</TableCell>
                    <TableCell className="text-right">{i.taux_conversion == null ? "—" : `${i.taux_conversion} %`}</TableCell>
                    <TableCell className="text-right">{nf(i.gsc_impressions_28j)}</TableCell>
                    <TableCell className="text-right">{nf(i.gsc_clics_28j)}</TableCell>
                    <TableCell className="text-right">{i.gsc_position ?? "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-sm">{i.gsc_top_requete || "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground" title={i.sites.join(", ")}>{i.sites.length ? i.sites.join(", ") : "—"}</TableCell>
                    <TableCell>{i.emd_existant ? <Badge variant="secondary">{i.emd_existant}</Badge> : <span className="text-xs text-emerald-600 dark:text-emerald-400">libre</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Sites nutra : Google (28 j) et vrais clics offres (30 j)</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead><TableHead>Pays</TableHead><TableHead className="text-right">Impressions</TableHead>
                <TableHead className="text-right">Clics Google</TableHead><TableHead className="text-right">Vrais clics offres</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sites.map((s) => (
                <TableRow key={s.domaine}>
                  <TableCell className="font-medium">{s.domaine}</TableCell>
                  <TableCell>{s.pays || "—"}</TableCell>
                  <TableCell className="text-right">{nf(s.gsc_impressions_28j)}</TableCell>
                  <TableCell className="text-right">{nf(s.gsc_clics_28j)}</TableCell>
                  <TableCell className="text-right">{nf(s.vrais_clics_offres_30j)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
