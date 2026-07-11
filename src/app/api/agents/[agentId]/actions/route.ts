import { NextResponse } from "next/server";

import { agentCommandRepository, dashboardRepository } from "@/data-access/repositories";
import { AgentActionRequestSchema } from "@/domain/agent/actions";
import { AgentIdSchema } from "@/domain/agent/agent";
import { guardLocalRequest, readJsonRequestBody } from "@/lib/security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const denied = guardLocalRequest(request);
  if (denied) {
    return denied;
  }

  const body = await readJsonRequestBody(request);
  if (!body.ok) {
    return body.response;
  }

  const parsed = AgentActionRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  }

  /** Registered-agent allowlist: only ids the repository currently observes may be acted upon. */
  const params = AgentIdSchema.safeParse((await context.params).agentId);
  if (!params.success) {
    return NextResponse.json({ error: "에이전트 ID가 올바르지 않습니다." }, { status: 400 });
  }
  const agentId = params.data;
  const snapshot = await dashboardRepository.getSnapshot();
  if (!Object.hasOwn(snapshot.byId, agentId)) {
    return NextResponse.json({ error: `알 수 없는 에이전트입니다: ${agentId}` }, { status: 404 });
  }

  const result = await agentCommandRepository.execute(agentId, parsed.data);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
