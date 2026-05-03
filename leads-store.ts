import fs from "fs";
import path from "path";

export interface FinancialProfile {
  age?: number;
  monthly_income?: number;
  monthly_expenses?: number;
  current_savings?: number;
  risk_appetite?: string;
  financial_goal?: string;
  existing_investments?: string[];
  inferred_savings_rate?: number;
  opportunity_loss_estimate?: number;
  hook_trigger?: string; // which insight made them lean in
}

export interface Lead {
  id: string;
  name: string;
  phone: string;
  email?: string;
  captured_at: string;
  status: "new" | "contacted" | "converted" | "dropped";
  financial_profile: FinancialProfile;
  conversation_summary: string;
  peak_insight: string; // the insight that triggered the advisor pitch
  chat_transcript: { role: "user" | "bot"; content: string; ts: string }[];
}

const DATA_FILE = path.join(process.cwd(), "leads.json");

function readAll(): Lead[] {
  try {
    if (!fs.existsSync(DATA_FILE)) return [];
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function writeAll(leads: Lead[]) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2));
}

export function saveLead(lead: Omit<Lead, "id" | "captured_at" | "status">): Lead {
  const leads = readAll();
  const newLead: Lead = {
    ...lead,
    id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    captured_at: new Date().toISOString(),
    status: "new",
  };
  leads.unshift(newLead);
  writeAll(leads);
  return newLead;
}

export function getAllLeads(): Lead[] {
  return readAll();
}

export function updateLeadStatus(id: string, status: Lead["status"]): boolean {
  const leads = readAll();
  const idx = leads.findIndex((l) => l.id === id);
  if (idx === -1) return false;
  leads[idx].status = status;
  writeAll(leads);
  return true;
}
