// =============================================================================
// Supabase Database Types for SEO Monitoring Dashboard
// =============================================================================

// ---------------------------------------------------------------------------
// Enum Types
// ---------------------------------------------------------------------------

export type Niche = "casino" | "nutra";

export type SiteType = "money" | "emd" | "pbn" | "nutra";

export type DeindexStatus = "detected" | "reindex_submitted" | "reindexed";

export type AlertType =
  | "deindex"
  | "position_drop"
  | "site_down"
  | "link_broken"
  | "brand_hot"
  | "brand_cooling"
  | "optimization_needed";

export type Severity = "critical" | "warning" | "info";

export type IndexerTaskStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export type ApiService = "dataforseo" | "brave" | "gsc" | "google_indexing";

export type BrandStatus = "hot" | "cooling" | "removed";

export type OptimizationStatus = "pending" | "in_progress" | "completed" | "failed";
export type OptimizationTrigger = "drop" | "opportunity" | "low_ctr" | "brand_hot" | "manual";

// ---------------------------------------------------------------------------
// JSON column types
// ---------------------------------------------------------------------------

export interface IndexerTaskResults {
  submitted?: number;
  indexed?: number;
  failed?: number;
  details?: Array<{
    url: string;
    status: string;
    message?: string;
  }>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Database Interface (Supabase pattern)
// ---------------------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      sites: {
        Row: {
          id: string;
          user_id: string;
          domain: string;
          niche: Niche;
          site_type: SiteType;
          location_code: number | null;
          ip: string | null;
          hosting: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          domain: string;
          niche: Niche;
          site_type: SiteType;
          location_code?: number | null;
          ip?: string | null;
          hosting?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          domain?: string;
          niche?: Niche;
          site_type?: SiteType;
          location_code?: number | null;
          ip?: string | null;
          hosting?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      locations: {
        Row: {
          code: number;
          name: string;
          country_iso: string;
          default_language: string;
        };
        Insert: {
          code: number;
          name: string;
          country_iso: string;
          default_language: string;
        };
        Update: {
          code?: number;
          name?: string;
          country_iso?: string;
          default_language?: string;
        };
        Relationships: [];
      };

      keywords: {
        Row: {
          id: string;
          site_id: string;
          keyword: string;
          location_code: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          keyword: string;
          location_code: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          site_id?: string;
          keyword?: string;
          location_code?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "keywords_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "keywords_location_code_fkey";
            columns: ["location_code"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["code"];
          },
        ];
      };

      deindexed_urls: {
        Row: {
          id: string;
          site_id: string;
          keyword_id: string;
          url: string;
          status: DeindexStatus;
          detected_at: string;
          reindexed_at: string | null;
          indexer_task_id: string | null;
        };
        Insert: {
          id?: string;
          site_id: string;
          keyword_id: string;
          url: string;
          status?: DeindexStatus;
          detected_at?: string;
          reindexed_at?: string | null;
          indexer_task_id?: string | null;
        };
        Update: {
          id?: string;
          site_id?: string;
          keyword_id?: string;
          url?: string;
          status?: DeindexStatus;
          detected_at?: string;
          reindexed_at?: string | null;
          indexer_task_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "deindexed_urls_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deindexed_urls_keyword_id_fkey";
            columns: ["keyword_id"];
            isOneToOne: false;
            referencedRelation: "keywords";
            referencedColumns: ["id"];
          },
        ];
      };

      technical_audits: {
        Row: {
          id: string;
          site_id: string;
          http_status: number | null;
          has_ssl: boolean | null;
          robots_txt_status: string | null;
          sitemap_status: string | null;
          meta_robots: string | null;
          load_time_ms: number | null;
          checked_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          http_status?: number | null;
          has_ssl?: boolean | null;
          robots_txt_status?: string | null;
          sitemap_status?: string | null;
          meta_robots?: string | null;
          load_time_ms?: number | null;
          checked_at?: string;
        };
        Update: {
          id?: string;
          site_id?: string;
          http_status?: number | null;
          has_ssl?: boolean | null;
          robots_txt_status?: string | null;
          sitemap_status?: string | null;
          meta_robots?: string | null;
          load_time_ms?: number | null;
          checked_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "technical_audits_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
        ];
      };

