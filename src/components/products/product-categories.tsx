"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Settings2, Tag, Trash2, X } from "lucide-react";
import { CalculatorSelect, type CalculatorSelectOption } from "@/components/ui/calculator-select";
import { useAppFeedback } from "@/components/ui/app-feedback";
import {
  PRODUCT_CATEGORY_FILTER_ALL,
  PRODUCT_CATEGORY_FILTER_NONE,
  PRODUCT_CATEGORY_NAME_MAX_LENGTH,
  findDuplicateProductCategory,
  validateProductCategoryName,
  type ProductCategory,
} from "@/lib/products/categories";
import {
  createProductCategoryAction,
  deleteProductCategoryAction,
  renameProductCategoryAction,
} from "@/app/productos/category-actions";

export interface ProductCategoryCounts {
  total: number;
  uncategorized: number;
  byCategory: Map<string, number>;
}

/** Acciones de categorías compartidas por el selector de filtro, el administrador y el formulario de producto. */
function useProductCategoryActions(
  categories: ProductCategory[],
  handlers: {
    onCreated: (category: ProductCategory) => void;
    onRenamed: (category: ProductCategory) => void;
    onDeleted: (categoryId: string, unassignedProducts: number) => void;
  },
) {
  const { toast, confirmAction, promptForValue } = useAppFeedback();
  const { onCreated, onRenamed, onDeleted } = handlers;

  /** Pide el nombre y crea la categoría. Si ya existe una equivalente (otra capitalización/espacios) devuelve esa, sin duplicar. */
  const createCategory = useCallback(async (): Promise<ProductCategory | null> => {
    const raw = await promptForValue({
      title: "Nueva categoría",
      label: "Nombre de la categoría",
      placeholder: "Ej. Lámparas",
      confirmLabel: "Crear categoría",
    });
    if (raw === null) return null;

    const validation = validateProductCategoryName(raw);
    if (!validation.ok) {
      toast.error(validation.error);
      return null;
    }
    const existing = findDuplicateProductCategory(categories, validation.name);
    if (existing) {
      toast.info(`Ya existe la categoría «${existing.name}».`);
      return existing;
    }

    const result = await createProductCategoryAction(validation.name);
    if (!result.success) {
      toast.error(result.error);
      return null;
    }
    onCreated(result.category);
    toast.success(`Categoría «${result.category.name}» creada.`);
    return result.category;
  }, [categories, onCreated, promptForValue, toast]);

  const renameCategory = useCallback(async (category: ProductCategory) => {
    const raw = await promptForValue({
      title: "Editar categoría",
      label: "Nombre de la categoría",
      initialValue: category.name,
      confirmLabel: "Guardar",
    });
    if (raw === null) return;

    const validation = validateProductCategoryName(raw);
    if (!validation.ok) {
      toast.error(validation.error);
      return;
    }
    if (validation.name === category.name) return;
    if (findDuplicateProductCategory(categories, validation.name, category.id)) {
      toast.error("Ya tenés una categoría con ese nombre.");
      return;
    }

    const result = await renameProductCategoryAction(category.id, validation.name);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    onRenamed(result.category);
    toast.success("Categoría actualizada.");
  }, [categories, onRenamed, promptForValue, toast]);

  const deleteCategory = useCallback(async (category: ProductCategory, productCount: number) => {
    const description = productCount > 0
      ? `Los ${productCount} ${productCount === 1 ? "producto" : "productos"} de «${category.name}» no se eliminan: quedan sin categoría.`
      : `«${category.name}» no tiene productos. Se eliminará solo la categoría.`;
    const confirmed = await confirmAction({
      title: "¿Eliminar categoría?",
      description,
      confirmLabel: "Eliminar categoría",
      destructive: true,
    });
    if (!confirmed) return;

    const result = await deleteProductCategoryAction(category.id);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    onDeleted(result.categoryId, result.unassignedProducts);
    toast.success(`Categoría «${category.name}» eliminada. Tus productos se conservaron.`);
  }, [confirmAction, onDeleted, toast]);

  return { createCategory, renameCategory, deleteCategory };
}

