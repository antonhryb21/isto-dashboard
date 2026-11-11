/** Shown while a section loads its data, so a click in the menu responds at once. */
export default function Loading() {
  const block = "animate-pulse rounded-md bg-panel-2";
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Завантаження">
      <div>
        <div className={`${block} h-9 w-56`} />
        <div className={`${block} mt-3 h-4 w-96 max-w-full`} />
      </div>
      <div className={`${block} h-9 w-full max-w-3xl`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="card p-5">
            <div className={`${block} h-3 w-24`} />
            <div className={`${block} mt-4 h-8 w-32`} />
            <div className={`${block} mt-4 h-3 w-20`} />
          </div>
        ))}
      </div>
      <div className="card p-5">
        <div className={`${block} h-3 w-40`} />
        <div className={`${block} mt-4 h-64 w-full`} />
      </div>
    </div>
  );
}