      site_links: {
        Row: {
          id: string;
          source_site_id: string;
          target_site_id: string;
          anchor_text: string | null;
          link_url: string;
          is_active: boolean;
          last_checked: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          source_site_id: string;
          target_site_id: string;
          anchor_text?: string | null;
          link_url: string;
          is_active?: boolean;
          last_checked?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          source_site_id?: string;
          target_site_id?: string;
          anchor_text?: string | null;
          link_url?: string;
          is_active?: boolean;
          last_checked?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "site_links_source_site_id_fkey";
            columns: ["source_site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "site_links_target_site_id_fkey";
            columns: ["target_site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
        ];
      };

      alerts: {
        Row: {
          id: string;
          site_id: string | null;
          alert_type: AlertType;
          severity: Severity;
          message: string;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          site_id?: string | null;
          alert_type: AlertType;
          severity: Severity;
          message: string;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          site_id?: string | null;
          alert_type?: AlertType;
          severity?: Severity;
          message?: string;
          is_read?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "alerts_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
        ];
      };

      alert_rules: {
        Row: {
          id: string;
          user_id: string;
          site_id: string | null;
          alert_type: AlertType;
          threshold_value: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          site_id?: string | null;
          alert_type: AlertType;
          threshold_value: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          site_id?: string | null;
          alert_type?: AlertType;
          threshold_value?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "alert_rules_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
        ];
      };

      indexer_tasks: {
        Row: {
          id: string;
          task_id: string;
          site_id: string | null;
          urls: string[];
          status: IndexerTaskStatus;
          created_at: string;
          completed_at: string | null;
          results: IndexerTaskResults | null;
        };
        Insert: {
          id?: string;
          task_id: string;
          site_id?: string | null;
          urls: string[];
          status?: IndexerTaskStatus;
          created_at?: string;
          completed_at?: string | null;
          results?: IndexerTaskResults | null;
        };
        Update: {
          id?: string;
          task_id?: string;
          site_id?: string | null;
          urls?: string[];
          status?: IndexerTaskStatus;
          created_at?: string;
          completed_at?: string | null;
          results?: IndexerTaskResults | null;
        };
        Relationships: [
          {
            foreignKeyName: "indexer_tasks_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
        ];
      };

      site_pages: {
        Row: {
          id: string;
          site_id: string;
          url: string;
          source: string;
          index_status: string;
          last_checked_at: string | null;
          checker_task_id: string | null;
          product_name: string | null;
          submitted_at: string | null;
          indexed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          site_id: string;
          url: string;
          source?: string;
          index_status?: string;
          last_checked_at?: string | null;
          checker_task_id?: string | null;
          product_name?: string | null;
          submitted_at?: string | null;
          indexed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          site_id?: string;
          url?: string;
          source?: string;
          index_status?: string;
          last_checked_at?: string | null;
          checker_task_id?: string | null;
          product_name?: string | null;
          submitted_at?: string | null;
          indexed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "site_pages_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
        ];
      };

      gsc_properties: {
        Row: {
          id: string;
          user_id: string;
          site_url: string;
          permission_level: string | null;
          site_id: string | null;
          is_active: boolean;
          last_synced_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          site_url: string;
          permission_level?: string | null;
          site_id?: string | null;
          is_active?: boolean;
          last_synced_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          site_url?: string;
          permission_level?: string | null;
          site_id?: string | null;
          is_active?: boolean;
          last_synced_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gsc_properties_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
        ];
      };

      gsc_search_data: {
        Row: {
          id: string;
          gsc_property_id: string;
          date: string;
          query: string;
          page: string | null;
          country: string;
          clicks: number;
          impressions: number;
          ctr: number;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          gsc_property_id: string;
          date: string;
          query: string;
          page?: string | null;
          country: string;
          clicks?: number;
          impressions?: number;
          ctr?: number;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          gsc_property_id?: string;
          date?: string;
          query?: string;
          page?: string | null;
          country?: string;
          clicks?: number;
          impressions?: number;
          ctr?: number;
          position?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "gsc_search_data_gsc_property_id_fkey";
            columns: ["gsc_property_id"];
            isOneToOne: false;
            referencedRelation: "gsc_properties";
            referencedColumns: ["id"];
          },
        ];
      };

      country_code_mapping: {
        Row: {
          alpha3: string;
          alpha2: string;
          location_code: number | null;
        };
        Insert: {
          alpha3: string;
          alpha2: string;
          location_code?: number | null;
        };
        Update: {
          alpha3?: string;
          alpha2?: string;
          location_code?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "country_code_mapping_location_code_fkey";
            columns: ["location_code"];
            isOneToOne: false;
            referencedRelation: "locations";
            referencedColumns: ["code"];
          },
        ];
      };

      gsc_auto_rules: {
        Row: {
          id: string;
          user_id: string;
          min_clicks_keyword: number;
          min_clicks_page_daily: number;
          auto_add_enabled: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          min_clicks_keyword?: number;
          min_clicks_page_daily?: number;
          auto_add_enabled?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          min_clicks_keyword?: number;
          min_clicks_page_daily?: number;
          auto_add_enabled?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };

      brand_tracking: {
        Row: {
          id: string;
          brand_name: string;
          nutra_product_id: string | null;
          country: string;
          status: BrandStatus;
          impressions_current_week: number;
          impressions_previous_week: number;
          entered_at: string;
          cooling_since: string | null;
          dataforseo_position: number | null;
          dataforseo_last_check: string | null;
          product_category: string | null;
          product_countries: string[] | null;
          product_active: boolean;
          affiliate_url: string | null;
          last_enriched_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          brand_name: string;
          nutra_product_id?: string | null;
          country: string;
          status?: BrandStatus;
          impressions_current_week?: number;
          impressions_previous_week?: number;
          entered_at?: string;
          cooling_since?: string | null;
          dataforseo_position?: number | null;
          dataforseo_last_check?: string | null;
          product_category?: string | null;
          product_countries?: string[] | null;
          product_active?: boolean;
          affiliate_url?: string | null;
          last_enriched_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          brand_name?: string;
          nutra_product_id?: string | null;
          country?: string;
          status?: BrandStatus;
          impressions_current_week?: number;
          impressions_previous_week?: number;
          entered_at?: string;
          cooling_since?: string | null;
          dataforseo_position?: number | null;
          dataforseo_last_check?: string | null;
          product_category?: string | null;
          product_countries?: string[] | null;
          product_active?: boolean;
          affiliate_url?: string | null;
          last_enriched_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      content_optimizations: {
        Row: {
          id: string;
          page_url: string;
          site_id: string | null;
          trigger: OptimizationTrigger;
          status: OptimizationStatus;
          metrics_before: Record<string, unknown>;
          metrics_after: Record<string, unknown> | null;
          changes_made: string | null;
          agent_name: string | null;
          brand_name: string | null;
          requested_at: string;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          page_url: string;
          site_id?: string | null;
          trigger: OptimizationTrigger;
          status?: OptimizationStatus;
          metrics_before?: Record<string, unknown>;
          metrics_after?: Record<string, unknown> | null;
          changes_made?: string | null;
          agent_name?: string | null;
          brand_name?: string | null;
          requested_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          page_url?: string;
          site_id?: string | null;
          trigger?: OptimizationTrigger;
          status?: OptimizationStatus;
          metrics_before?: Record<string, unknown>;
          metrics_after?: Record<string, unknown> | null;
          changes_made?: string | null;
          agent_name?: string | null;
          brand_name?: string | null;
          requested_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "content_optimizations_site_id_fkey";
            columns: ["site_id"];
            isOneToOne: false;
            referencedRelation: "sites";
            referencedColumns: ["id"];
          },
        ];
      };

      api_usage_log: {
        Row: {
          id: string;
          user_id: string;
          service: ApiService;
          endpoint: string | null;
          credits_used: number;
          cost_usd: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          service: ApiService;
          endpoint?: string | null;
          credits_used?: number;
          cost_usd?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          service?: ApiService;
          endpoint?: string | null;
          credits_used?: number;
          cost_usd?: number;
          created_at?: string;
        };
        Relationships: [];
      };
    };

    Views: {
      [_ in never]: never;
    };

    Functions: {
      [_ in never]: never;
    };

    Enums: {
      niche: Niche;
      site_type: SiteType;
      deindex_status: DeindexStatus;
      alert_type: AlertType;
      severity: Severity;
      indexer_task_status: IndexerTaskStatus;
      api_service: ApiService;
      brand_status: BrandStatus;
      optimization_status: OptimizationStatus;
      optimization_trigger: OptimizationTrigger;
    };

    CompositeTypes: {
      [_ in never]: never;
    };
  };
}

// ---------------------------------------------------------------------------
// Helper Types
// ---------------------------------------------------------------------------

export type Tables = Database["public"]["Tables"];
export type Enums = Database["public"]["Enums"];

// ---------------------------------------------------------------------------
// Row Type Aliases
// ---------------------------------------------------------------------------

export type Site = Tables["sites"]["Row"];
export type Location = Tables["locations"]["Row"];
export type Keyword = Tables["keywords"]["Row"];
export type DeindexedUrl = Tables["deindexed_urls"]["Row"];
export type TechnicalAudit = Tables["technical_audits"]["Row"];
export type SiteLink = Tables["site_links"]["Row"];
export type Alert = Tables["alerts"]["Row"];
export type AlertRule = Tables["alert_rules"]["Row"];
export type IndexerTask = Tables["indexer_tasks"]["Row"];
export type SitePage = Tables["site_pages"]["Row"];
export type ApiUsageLog = Tables["api_usage_log"]["Row"];
export type GscProperty = Tables["gsc_properties"]["Row"];
export type GscSearchData = Tables["gsc_search_data"]["Row"];
export type CountryCodeMapping = Tables["country_code_mapping"]["Row"];
export type GscAutoRule = Tables["gsc_auto_rules"]["Row"];
export type BrandTracking = Tables["brand_tracking"]["Row"];

// ---------------------------------------------------------------------------
// Insert Type Aliases
// ---------------------------------------------------------------------------

export type SiteInsert = Tables["sites"]["Insert"];
export type KeywordInsert = Tables["keywords"]["Insert"];
export type DeindexedUrlInsert = Tables["deindexed_urls"]["Insert"];
export type TechnicalAuditInsert = Tables["technical_audits"]["Insert"];
export type SiteLinkInsert = Tables["site_links"]["Insert"];
export type AlertInsert = Tables["alerts"]["Insert"];
export type AlertRuleInsert = Tables["alert_rules"]["Insert"];
export type IndexerTaskInsert = Tables["indexer_tasks"]["Insert"];
export type SitePageInsert = Tables["site_pages"]["Insert"];
export type ApiUsageLogInsert = Tables["api_usage_log"]["Insert"];
export type GscPropertyInsert = Tables["gsc_properties"]["Insert"];
export type GscSearchDataInsert = Tables["gsc_search_data"]["Insert"];
export type GscAutoRuleInsert = Tables["gsc_auto_rules"]["Insert"];
export type BrandTrackingInsert = Tables["brand_tracking"]["Insert"];
export type BrandTrackingUpdate = Tables["brand_tracking"]["Update"];
export type ContentOptimization = Tables["content_optimizations"]["Row"];
export type ContentOptimizationInsert = Tables["content_optimizations"]["Insert"];
export type ContentOptimizationUpdate = Tables["content_optimizations"]["Update"];

// ---------------------------------------------------------------------------
// Update Type Aliases
// ---------------------------------------------------------------------------

export type SiteUpdate = Tables["sites"]["Update"];
export type KeywordUpdate = Tables["keywords"]["Update"];
export type DeindexedUrlUpdate = Tables["deindexed_urls"]["Update"];
export type AlertUpdate = Tables["alerts"]["Update"];
export type AlertRuleUpdate = Tables["alert_rules"]["Update"];
export type IndexerTaskUpdate = Tables["indexer_tasks"]["Update"];

// ---------------------------------------------------------------------------
// Extended types (with joins)
// ---------------------------------------------------------------------------

export type SiteWithKeywords = Site & {
  keywords: Keyword[];
};

export type SiteWithStats = Site & {
  keyword_count: number;
  deindexed_count: number;
  avg_position: number | null;
  alert_count: number;
};
