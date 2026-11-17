"use client";

import React, { useState } from "react";
import { Plus, ReceiptText, Trash2 } from "lucide-react";
import {
  CUSTOM_EXPENSE_LIMITS,
  expensesFromDrafts,
  newCustomExpenseId,
  sumCustomExpenses,
  validateCustomExpense,
  type CustomExpenseDraft,
} from "@/lib/calculator/custom-expenses";
import { formatSupplyMoney } from "@/lib/calculator/supplies";
import { InfoTip } from "@/components/ui/info-tip";

interface CustomExpensesEditorProps {
  expenses: CustomExpenseDraft[];
  onChange: (next: CustomExpenseDraft[]) => void;
  /** "este cálculo" o "este producto". */
  scopeLabel: string;
  compact?: boolean;
}

const fieldClass =
  "h-10 w-full min-w-0 rounded-lg border border-fg/10 bg-fg/[0.06] px-2.5 text-base sm:text-sm text-fg outline-none transition placeholder:text-gray-500 focus:border-[#ff6a00]/60 focus:ring-2 focus:ring-[#ff6a00]/10";

/**
 * Gastos adicionales personalizados (D059): concepto + importe, editables y eliminables. Cada uno aparece
 * como una fila del «Desglose de costos»; su suma es el «otros costos» del motor (sin markup ni contingencias).
 */
export function CustomExpensesEditor({ expenses, onChange, scopeLabel, compact = false }: CustomExpensesEditorProps) {
  const [newName, setNewName] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const total = sumCustomExpenses(expensesFromDrafts(expenses));
  const full = expenses.length >= CUSTOM_EXPENSE_LIMITS.maxItems;

  const update = (id: string, patch: Partial<CustomExpenseDraft>) => {
    onChange(expenses.map((expense) => (expense.id === id ? { ...expense, ...patch } : expense)));
  };

  const add = () => {
    const validation = validateCustomExpense(newName, newAmount);
    if (!validation.ok) {
      setError(validation.errors.name ?? validation.errors.amount ?? "Revisá el gasto.");
      return;
    }
    if (expenses.some((expense) => expense.name.trim().toLocaleLowerCase("es") === validation.value.name.toLocaleLowerCase("es"))) {
      setError("Ya agregaste un gasto con ese nombre: editá su importe.");
      return;
    }
    setError(null);
    onChange([...expenses, { id: newCustomExpenseId(), name: validation.value.name, amount: String(validation.value.amount) }]);
    setNewName("");
    setNewAmount("");
  };

  return (
    <section className={`rounded-2xl border border-stampa-border bg-stampa-surface ${compact ? "p-3 sm:p-4" : "p-4 sm:p-5"}`} aria-labelledby="custom-expenses-title">
      <h3 id="custom-expenses-title" className="flex items-center gap-2 text-sm font-bold text-fg">
        <ReceiptText size={16} className="text-stampa-accent" aria-hidden="true" /> Gastos adicionales
        <InfoTip label="Qué son los gastos adicionales">
          Conceptos propios de {scopeLabel} que no están en tu catálogo (tratamiento especial, diseño, embalaje reforzado…). Se suman al costo real, sin markup.
        </InfoTip>
      </h3>

      {expenses.length > 0 && (
        <ul className="mt-3 space-y-2">
          {expenses.map((expense) => {
            const nameInvalid = !expense.name.trim();
            const amountInvalid = !validateCustomExpense("x", expense.amount).ok;
            return (
              <li key={expense.id} className="grid grid-cols-[minmax(0,1fr)_2.5rem] items-start gap-1.5 rounded-xl border border-stampa-border p-1.5 sm:grid-cols-[minmax(0,1fr)_7rem_2.5rem] sm:border-0 sm:p-0">
                <input
                  type="text"
                  aria-label="Concepto del gasto"
                  value={expense.name}
                  maxLength={CUSTOM_EXPENSE_LIMITS.nameMaxLength}
                  onChange={(event) => update(expense.id, { name: event.target.value })}
                  aria-invalid={nameInvalid}
                  className={`${fieldClass} col-span-2 sm:col-span-1 ${nameInvalid ? "border-red-500/50" : ""}`}
                />
                <div className="relative">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-500" aria-hidden="true">$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label={`Importe de ${expense.name || "el gasto"}`}
                    value={expense.amount}
                    onChange={(event) => update(expense.id, { amount: event.target.value.replace(/[^\d.,]/g, "") })}
                    aria-invalid={amountInvalid}
                    className={`${fieldClass} pl-6 ${amountInvalid ? "border-red-500/50" : ""}`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onChange(expenses.filter((item) => item.id !== expense.id))}
                  aria-label={`Eliminar ${expense.name || "gasto"}`}
                  title="Eliminar gasto"
                  className="flex h-10 w-10 items-center justify-center rounded-lg border border-red-500/20 text-red-400 transition-colors hover:bg-red-500/10"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!full && (
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-1.5 sm:grid-cols-[minmax(0,1fr)_7rem_auto]">
          <input
            type="text"
            aria-label="Concepto del nuevo gasto"
            placeholder="Ej.: Diseño personalizado"
            value={newName}
            maxLength={CUSTOM_EXPENSE_LIMITS.nameMaxLength}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
            className={`${fieldClass} col-span-2 sm:col-span-1`}
          />
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-500" aria-hidden="true">$</span>
            <input
              type="text"
              inputMode="decimal"
              aria-label="Importe del nuevo gasto"
              placeholder="0"
              value={newAmount}
              onChange={(event) => setNewAmount(event.target.value.replace(/[^\d.,]/g, ""))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  add();
                }
              }}
              className={`${fieldClass} pl-6`}
            />
          </div>
          <button
            type="button"
            onClick={add}
            className="inline-flex h-10 items-center justify-center gap-1 rounded-lg border border-stampa-orange/40 px-3 text-xs font-bold text-stampa-accent transition-colors hover:bg-stampa-orange/10"
          >
            <Plus size={14} aria-hidden="true" /> Agregar
          </button>
        </div>
      )}
      {error && <p role="alert" className="mt-1.5 text-[11px] text-red-400">{error}</p>}

      {expenses.length > 0 && (
        <p className="mt-3 flex items-center justify-between border-t border-stampa-border pt-2 text-xs text-gray-400">
          <span>Total de gastos adicionales</span>
          <strong className="text-sm text-fg">{formatSupplyMoney(total)}</strong>
        </p>
      )}
    </section>
  );
}
