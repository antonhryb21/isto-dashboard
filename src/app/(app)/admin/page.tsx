import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { leadSources, syncRuns, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/current-user";
import { listRegions } from "@/lib/regions";
import { ago, fmtDate } from "@/lib/format";
import { SectionTitle } from "@/components/kpi";
import { DeleteTarget, RegionForm, RemoveUser, SendDigestButton, TargetForm, SourceRegion, SourceToggle, SpreadsheetForm, SyncButtons, UserForm } from "@/components/admin-controls";
import { CsvImport } from "@/components/csv-import";
import { CompetitorForm, RemoveCompetitor } from "@/components/competitor-controls";
import { listCompetitors } from "@/lib/competitors";
import { listTargets, monthBounds } from "@/lib/targets";
import { minutesSince } from "@/lib/dates";
import { fmtInt, fmtMoney } from "@/lib/format";
import { explainError, runNotes, runProblems, sheetsEnabled, stepsDone } from "@/lib/sync";

const ROLE: Record<string, string> = { admin: "Адмін", marketing: "Маркетинг", viewer: "Керівництво" };

const ENV = [
  ["DATABASE_URL", "База даних (Neon)"],
  ["AUTH_SECRET", "Секрет сесій"],
  ["CRON_SECRET", "Секрет щоденної синхронізації"],
  ["META_SYSTEM_USER_TOKEN", "Токен Meta"],
  ["META_APP_SECRET", "App Secret Meta"],
  ["META_WEBHOOK_VERIFY_TOKEN", "Токен вебхука лідів"],
  ["LEADS_API_TOKEN", "Токен для Telegram-бота (n8n)"],
  ["GOOGLE_OAUTH_CLIENT_ID", "Вхід через Google"],
  ["ANTHROPIC_API_KEY", "AI-інсайти (необовʼязково)"],
  ["TELEGRAM_BOT_TOKEN", "Telegram-бот для звітів (необовʼязково)"],
  ["TELEGRAM_CHAT_ID", "Чат для звітів (необовʼязково)"],
] as const;

export default async function AdminPage() {
  const me = await requireUser("admin");
  const [people, regions, sources, runs, rivals, plan] = await Promise.all([
    db.select().from(users).orderBy(asc(users.email)),
    listRegions(),
    db.select().from(leadSources).orderBy(asc(leadSources.spreadsheetId), asc(leadSources.sheetName)),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(8),
    listCompetitors(),
    listTargets(),
  ]);
  const regionOpts = regions.map((r) => ({ code: r.code, name: r.name }));
  const webhookUrl = `${process.env.APP_URL ?? ""}/api/webhooks/meta`;
  const botUrl = `${process.env.APP_URL ?? ""}/api/leads/status`;

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <SectionTitle title="Адмін" sub="Доступи, регіони, джерела лідів і стан синхронізації." />

      <section className="card p-5">
        <div className="label">Налаштування</div>
        <div className="mt-3 grid gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-2">
          {ENV.map(([k, l]) => (
            <div key={k} className="flex items-center gap-2">
              <span className={process.env[k] ? "text-good" : "text-bad"}>{process.env[k] ? "●" : "○"}</span>
              <span className="text-muted">{l}</span>
              <code className="text-[11px] text-faint">{k}</code>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[12px] text-faint">
          Вебхук для лідів у Meta (App → Webhooks → Page → leadgen): <code className="text-muted">{webhookUrl}</code>, токен перевірки = значення
          META_WEBHOOK_VERIFY_TOKEN. Потім натисніть «Підписати сторінку на ліди».
        </p>
        <p className="mt-2 text-[12px] text-faint">
          Статуси з Telegram-бота: <code className="text-muted">POST {botUrl}</code>, заголовок{" "}
          <code className="text-muted">Authorization: Bearer LEADS_API_TOKEN</code>, тіло{" "}
          <code className="text-muted">{`{"lead_id":"<id ліда Meta>","status":"Contacted","changed_by":"@нік"}`}</code>.
        </p>
      </section>

      <section className="card p-5">
        <div className="label">Синхронізація</div>
        <div className="mt-3">
          <SyncButtons />
        </div>
        <table className="data mt-4">
          <thead>
            <tr>
              <th>Коли</th>
              <th>Тип</th>
              <th>Результат</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap text-muted">{fmtDate(r.startedAt, true)}</td>
                <td>{{ quick: "швидке", daily: "щоденне", backfill: "історія" }[r.kind] ?? r.kind}</td>
                <td className="max-w-2xl">
                  {r.finishedAt === null ? (
                    <div className="flex flex-col gap-0.5">
                      {minutesSince(r.startedAt) > 6 ? (
                        <span className="text-bad">перервано: не вклалось у ліміт часу Vercel (5 хв)</span>
                      ) : (
                        <span className="text-muted">триває…</span>
                      )}
                      {r.message && <span className="text-[12px] text-faint">готово: {stepsDone(r.message)}</span>}
                    </div>
                  ) : r.ok ? (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-good">успішно</span>
                      {runNotes(r).map((n) => (
                        <span key={n} className="text-[12px] text-muted">
                          {n}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      {runProblems(r).map((p) => (
                        <span key={p.step + p.error} className="text-bad">
                          <span className="font-medium">{p.step}:</span> {p.error}
                        </span>
                      ))}
                      <details>
                        <summary className="cursor-pointer text-[11px] text-faint">технічні подробиці</summary>
                        <pre className="mt-2 whitespace-pre-wrap break-all text-[11px] text-muted">{r.message}</pre>
                      </details>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-5">
        <div className="label">Люди з доступом</div>
        <div className="mt-3">
          <UserForm />
        </div>
        <table className="data mt-4">
          <tbody>
            {people.map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td className="text-muted">{ROLE[u.role]}</td>
                <td className="text-[12px] text-faint">вхід: {ago(u.lastLoginAt)}</td>
                <td className="num">{u.email !== me.email && <RemoveUser email={u.email} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card p-5">
        <div className="label">Регіони</div>
        <p className="mt-1 text-[12px] text-faint">Регіон кампанії визначається за словами в її назві. Новий ринок — додайте регіон і його слова.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {regions.map((r) => (
            <span key={r.code} className="chip">
              {r.name} · {r.currency} · <span className="text-faint">{r.keywords.join(", ")}</span>
            </span>
          ))}
        </div>
        <div className="mt-3">
          <RegionForm />
        </div>
      </section>

      <section className="card p-5">
        <div className="label">Звіти й тривоги в Telegram</div>
        <p className="mt-1 text-[12px] text-faint">
          Щоранку о 09:30 за Києвом бот надсилає: витрати, ліди і CPL за вчора, прогрес плану місяця і тривоги — CPL вище середнього на 50%+,
          кампанії, що 3 дні витрачають без лідів, ліди, які чекають контакту довше {process.env.LEAD_SLA_MINUTES ?? 30} хв, збої оновлення даних.
          Потрібні змінні TELEGRAM_BOT_TOKEN (токен бота від @BotFather) і TELEGRAM_CHAT_ID (ID групи) у Vercel.
        </p>
        <div className="mt-3">
          <SendDigestButton />
        </div>
      </section>

      <section id="plan" className="card p-5">
        <div className="label">План на місяць</div>
        <p className="mt-1 text-[12px] text-faint">
          Ціль по регіону на місяць: бюджет у валюті регіону, ліди (без спаму), якісні ліди, угоди. На Огляді видно прогрес і прогноз на кінець
          місяця. Порожні поля — без цілі.
        </p>
        {plan.length > 0 && (
          <table className="data mt-3">
            <thead>
              <tr>
                <th>Місяць</th>
                <th>Регіон</th>
                <th className="num">Бюджет</th>
                <th className="num">Ліди</th>
                <th className="num">Якісні</th>
                <th className="num">Угоди</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {plan.map((t) => {
                const reg = regions.find((r) => r.code === t.regionCode);
                return (
                  <tr key={t.month + t.regionCode}>
                    <td>{t.month.slice(0, 7)}</td>
                    <td>{reg?.name ?? t.regionCode}</td>
                    <td className="num">{t.budget ? fmtMoney(Number(t.budget), reg?.currency ?? "") : "—"}</td>
                    <td className="num">{t.leads !== null ? fmtInt(t.leads) : "—"}</td>
                    <td className="num">{t.qualified !== null ? fmtInt(t.qualified) : "—"}</td>
                    <td className="num">{t.deals !== null ? fmtInt(t.deals) : "—"}</td>
                    <td>
                      <DeleteTarget month={t.month} region={t.regionCode} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className="mt-3">
          <TargetForm regions={regions.map((r) => ({ code: r.code, name: r.name, currency: r.currency }))} defaultMonth={monthBounds().from.slice(0, 7)} />
        </div>
      </section>

      <section className="card p-5">
        <div className="label">Конкуренти</div>
        <p className="mt-1 text-[12px] text-faint">
          Instagram-акаунти на сторінці «Конкуренти» (мають бути бізнесові або авторські). ID сторінки в Ad Library — число з посилання
          view_all_page_id=…; без нього кнопка «Реклама» відкриває пошук за назвою.
        </p>
        <div className="mt-3 flex flex-col gap-1.5">
          {rivals.map((c) => (
            <div key={c.username} className="flex flex-wrap items-center gap-3 text-[13px]">
              <span className="font-medium">{c.name}</span>
              <span className="text-faint">@{c.username}</span>
              {c.adLibraryPageIds.length > 0 && <span className="text-[12px] text-faint">Ad Library: {c.adLibraryPageIds.join(", ")}</span>}
              {c.lastError && <span className="text-[12px] text-bad">{explainError(c.lastError)}</span>}
              {!c.isOwn && <RemoveCompetitor username={c.username} />}
            </div>
          ))}
        </div>
        <div className="mt-3">
          <CompetitorForm />
        </div>
      </section>

      <section className="card p-5">
        <div className="label">Імпорт історії лідів</div>
        <p className="mt-1 text-[12px] text-faint">
          Google Таблиця → вкладка з лідами → Файл → Завантажити → CSV. Можна обрати кілька файлів одразу. Один лід у кількох вкладках
          обʼєднається; статуси, вже змінені в CRM або ботом, імпорт не перезапише.
        </p>
        <div className="mt-3">
          <CsvImport regions={regionOpts} />
        </div>
      </section>

      {sheetsEnabled() && (
      <section className="card p-5">
        <div className="label">Таблиці з лідами</div>
        <p className="mt-1 text-[12px] text-faint">
          Кожна вкладка — окреме джерело. Вимкніть вкладки, які дублюють ліди. Нову таблицю спершу відкрийте для сервісного акаунта Google (редактор).
        </p>
        <div className="mt-3">
          <SpreadsheetForm regions={regionOpts} />
        </div>
        <table className="data mt-4">
          <thead>
            <tr>
              <th>Вкл.</th>
              <th>Вкладка</th>
              <th>Регіон</th>
              <th>Синхронізовано</th>
              <th>Помилка</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id}>
                <td>
                  <SourceToggle id={s.id} enabled={s.enabled} />
                </td>
                <td>
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${s.spreadsheetId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-accent"
                  >
                    {s.sheetName}
                  </a>
                </td>
                <td>
                  <SourceRegion id={s.id} value={s.regionCode} regions={regionOpts} />
                </td>
                <td className="text-muted">{ago(s.lastSyncedAt)}</td>
                <td className="max-w-80 truncate text-[12px] text-bad" title={s.lastError ?? ""}>
                  {s.lastError ?? ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      )}
    </div>
  );
}
