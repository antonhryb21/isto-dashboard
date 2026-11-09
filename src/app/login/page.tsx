import { IstoLogo } from "@/components/logo";

const ERRORS: Record<string, string> = {
  not_allowed: "Цей Google-акаунт не має доступу. Попросіть адміністратора додати вас.",
  state: "Сесія входу застаріла. Спробуйте ще раз.",
  token: "Google не підтвердив вхід. Спробуйте ще раз.",
  profile: "Не вдалося отримати email з Google-акаунта.",
  secret: "AUTH_SECRET у Vercel не задано або він коротший за 32 символи. Виправте змінну і зробіть Redeploy.",
  db: "Немає з'єднання з базою даних. Перевірте, що Neon підключено до проєкту (DATABASE_URL), і зробіть Redeploy.",
  db_tables: "У базі ще немає таблиць: міграції не виконались під час збірки. Зробіть Redeploy і перевірте лог збірки.",
  server: "Помилка сервера під час входу. Подробиці — у Vercel → Logs.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="card w-full max-w-sm p-8">
        <IstoLogo width={128} className="text-text" />
        <h1 className="display mt-5 text-[28px]">
          Marketing <em>dashboard</em>
        </h1>
        <p className="mt-2 text-sm text-muted">Реклама, соцмережі та ліди в одному місці.</p>
        {error && <p className="mt-5 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{ERRORS[error] ?? "Помилка входу."}</p>}
        <a href="/api/auth/login" className="btn btn-accent mt-6 w-full justify-center py-2.5">
          Увійти через Google
        </a>
      </div>
    </main>
  );
}
