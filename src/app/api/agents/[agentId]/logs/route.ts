import { NextResponse } from "next/server";

import { agentLogRepository, dashboardRepository } from "@/data-access/repositories";
import { AgentIdSchema } from "@/domain/agent/agent";
import { AgentLogQuerySchema } from "@/domain/agent/logs";
import { guardLocalRequest } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const denied = guardLocalRequest(request);
  if (denied) {
    return denied;
  }

  const limitParam = new URL(request.url).searchParams.get("limit");
  const parsed = AgentLogQuerySchema.safeParse(limitParam === null ? {} : { limit: limitParam });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid limit value." }, { status: 400 });
  }

  /** Registered-agent allowlist: only ids the repository currently observes may be read. */
  const params = AgentIdSchema.safeParse((await context.params).agentId);
  if (!params.success) {
    return NextResponse.json({ error: "Invalid agent ID." }, { status: 400 });
  }
  const agentId = params.data;
  const snapshot = await dashboardRepository.getSnapshot();
  if (!Object.hasOwn(snapshot.byId, agentId)) {
    return NextResponse.json({ error: `Unknown agent: ${agentId}` }, { status: 404 });
  }

  const logs = await agentLogRepository.readLines(agentId, parsed.data.limit);
  return NextResponse.json(logs, { headers: { "Cache-Control": "no-store" } });
}
