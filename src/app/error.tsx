"use client";

/** Shown instead of a blank page when a server component fails (e.g. database not reachable). */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen grid place-items-center px-4">
      <div className="card w-full max-w-md p-8">
        <div className="text-[15px] font-light tracking-[0.42em]">ISTO</div>
        <h1 className="display mt-4 text-[24px]">Сторінка не завантажилась</h1>
        <p className="mt-2 text-sm text-muted">
          Найчастіше причина в налаштуваннях: немає з&apos;єднання з базою або бракує змінної у Vercel. Подробиці — у Vercel → Logs
          {error.digest ? (
            <>
              , код помилки <code className="text-text">{error.digest}</code>
            </>
          ) : null}
          .
        </p>
        <div className="mt-6 flex gap-2">
          <button className="btn btn-accent" onClick={reset}>
            Спробувати ще раз
          </button>
          <a className="btn" href="/login">
            На сторінку входу
          </a>
        </div>
      </div>
    </main>
  );
}