interface CategoryHandlers {
  onCreated: (category: ProductCategory) => void;
  onRenamed: (category: ProductCategory) => void;
  onDeleted: (categoryId: string, unassignedProducts: number) => void;
}

const chipBase = "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stampa-orange/50";
const chipIdle = "border-stampa-border bg-stampa-surface text-gray-300 hover:border-stampa-orange/40 hover:text-fg";
const chipActive = "border-stampa-orange bg-stampa-orange text-white";

/** Selector visual de categorías: Todas | Sin categoría | cada categoría | + Nueva categoría | Administrar. */
export function ProductCategoryBar({
  categories,
  counts,
  filter,
  onFilterChange,
  ...handlers
}: {
  categories: ProductCategory[];
  counts: ProductCategoryCounts;
  filter: string;
  onFilterChange: (filter: string) => void;
} & CategoryHandlers) {
  const [managing, setManaging] = useState(false);
  const { createCategory } = useProductCategoryActions(categories, handlers);

  const addCategory = async () => {
    const category = await createCategory();
    if (category) onFilterChange(category.id);
  };

  const countBadge = (value: number, active: boolean) => (
    <span className={`rounded-full px-1.5 text-[11px] font-bold ${active ? "bg-white/20 text-white" : "bg-fg/10 text-gray-400"}`}>{value}</span>
  );

  return (
    <>
      <nav aria-label="Categorías de productos" className="mb-5 flex items-center gap-2">
        <div className="-mx-4 flex min-w-0 flex-1 gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => onFilterChange(PRODUCT_CATEGORY_FILTER_ALL)}
            aria-pressed={filter === PRODUCT_CATEGORY_FILTER_ALL}
            className={`${chipBase} ${filter === PRODUCT_CATEGORY_FILTER_ALL ? chipActive : chipIdle}`}
          >
            Todas {countBadge(counts.total, filter === PRODUCT_CATEGORY_FILTER_ALL)}
          </button>
          {categories.map((category) => {
            const active = filter === category.id;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => onFilterChange(category.id)}
                aria-pressed={active}
                className={`${chipBase} ${active ? chipActive : chipIdle}`}
              >
                <span className="max-w-[10rem] truncate">{category.name}</span>
                {countBadge(counts.byCategory.get(category.id) ?? 0, active)}
              </button>
            );
          })}
          {(categories.length > 0 || counts.uncategorized > 0) && (
            <button
              type="button"
              onClick={() => onFilterChange(PRODUCT_CATEGORY_FILTER_NONE)}
              aria-pressed={filter === PRODUCT_CATEGORY_FILTER_NONE}
              className={`${chipBase} ${filter === PRODUCT_CATEGORY_FILTER_NONE ? chipActive : chipIdle}`}
            >
              Sin categoría {countBadge(counts.uncategorized, filter === PRODUCT_CATEGORY_FILTER_NONE)}
            </button>
          )}
          <button
            type="button"
            onClick={() => void addCategory()}
            className={`${chipBase} border-dashed border-stampa-orange/50 bg-stampa-orange/5 text-stampa-accent hover:bg-stampa-orange/10`}
          >
            <Plus size={14} aria-hidden="true" /> Nueva categoría
          </button>
        </div>
        {categories.length > 0 && (
          <button
            type="button"
            onClick={() => setManaging(true)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stampa-border bg-stampa-surface text-gray-300 transition-colors hover:border-stampa-orange/40 hover:text-fg"
            aria-label="Administrar categorías"
            title="Administrar categorías"
          >
            <Settings2 size={16} aria-hidden="true" />
          </button>
        )}
      </nav>

      {managing && (
        <ProductCategoryManager
          categories={categories}
          counts={counts}
          onClose={() => setManaging(false)}
          {...handlers}
        />
      )}
    </>
  );
}

