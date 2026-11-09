import { asc, desc } from "drizzle-orm";
import { db } from "@/db";
import { leadSources, syncRuns, users } from "@/db/schema";
import { requireUser } from "@/lib/auth/current-user";
import { listRegions } from "@/lib/regions";
import { ago, fmtDate } from "@/lib/format";
import { SectionTitle } from "@/components/kpi";
import { RegionForm, RemoveUser, SourceRegion, SourceToggle, SpreadsheetForm, SyncButtons, UserForm } from "@/components/admin-controls";
import { CsvImport } from "@/components/csv-import";
import { sheetsEnabled } from "@/lib/sync";

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
] as const;

export default async function AdminPage() {
  const me = await requireUser("admin");
  const [people, regions, sources, runs] = await Promise.all([
    db.select().from(users).orderBy(asc(users.email)),
    listRegions(),
    db.select().from(leadSources).orderBy(asc(leadSources.spreadsheetId), asc(leadSources.sheetName)),
    db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(8),
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
                <td>{r.kind}</td>
                <td className="max-w-2xl">
                  {r.finishedAt === null ? (
                    <span className="text-muted">триває…</span>
                  ) : r.ok ? (
                    <span className="text-good">успішно</span>
                  ) : (
                    <details>
                      <summary className="cursor-pointer text-bad">з помилками</summary>
                      <pre className="mt-2 whitespace-pre-wrap break-all text-[11px] text-muted">{r.message}</pre>
                    </details>
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
