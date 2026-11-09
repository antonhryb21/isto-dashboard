import "server-only";
import { and, desc, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import { aiInsights, type AiInsight } from "@/db/schema";
import { buildSnapshot } from "./snapshot";

export const AI_MODEL = process.env.AI_MODEL || "claude-sonnet-5-5";
export const MANUAL_COOLDOWN_MINUTES = 60;

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM = `Ти — досвідчений performance-маркетолог і аналітик, радник маркетингової команди ISTO (архітектура та дизайн інтерʼєрів, ринки Дубай, Європа, Румунія).
Тобі дають JSON зі зведеними цифрами з дашборду: реклама Meta, CRM-воронка лідів, план місяця, органічні соцмережі, Instagram конкурентів. Особистих даних лідів там немає.

Правила:
- Спирайся ЛИШЕ на цифри з JSON. Нічого не вигадуй і не припускай даних, яких немає. Кожен висновок підкріплюй 1–4 конкретними цифрами з JSON у полі evidence (з одиницями й валютою).
- Не додавай і не порівнюй суми в різних валютах (AED і USD — окремі ринки).
- Порівнюй останні 30 днів з попередніми 30 і тижневу динаміку. Малі вибірки (кілька лідів) — позначай низькою впевненістю.
- Для архітектурного бюро важлива якість лідів і угоди, а не лише дешевий лід: дивись на якісні ліди, зустрічі, угоди, швидкість реакції, ROMI.
- Дії — конкретні й виконувані цього тижня (що саме змінити, в якій кампанії/креативі, на скільки). Ти лише радиш: нічого не змінюєш сам.
- Якщо даних замало або є проблеми з оновленням даних (dataQuality) — скажи про це першим пунктом і не роби сміливих висновків.
- Згадуй конкурентів лише там, де це дає корисну ідею (частота постів, формати, залученість).
- 4–8 інсайтів, від найважливішого. Пиши українською, коротко, без води.`;

const TOOL = {
  name: "report_insights",
  description: "Повернути підсумок і список інсайтів для маркетингової команди.",
  input_schema: {
    type: "object",
    properties: {
      health: { type: "integer", minimum: 0, maximum: 100, description: "Загальна оцінка стану маркетингу 0–100" },
      summary: { type: "string", description: "2–4 речення: головне за період і що робити в першу чергу" },
      insights: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            severity: { type: "string", enum: ["critical", "warning", "info", "good"] },
            category: { type: "string", enum: ["budget", "performance", "creative", "funnel", "crm", "plan", "social", "competitors", "data"] },
            title: { type: "string", description: "Один рядок: що відбувається" },
            evidence: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
            action: { type: "string", description: "Що конкретно зробити" },
            expectedEffect: { type: "string" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["severity", "category", "title", "evidence", "action", "confidence"],
        },
      },
    },
    required: ["health", "summary", "insights"],
  },
} as const;

type ToolOutput = { health: number; summary: string; insights: AiInsight[] };

async function callClaude(snapshot: unknown) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: TOOL.name },
      messages: [{ role: "user", content: `Дані дашборду ISTO:\n\n${JSON.stringify(snapshot)}` }],
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    content?: { type: string; name?: string; input?: ToolOutput }[];
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${body.error?.message ?? "помилка"}`);
  const out = body.content?.find((c) => c.type === "tool_use" && c.name === TOOL.name)?.input;
  if (!out?.insights) throw new Error("Модель не повернула інсайти");
  return { out, usage: body.usage ?? {} };
}

/** Builds the snapshot, asks Claude, stores the result (or the error). */
export async function generateInsights(trigger: "cron" | "manual", requestedBy?: string) {
  const snapshot = await buildSnapshot();
  const base = { trigger, requestedBy: requestedBy ?? null, model: AI_MODEL, periodFrom: snapshot.period.from, periodTo: snapshot.period.to, snapshot };
  try {
    const { out, usage } = await callClaude(snapshot);
    const [row] = await db
      .insert(aiInsights)
      .values({
        ...base,
        health: Math.max(0, Math.min(100, Math.round(out.health))),
        summary: out.summary,
        insights: out.insights,
        inputTokens: usage.input_tokens ?? null,
        outputTokens: usage.output_tokens ?? null,
      })
      .returning();
    return row;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.insert(aiInsights).values({ ...base, error: message });
    throw e;
  }
}

export async function latestInsights() {
  const [r] = await db.select().from(aiInsights).where(isNull(aiInsights.error)).orderBy(desc(aiInsights.createdAt)).limit(1);
  return r ?? null;
}

export async function insightRuns(limit = 15) {
  return db.select().from(aiInsights).orderBy(desc(aiInsights.createdAt)).limit(limit);
}

/** Manual runs are limited to one per hour so a busy day doesn't pile up API costs. */
export async function recentManualRun() {
  const [r] = await db
    .select({ createdAt: aiInsights.createdAt })
    .from(aiInsights)
    .where(and(isNull(aiInsights.error), gt(aiInsights.createdAt, new Date(Date.now() - MANUAL_COOLDOWN_MINUTES * 60_000))))
    .orderBy(desc(aiInsights.createdAt))
    .limit(1);
  return r ?? null;
}
