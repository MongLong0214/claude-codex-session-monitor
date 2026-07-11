import { z } from "zod";
import { AgentSchema, ProjectRefSchema } from "../agent/agent";
import { DashboardSummarySchema } from "../dashboard";
import { IncidentSchema } from "../incident/incident";

const baseEventFields = {
  eventId: z.string(),
  sequence: z.number().int().nonnegative(),
  timestamp: z.iso.datetime(),
  correlationId: z.string().nullable(),
};

export const AgentUpsertedEventSchema = z
  .object({
    ...baseEventFields,
    type: z.literal("agent_upserted"),
    entityId: z.string(),
    payload: AgentSchema,
  })
  .refine((event) => event.entityId === event.payload.id, { path: ["entityId"] });

export const AgentRemovedEventSchema = z.object({
  ...baseEventFields,
  type: z.literal("agent_removed"),
  entityId: z.string(),
  payload: z.object({ reason: z.string().optional() }),
});

export const SummaryUpdatedEventSchema = z.object({
  ...baseEventFields,
  type: z.literal("summary_updated"),
  entityId: z.null(),
  payload: DashboardSummarySchema,
});

export const ProjectsUpdatedEventSchema = z.object({
  ...baseEventFields,
  type: z.literal("projects_updated"),
  entityId: z.null(),
  payload: z.array(ProjectRefSchema),
});

export const IncidentUpsertedEventSchema = z
  .object({
    ...baseEventFields,
    type: z.literal("incident_upserted"),
    entityId: z.string(),
    payload: IncidentSchema,
  })
  .refine((event) => event.entityId === event.payload.id, { path: ["entityId"] });

export const IncidentResolvedEventSchema = z.object({
  ...baseEventFields,
  type: z.literal("incident_resolved"),
  entityId: z.string(),
  payload: z.object({}),
});

export const HeartbeatEventSchema = z.object({
  ...baseEventFields,
  type: z.literal("heartbeat"),
  entityId: z.null(),
  payload: z.object({ serverTime: z.iso.datetime() }),
});

export const RealtimeEventSchema = z.discriminatedUnion("type", [
  AgentUpsertedEventSchema,
  AgentRemovedEventSchema,
  SummaryUpdatedEventSchema,
  ProjectsUpdatedEventSchema,
  IncidentUpsertedEventSchema,
  IncidentResolvedEventSchema,
  HeartbeatEventSchema,
]);
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;
export type RealtimeEventType = RealtimeEvent["type"];
