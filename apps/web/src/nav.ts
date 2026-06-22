import type { UserRole } from "@ops-copilot/shared";

/** The dashboard's top-level sections. */
export type Tab =
  | "overview"
  | "incidents"
  | "alerts"
  | "health"
  | "queues"
  | "sop"
  | "rca"
  | "knowledge"
  | "audit";

export interface NavItem {
  id: Tab;
  label: string;
  /** When set, only these roles see the item (RBAC in the UI). */
  roles?: UserRole[];
}

export const NAV: NavItem[] = [
  { id: "overview", label: "Overview" },
  { id: "incidents", label: "Incidents" },
  { id: "alerts", label: "Alerts" },
  { id: "health", label: "Health" },
  { id: "queues", label: "Queues" },
  { id: "sop", label: "SOP Search" },
  { id: "rca", label: "RCA" },
  { id: "knowledge", label: "Knowledge" },
  { id: "audit", label: "Audit", roles: ["admin"] },
];