/** Diálogo para renombrar y eliminar categorías (la eliminación confirma y conserva los productos). */
function ProductCategoryManager({
  categories,
  counts,
  onClose,
  ...handlers
}: {
  categories: ProductCategory[];
  counts: ProductCategoryCounts;
  onClose: () => void;
} & CategoryHandlers) {
  const { createCategory, renameCategory, deleteCategory } = useProductCategoryActions(categories, handlers);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Con un prompt/confirmación encima, Escape solo cierra ese diálogo.
      if (event.key === "Escape" && document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length <= 1) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stampa-bg/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-categories-title"
        className="flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl border border-stampa-border bg-stampa-surface shadow-2xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-stampa-border p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-stampa-orange/30 bg-stampa-orange/10 text-stampa-accent">
              <Tag size={18} aria-hidden="true" />
            </div>
            <h2 id="manage-categories-title" className="truncate text-lg font-bold text-fg">Categorías</h2>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-fg/5 hover:text-fg" aria-label="Cerrar">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <ul className="min-h-0 flex-1 divide-y divide-stampa-border overflow-y-auto">
          {categories.map((category) => {
            const productCount = counts.byCategory.get(category.id) ?? 0;
            return (
              <li key={category.id} className="flex items-center gap-2 px-4 py-2.5 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-fg">{category.name}</p>
                  <p className="text-xs text-gray-500">{productCount} {productCount === 1 ? "producto" : "productos"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void renameCategory(category)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-stampa-border bg-fg/5 text-gray-300 transition-colors hover:bg-fg/10 hover:text-fg"
                  aria-label={`Editar categoría ${category.name}`}
                  title="Editar nombre"
                >
                  <Pencil size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => void deleteCategory(category, productCount)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-red-500/25 bg-red-500/10 text-red-300 transition-colors hover:border-red-500/40 hover:bg-red-500/20"
                  aria-label={`Eliminar categoría ${category.name}`}
                  title="Eliminar categoría"
                >
                  <Trash2 size={15} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex gap-2 border-t border-stampa-border p-3 sm:justify-between sm:p-5">
          <button type="button" onClick={onClose} className="min-h-11 flex-1 rounded-xl border border-stampa-border px-4 py-2.5 text-sm font-bold text-gray-300 transition-colors hover:bg-fg/5 sm:flex-none">
            Listo
          </button>
          <button type="button" onClick={() => void createCategory()} className="inline-flex min-h-11 flex-[2] items-center justify-center gap-2 rounded-xl border border-stampa-orange bg-stampa-orange px-4 py-2.5 text-sm font-bold text-white sm:flex-none">
            <Plus size={15} aria-hidden="true" /> Nueva categoría
          </button>
        </div>
      </div>
    </div>
  );
}

/** Selector de categoría del formulario de producto, con alta de categoría sin salir del formulario. */
export function ProductCategoryField({
  categories,
  value,
  onChange,
  ...handlers
}: {
  categories: ProductCategory[];
  value: string;
  onChange: (categoryId: string) => void;
} & CategoryHandlers) {
  const { createCategory } = useProductCategoryActions(categories, handlers);

  const options: CalculatorSelectOption[] = [
    { value: "", label: "Sin categoría" },
    ...categories.map((category) => ({ value: category.id, label: category.name })),
  ];

  const addCategory = async () => {
    const category = await createCategory();
    if (category) onChange(category.id);
  };

  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-gray-300">Categoría</label>
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">
          <CalculatorSelect
            options={options}
            value={value}
            onChange={onChange}
            placeholder="Sin categoría"
            searchable={categories.length > 6}
            usePortal
          />
        </div>
        <button
          type="button"
          onClick={() => void addCategory()}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-stampa-orange/50 bg-stampa-orange/5 px-3 text-xs font-bold text-stampa-accent transition-colors hover:bg-stampa-orange/10"
        >
          <Plus size={14} aria-hidden="true" /> Nueva
        </button>
      </div>
      <p className="mt-1 text-[11px] text-gray-500">Máximo {PRODUCT_CATEGORY_NAME_MAX_LENGTH} caracteres. Opcional.</p>
    </div>
  );
}

/** Etiqueta de categoría para la tarjeta del producto. */
export function ProductCategoryBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-stampa-orange/25 bg-stampa-orange/10 px-1.5 py-0.5 text-[10px] font-bold uppercase text-stampa-accent">
      <Tag size={10} aria-hidden="true" className="shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}
