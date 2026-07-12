"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import type { Incident, IncidentSeverity } from "@/domain/incident/incident";

const SEVERITY_TO_BANNER_STATUS: Record<IncidentSeverity, "error" | "warning" | "info"> = {
  critical: "error",
  high: "warning",
  medium: "warning",
  low: "info",
};

interface IncidentStripProps {
  /** Pre-filtered to critical/high by the caller, sorted worst-first. Renders nothing when empty. */
  incidents: Incident[];
  onSelectIncident: (incident: Incident) => void;
}

export function IncidentStrip({ incidents, onSelectIncident }: IncidentStripProps) {
  const primary = incidents[0];
  if (!primary) {
    return null;
  }
  const remaining = incidents.length - 1;

  return (
    <Banner
      container="section"
      status={SEVERITY_TO_BANNER_STATUS[primary.severity]}
      title={primary.summary}
      description={`${primary.evidence} · Recommended action: ${primary.suggestedAction}`}
      endContent={
        <Button label="View details" variant="secondary" size="sm" onClick={() => onSelectIncident(primary)} />
      }
    >
      {remaining > 0 ? <Text type="supporting">{remaining} more incidents require attention.</Text> : null}
    </Banner>
  );
}
