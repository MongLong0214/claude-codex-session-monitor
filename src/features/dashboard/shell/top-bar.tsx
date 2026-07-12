"use client";

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { NavIcon } from "@astryxdesign/core/NavIcon";
import { HStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import type { AgentStatusKind } from "@/domain/agent/status";
import type { DashboardSummary } from "@/domain/dashboard";
import type { ConnectionStatus } from "@/lib/realtime/transport";
import { EnglishTimestamp } from "../english-timestamp";
import { CONNECTION_DOT_VARIANT, CONNECTION_LABEL } from "../status-presentation";
import { StatusCounters } from "./status-counters";
import styles from "./status-counters.module.css";

interface TopBarProps {
  summary: DashboardSummary;
  statusFilter: AgentStatusKind[];
  onToggleStatusFilter: (status: AgentStatusKind) => void;
  connectionStatus: ConnectionStatus;
  lastSyncedAt: string | null;
  onOpenCommandPalette: () => void;
}

export function TopBar({
  summary,
  statusFilter,
  onToggleStatusFilter,
  connectionStatus,
  lastSyncedAt,
  onOpenCommandPalette,
}: TopBarProps) {
  return (
    <TopNav
      label="Dashboard header"
      heading={
        <TopNavHeading
          logo={<NavIcon icon={<Icon icon="viewColumns" size="sm" />} />}
          heading="Agent Session Monitor"
        />
      }
      centerContent={
        <StatusCounters summary={summary} activeFilter={statusFilter} onToggleFilter={onToggleStatusFilter} />
      }
      endContent={
        <HStack gap={3} vAlign="center" className={styles.endControls}>
          <HStack gap={1} vAlign="center" className={styles.liveIndicator}>
            <StatusDot
              variant={CONNECTION_DOT_VARIANT[connectionStatus]}
              label={CONNECTION_LABEL[connectionStatus]}
              tooltip={CONNECTION_LABEL[connectionStatus]}
              isPulsing={connectionStatus === "open"}
            />
            <Text type="supporting" weight="medium" className={styles.connectionLabel}>
              {CONNECTION_LABEL[connectionStatus]}
            </Text>
          </HStack>
          {lastSyncedAt ? (
            <HStack className={styles.syncTime}>
              <EnglishTimestamp value={lastSyncedAt} isLive />
            </HStack>
          ) : null}
          <Button
            label="Search sessions (Ctrl+K)"
            aria-label="Search sessions (Ctrl+K)"
            icon={<Icon icon="search" />}
            variant="ghost"
            size="sm"
            className={styles.searchButton}
            onClick={onOpenCommandPalette}
          />
        </HStack>
      }
    />
  );
}
