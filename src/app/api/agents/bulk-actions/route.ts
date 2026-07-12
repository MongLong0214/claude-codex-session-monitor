import { NextResponse } from "next/server";

import { agentCommandRepository, dashboardRepository } from "@/data-access/repositories";
import type { AgentActionResult, BulkAgentActionResponse } from "@/domain/agent/actions";
import { BulkAgentActionRequestSchema } from "@/domain/agent/actions";
import { guardLocalRequest, readJsonRequestBody } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const denied = guardLocalRequest(request);
  if (denied) {
    return denied;
  }

  const body = await readJsonRequestBody(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = BulkAgentActionRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { agentIds, action, force } = parsed.data;
  const snapshot = await dashboardRepository.getSnapshot();

  /** Unknown ids degrade to a per-item "skipped" result instead of failing the whole batch. */
  const knownIds = agentIds.filter((agentId) => Object.hasOwn(snapshot.byId, agentId));
  const executed = await agentCommandRepository.executeBulk(knownIds, action, force);
  const resultById = new Map(executed.map((result) => [result.agentId, result]));

  const results: AgentActionResult[] = agentIds.map(
    (agentId) =>
      resultById.get(agentId) ?? {
        agentId,
        action,
        status: "skipped",
        message: "Agent is not registered.",
      },
  );

  const response: BulkAgentActionResponse = { results };
  return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
}
