import React from "react";

export interface CitationData {
  id: number;
  label: string;
  title: string;
  publisher: string;
  url: string;
}

export const CITATIONS: Record<number, CitationData> = {
  1: {
    id: 1,
    label: "1",
    title: "Tracka (BudgIT) Federal Constituency Projects Report Coverage",
    publisher: "AllAfrica / BudgIT",
    url: "https://allafrica.com/stories/202602090084.html",
  },
  2: {
    id: 2,
    label: "2",
    title: "Tracka Q2 Scorecard on Unexecuted Capital Disbursements",
    publisher: "Platform Times / Tracka",
    url: "https://platformtimes.com.ng/constituency-projects-%E2%82%A6608-99bn-released-just-225-completed-as-tracka-flags-%E2%82%A613-86bn-gap/",
  },
  3: {
    id: 3,
    label: "3",
    title: "Weak Oversight and Fiscal Planning in Abandoned Public Projects",
    publisher: "The Guardian Nigeria",
    url: "https://guardian.ng/featured/weak-oversight-fiscal-plan-leave-over-60000-public-projects-abandoned/",
  },
  4: {
    id: 4,
    label: "4",
    title:
      "Overlapping Budgets and Capital Project Delivery Performance Analysis",
    publisher: "The Guardian Nigeria",
    url: "https://guardian.ng/featured/overlapping-budgets-continue-to-muddle-fiscal-space-project-delivery/",
  },
  5: {
    id: 5,
    label: "5",
    title:
      "Nigerian Institute of Quantity Surveyors on Cost Overruns and Baseline Estimation",
    publisher: "ThisDay Live / NIQS",
    url: "https://www.thisdaylive.com/2026/09/01/niqs-stop-waste-cost-overruns-on-nigerias-infrastructure-projects/",
  },
  6: {
    id: 6,
    label: "6",
    title: "Ministry of Finance Review on Capital Works Execution",
    publisher: "Vanguard Nigeria",
    url: "https://www.vanguardngr.com/2026/03/capital-projects-ongoing-not-abandoned-finance-ministry/",
  },
  7: {
    id: 7,
    label: "7",
    title:
      "National Independent Project Monitoring Agency (NIPMA) Legislative Review",
    publisher: "Prime Business Africa",
    url: "https://www.primebusiness.africa/reps-push-bill-to-curb-corruption-in-federal-projects/",
  },
  8: {
    id: 8,
    label: "8",
    title:
      "Independent Project Cost Monitoring Standards and Practice Guidelines",
    publisher: "Quantity Surveyors Registration Board of Nigeria (QSRBN)",
    url: "https://qsrbn.gov.ng/wp-content/uploads/2026/04/QSRBN_IPCM_Ogundare.pdf",
  },
  9: {
    id: 9,
    label: "9",
    title:
      "Commercial Bank In-House Project Monitoring and Milestone Verification Specification",
    publisher: "Nigerian Banking Role Standards",
    url: "https://www.hotnigerianjobs.com/print/934809/",
  },
  10: {
    id: 10,
    label: "10",
    title: "Credit Process Digitization and Facility Monitoring Controls",
    publisher: "Bank of Industry (BOI)",
    url: "https://www.boi.ng/?p=21851",
  },
  11: {
    id: 11,
    label: "11",
    title:
      "Infrastructure Guarantee Portfolio and Construction Finance Verification Requirements",
    publisher: "InfraCredit Investor Report",
    url: "https://infracredit.ng/update/wp-content/uploads/2026/08/Q2-Investor-Report_June-2026.pdf",
  },
  12: {
    id: 12,
    label: "12",
    title: "Sectoral Bank Credit Allocations in Construction and Real Estate",
    publisher: "Nigeria Housing Market / CBN Data",
    url: "https://www.nigeriahousingmarket.com/news/banks-cut-lending-real-estate-credit-declines-2025",
  },
  13: {
    id: 13,
    label: "13",
    title:
      "Remote Visual Verification for Construction Loan Drawdowns Across African Sites",
    publisher: "Nedbank Corporate & Investment Banking / OpenSpace",
    url: "https://www.openspace.ai/?p=10881",
  },
  14: {
    id: 14,
    label: "14",
    title: "Construction Loan Administration and Automated Draw Management",
    publisher: "Built Technologies",
    url: "https://getbuilt.com/blog/construction-loan-management-software-lenders/",
  },
  15: {
    id: 15,
    label: "15",
    title: "Drone and GIS Infrastructure Progress Verification for Lenders",
    publisher: "AI Clearing",
    url: "https://sifted.eu/articles/ai-clearing-series-a-14m",
  },
  16: {
    id: 16,
    label: "16",
    title: "BIM-Linked Physical Progress Tracking for Capital Delivery",
    publisher: "Buildots",
    url: "https://www.landbase.com/blog/fastest-growing-construction-tech-companies",
  },
  17: {
    id: 17,
    label: "17",
    title:
      "Remote Appraisal, Supervision, Monitoring and Evaluation (RASME) Infrastructure System",
    publisher: "African Development Bank (AfDB)",
    url: "https://www.ecofinagency.com/news-digital/2307-57661-african-development-bank-rolls-out-digital-oversight-for-419-million-liberia-portfolio",
  },
  18: {
    id: 18,
    label: "18",
    title: "Procurement of ICT-Enabled Third-Party Monitoring Services",
    publisher: "World Bank AGILE Project",
    url: "https://projects.worldbank.org/pt/projects-operations/procurement-detail/OP00293320",
  },
  19: {
    id: 19,
    label: "19",
    title:
      "Nigerian Construction Technology and Contractor Management Landscape",
    publisher: "Liners / ConTech Survey",
    url: "https://liners.com/buildtrust",
  },
  20: {
    id: 20,
    label: "20",
    title:
      "Evaluating Speech Recognition and Named-Entity Extraction on Nigerian Accents",
    publisher: "Speech & Language Benchmarks (arXiv:2608.22872)",
    url: "https://arxiv.org/pdf/2608.22872",
  },
  21: {
    id: 21,
    label: "21",
    title:
      "Central Bank of Nigeria Data Localization Directives and NDPA Compliance",
    publisher: "Chambers and Partners",
    url: "https://chambers.com/articles/data-localisation-in-nigeria-separating-myth-from-reality",
  },
  22: {
    id: 22,
    label: "22",
    title:
      "Monitoring Surveyor Legal Liability and Independent Oversight (Eiger Funding v. Ridge)",
    publisher: "Mondaq Legal Analysis",
    url: "https://www.mondaq.com/uk/real-estate/1776894/eiger-funding-pcc-ltd-v-ridge-and-partners-llp-a-cautionary-tale-for-monitoring-surveyors-and-lenders",
  },
  23: {
    id: 23,
    label: "23",
    title: "Professional Fee Scale Benchmarks for Nigerian Quantity Surveyors",
    publisher: "Ownkey / NIQS Guidelines",
    url: "https://ownkey.com/ng/blog/quantity-surveyor-nigeria-guide",
  },
  24: {
    id: 24,
    label: "24",
    title: "Official FX and Macroeconomic Indicators in Project Costing",
    publisher: "Central Bank of Nigeria / Market Reports",
    url: "https://www.opinionnigeria.com/dollar-to-naira-exchange-rate-today-october-29-2026/",
  },
  25: {
    id: 25,
    label: "25",
    title: "State and Federal Project Tracking and Procurement Compliance",
    publisher: "ICPC / Ekiti State IPMO",
    url: "https://www.nigeriahousingmarket.com/news/icpc-tracks-21tn-works-projects-anti-corruption",
  },
  26: {
    id: 26,
    label: "26",
    title: "Synthetic Imagery and AI-Generated Fraud in Claims Verification",
    publisher: "SAS Fraud Analytics Report",
    url: "https://www.sas.com/en_us/news/press-releases/2026/may/synthetic-images-ai-insurance-fraud.html",
  },
  27: {
    id: 27,
    label: "27",
    title:
      "Resident Clerk of Works Site Supervision Protocols and Buried Works Verification",
    publisher: "Alaro City / Industry Inspection Standard",
    url: "https://www.scribd.com/document/619651410/Clerk-of-works-1",
  },
};

