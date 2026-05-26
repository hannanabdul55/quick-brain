export type TopVendorRow = {
  vendor: string;
  total: number;
  invoiceCount: number;
};

export type PnlSnapshot = {
  month: string; // "2026-03"
  revenue: number;
  cogs: number;
  opex: number;
  net: number;
  prevMonth?: {
    month: string;
    revenue: number;
    cogs: number;
    opex: number;
    net: number;
  };
};

export type AnomalyRow = {
  date: string; // "YYYY-MM-DD" extracted from the bullet
  vendorSlug: string; // "beanstalk-roasters" (the [[companies/X]] target after stripping the prefix)
  description: string; // full text after the wikilink
  dollarImpact: number; // largest dollar figure found in description text
  sourcePath: string; // wiki-link or originals path the bullet points at
};

export type InsightBundle = {
  topVendors: TopVendorRow[];
  pnl: PnlSnapshot | null;
  anomalies: AnomalyRow[];
  computedAt: number; // Date.now()
};
