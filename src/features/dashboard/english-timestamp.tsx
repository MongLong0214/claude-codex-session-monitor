"use client";

import { Text } from "@astryxdesign/core/Text";
import { useEffect, useState } from "react";

type EnglishTimestampFormat = "relative" | "date_time" | "system_time";

interface EnglishTimestampProps {
  value: string | number;
  format?: EnglishTimestampFormat;
  isLive?: boolean;
  hasTooltip?: boolean;
}

const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 60 * MINUTE_SECONDS;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const MONTH_SECONDS = 30 * DAY_SECONDS;
const YEAR_SECONDS = 365 * DAY_SECONDS;

const FULL_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZoneName: "short",
});

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function parseTimestamp(value: string | number): Date {
  if (typeof value === "number") {
    return new Date(value < 1e12 ? value * 1000 : value);
  }
  return new Date(value);
}

function unit(value: number, singular: string): string {
  return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

function relativeTimestamp(date: Date, nowMs: number): string {
  const differenceSeconds = Math.round((nowMs - date.getTime()) / 1000);

  if (Math.abs(differenceSeconds) < 10 || (differenceSeconds < 0 && Math.abs(differenceSeconds) <= 30)) {
    return "now";
  }

  const isFuture = differenceSeconds < 0;
  const elapsedSeconds = Math.abs(differenceSeconds);
  let value: string;

  if (elapsedSeconds < MINUTE_SECONDS) {
    value = isFuture ? "a few seconds" : unit(elapsedSeconds, "second");
  } else if (elapsedSeconds < HOUR_SECONDS) {
    value = unit(Math.round(elapsedSeconds / MINUTE_SECONDS), "minute");
  } else if (elapsedSeconds < DAY_SECONDS) {
    value = unit(Math.round(elapsedSeconds / HOUR_SECONDS), "hour");
  } else if (!isFuture && elapsedSeconds < 2 * DAY_SECONDS) {
    return "yesterday";
  } else if (elapsedSeconds < MONTH_SECONDS) {
    value = unit(Math.round(elapsedSeconds / DAY_SECONDS), "day");
  } else if (elapsedSeconds < YEAR_SECONDS) {
    value = unit(Math.round(elapsedSeconds / MONTH_SECONDS), "month");
  } else {
    value = unit(Math.round(elapsedSeconds / YEAR_SECONDS), "year");
  }

  return isFuture ? `in ${value}` : `${value} ago`;
}

function systemTime(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function updateInterval(date: Date, nowMs: number): number {
  const elapsedSeconds = Math.abs(nowMs - date.getTime()) / 1000;
  if (elapsedSeconds < MINUTE_SECONDS) {
    return 1_000;
  }
  if (elapsedSeconds < HOUR_SECONDS) {
    return 30_000;
  }
  return 60_000;
}

export function EnglishTimestamp({
  value,
  format = "relative",
  isLive = false,
  hasTooltip = true,
}: EnglishTimestampProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const date = parseTimestamp(value);

  useEffect(() => {
    if (!isLive || format !== "relative") {
      return;
    }
    const timer = window.setInterval(() => setNowMs(Date.now()), updateInterval(date, nowMs));
    return () => window.clearInterval(timer);
  }, [date, format, isLive, nowMs]);

  const absoluteLabel = FULL_DATE_FORMATTER.format(date);
  const displayValue =
    format === "relative"
      ? relativeTimestamp(date, nowMs)
      : format === "date_time"
        ? DATE_TIME_FORMATTER.format(date)
        : systemTime(date);

  return (
    <Text type="code" size="sm" color="secondary" hasTabularNumbers className="precisionTimestamp">
      <time
        dateTime={date.toISOString()}
        aria-label={format === "relative" ? absoluteLabel : undefined}
        title={hasTooltip ? absoluteLabel : undefined}
      >
        {displayValue}
      </time>
    </Text>
  );
}
