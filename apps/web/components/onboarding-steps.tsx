const STEPS = ["Create your account", "Connect your store", "Read your first digest"];

/** Where the owner is in getting started: steps before `current` are done, and all of them once `complete`. */
export function OnboardingSteps({ current, complete = false }: { current: 1 | 2 | 3; complete?: boolean }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm" aria-label="Getting started">
      {STEPS.map((label, i) => {
        const step = i + 1;
        const done = step < current || complete;
        const active = step === current && !complete;
        return (
          <li key={label} className="flex items-center gap-2" aria-current={active ? "step" : undefined}>
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                done ? "bg-emerald-500 text-white" : active ? "bg-brand text-white" : "bg-slate-200 text-slate-500"
              }`}
            >
              {done ? "✓" : step}
            </span>
            <span className={active ? "font-medium text-slate-900" : "text-slate-500"}>{label}</span>
            {step < STEPS.length ? <span className="ml-1 hidden h-px w-8 bg-slate-300 sm:block" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}
