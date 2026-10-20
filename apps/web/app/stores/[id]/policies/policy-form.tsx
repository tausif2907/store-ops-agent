"use client";

import { useActionState, useState } from "react";
import { ORDER_STATUSES } from "@store-ops/shared";
import type { PolicyFormState } from "@/lib/policy-actions";

export interface ToolRow {
  name: string;
  description: string;
  type: "read" | "draft" | "write";
  modes: ("AUTO" | "ASK" | "NEVER")[];
  mode: "AUTO" | "ASK" | "NEVER";
  limits: Record<string, unknown>;
}

const MODE_LABELS = { AUTO: "Automatic", ASK: "Ask me", NEVER: "Off" } as const;
const TYPE_LABELS = { read: "Look things up", draft: "Write drafts (never sent)", write: "Make changes to the store" } as const;
const TOOL_LABELS: Record<string, string> = {
  search_orders: "Search orders",
  get_order: "Read an order",
  sales_summary: "Sales summaries",
  low_stock_products: "Check stock",
  search_products: "Search products",
  search_reviews: "Read reviews",
  list_coupons: "List coupons",
  draft_customer_message: "Draft customer messages",
  draft_review_reply: "Draft review replies",
  update_order_status: "Change order status",
  create_coupon: "Create coupons",
  update_stock: "Change stock levels",
  reply_to_review: "Reply to reviews",
};

function NumberField(props: { name: string; label: string; value: unknown; min?: number; max?: number; step?: string; suffix?: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="w-48 text-slate-600">{props.label}</span>
      <input
        className="input w-28"
        type="number"
        name={props.name}
        defaultValue={props.value === undefined ? "" : String(props.value)}
        min={props.min ?? 1}
        max={props.max}
        step={props.step ?? "1"}
        placeholder="no limit"
      />
      {props.suffix ? <span className="text-slate-500">{props.suffix}</span> : null}
    </label>
  );
}

function Limits({ row, currency }: { row: ToolRow; currency: string }) {
  const l = row.limits;
  const f = (key: string) => `${row.name}.${key}`;
  const [restrict, setRestrict] = useState(Array.isArray(l.allowedStatuses));
  return (
    <div className="mt-3 space-y-2 rounded-md bg-slate-50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Limits when automatic</p>
      {row.name === "create_coupon" ? (
        <>
          <NumberField name={f("maxPercent")} label="Largest percent discount" value={l.maxPercent} max={100} suffix="%" />
          <NumberField
            name={f("maxFixedAmount")}
            label="Largest fixed discount"
            value={typeof l.maxFixedAmount === "number" ? l.maxFixedAmount / 100 : undefined}
            step="0.01"
            min={0.01}
            suffix={currency}
          />
          <NumberField name={f("maxUsageLimit")} label="Most uses per coupon" value={l.maxUsageLimit} />
        </>
      ) : null}
      {row.name === "update_stock" ? (
        <NumberField name={f("maxChange")} label="Largest change, up or down" value={l.maxChange} suffix="units" />
      ) : null}
      {row.name === "update_order_status" ? (
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" name={f("restrictStatuses")} checked={restrict} onChange={(e) => setRestrict(e.target.checked)} />
            Only allow these statuses automatically
          </label>
          {restrict ? (
            <div className="flex flex-wrap gap-3 pl-6">
              {ORDER_STATUSES.map((s) => (
                <label key={s} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    name={f("allowedStatuses")}
                    value={s}
                    defaultChecked={Array.isArray(l.allowedStatuses) ? (l.allowedStatuses as string[]).includes(s) : s === "ready" || s === "shipped"}
                  />
                  {s}
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <NumberField name={f("maxPerDay")} label="Most automatic runs per day" value={l.maxPerDay} max={1000} />
    </div>
  );
}

export function PolicyForm({ rows, currency, action }: {
  rows: ToolRow[];
  currency: string;
  action: (prev: PolicyFormState, form: FormData) => Promise<PolicyFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [modes, setModes] = useState(() => Object.fromEntries(rows.map((r) => [r.name, r.mode])));

  return (
    <form action={formAction} className="space-y-6">
      {(["write", "draft", "read"] as const).map((type) => (
        <section key={type} className="card space-y-4">
          <h2 className="font-medium">{TYPE_LABELS[type]}</h2>
          <ul className="divide-y divide-slate-100">
            {rows.filter((r) => r.type === type).map((row) => (
              <li key={row.name} className="py-3 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-xl">
                    <p className="text-sm font-medium">{TOOL_LABELS[row.name] ?? row.name}</p>
                    <p className="text-xs text-slate-500">{row.description}</p>
                  </div>
                  <div className="flex overflow-hidden rounded-md border border-slate-300" role="radiogroup" aria-label={TOOL_LABELS[row.name]}>
                    {row.modes.map((m) => (
                      <label
                        key={m}
                        className={`cursor-pointer px-3 py-1.5 text-xs ${
                          modes[row.name] === m ? (m === "NEVER" ? "bg-slate-600 text-white" : "bg-brand text-white") : "bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name={`${row.name}.mode`}
                          value={m}
                          checked={modes[row.name] === m}
                          onChange={() => setModes((all) => ({ ...all, [row.name]: m }))}
                        />
                        {MODE_LABELS[m]}
                      </label>
                    ))}
                  </div>
                </div>
                {row.type === "write" && modes[row.name] === "AUTO" ? <Limits row={row} currency={currency} /> : null}
                {row.type === "write" && modes[row.name] !== "AUTO"
                  ? // Keep saved limits when the mode is not Automatic, so switching back restores them.
                    Object.entries(row.limits).map(([k, v]) =>
                      Array.isArray(v) ? (
                        <span key={k}>
                          <input type="hidden" name={`${row.name}.restrictStatuses`} value="on" />
                          {v.map((s) => <input key={String(s)} type="hidden" name={`${row.name}.${k}`} value={String(s)} />)}
                        </span>
                      ) : (
                        <input key={k} type="hidden" name={`${row.name}.${k}`} value={k === "maxFixedAmount" ? Number(v) / 100 : String(v)} />
                      ),
                    )
                  : null}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <div className="sticky bottom-0 flex items-center gap-3 border-t border-slate-200 bg-slate-50/95 py-3">
        <button className="btn" disabled={pending}>{pending ? "Saving…" : "Save rules"}</button>
        {state.error ? <p className="text-sm text-red-600" role="alert">{state.error}</p> : null}
        {state.saved && !pending ? <p className="text-sm text-emerald-700" role="status">Saved. The agent uses these rules from its next action.</p> : null}
      </div>
    </form>
  );
}