interface CitationRefProps {
  id: number | string;
}

export function CitationRef({ id }: CitationRefProps) {
  const numericId =
    typeof id === "number"
      ? id
      : parseInt(String(id).replace(/[^0-9]/g, ""), 10);

  const citation = CITATIONS[numericId];

  if (!citation) {
    return (
      <sup className="text-xs font-semibold text-brand-primary">[{id}]</sup>
    );
  }

  const tooltipText = `${citation.title} (${citation.publisher})`;

  return (
    <sup className="inline-block select-none text-[10.5px]">
      <a
        href={citation.url}
        target="_blank"
        rel="noopener noreferrer"
        title={tooltipText}
        aria-label={tooltipText}
        className="font-semibold text-brand-primary hover:text-brand-hover hover:underline decoration-dotted underline-offset-2 transition px-0.5 py-0 rounded hover:bg-blue-50"
      >
        [{citation.id}]
      </a>
    </sup>
  );
}

export function CitationGroup({ ids }: { ids: (number | string)[] }) {
  return (
    <sup className="inline-block select-none text-[10.5px]">
      [
      {ids.map((rawId, index) => {
        const numericId =
          typeof rawId === "number"
            ? rawId
            : parseInt(String(rawId).replace(/[^0-9]/g, ""), 10);
        const citation = CITATIONS[numericId];
        const tooltipText = citation
          ? `${citation.title} (${citation.publisher})`
          : `Source #${numericId}`;

        return (
          <React.Fragment key={numericId}>
            {index > 0 && <span className="text-slate-400">, </span>}
            <a
              href={citation?.url || "#"}
              target="_blank"
              rel="noopener noreferrer"
              title={tooltipText}
              aria-label={tooltipText}
              className="font-semibold text-brand-primary hover:text-brand-hover hover:underline transition"
            >
              {numericId}
            </a>
          </React.Fragment>
        );
      })}
      ]
    </sup>
  );
}
