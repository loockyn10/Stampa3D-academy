"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { Course, Budget, StockItem, Product } from "@/types";
import {
  COURSES as initialCourses,
  BUDGETS as initialBudgets,
  STOCK_PRODUCTS as initialStockProducts,
  STOCK_FILAMENTS as initialStockFilaments,
  PRODUCTS_SEED as initialProducts,
} from "@/data/mock-data";

interface StateContextProps {
  courses: Course[];
  budgets: Budget[];
  stockProducts: StockItem[];
  stockFilaments: StockItem[];
  products: Product[];
  toggleModuleDone: (courseId: string, moduleTitle: string) => void;
  addBudget: (budget: Omit<Budget, "id">) => void;
  adjustStockProduct: (index: number, delta: number) => void;
  adjustStockFilament: (index: number, delta: number) => void;
  addProduct: (product: Omit<Product, "id">) => void;
}

const StateContext = createContext<StateContextProps | undefined>(undefined);

export function StateProvider({ children }: { children: React.ReactNode }) {
  const [courses, setCourses] = useState<Course[]>(initialCourses);
  const [budgets, setBudgets] = useState<Budget[]>(initialBudgets);
  const [stockProducts, setStockProducts] = useState<StockItem[]>(initialStockProducts);
  const [stockFilaments, setStockFilaments] = useState<StockItem[]>(initialStockFilaments);
  const [products, setProducts] = useState<Product[]>(initialProducts);

  // Load from localStorage on mount (client-side only)
  useEffect(() => {
    if (typeof window !== "undefined") {
      const storedCourses = localStorage.getItem("extruye_courses");
      const storedBudgets = localStorage.getItem("extruye_budgets");
      const storedStockProducts = localStorage.getItem("extruye_stock_products");
      const storedStockFilaments = localStorage.getItem("extruye_stock_filaments");
      const storedProducts = localStorage.getItem("extruye_products");

      if (storedCourses) setCourses(JSON.parse(storedCourses));
      if (storedBudgets) setBudgets(JSON.parse(storedBudgets));
      if (storedStockProducts) setStockProducts(JSON.parse(storedStockProducts));
      if (storedStockFilaments) setStockFilaments(JSON.parse(storedStockFilaments));
      if (storedProducts) setProducts(JSON.parse(storedProducts));
    }
  }, []);

  // Save states to localStorage when they change
  useEffect(() => {
    localStorage.setItem("extruye_courses", JSON.stringify(courses));
  }, [courses]);

  useEffect(() => {
    localStorage.setItem("extruye_budgets", JSON.stringify(budgets));
  }, [budgets]);

  useEffect(() => {
    localStorage.setItem("extruye_stock_products", JSON.stringify(stockProducts));
  }, [stockProducts]);

  useEffect(() => {
    localStorage.setItem("extruye_stock_filaments", JSON.stringify(stockFilaments));
  }, [stockFilaments]);

  useEffect(() => {
    localStorage.setItem("extruye_products", JSON.stringify(products));
  }, [products]);

  const toggleModuleDone = (courseId: string, moduleTitle: string) => {
    setCourses((prevCourses) =>
      prevCourses.map((course) => {
        if (course.id !== courseId) return course;

        const updatedModules = course.modules.map((m) => {
          if (m.title === moduleTitle && !m.locked) {
            return { ...m, done: !m.done };
          }
          return m;
        });

        // Recalculate progress dynamically
        const doneCount = updatedModules.filter((m) => m.done).length;
        const progress = Math.round((doneCount / updatedModules.length) * 100);

        return {
          ...course,
          modules: updatedModules,
          progress,
        };
      })
    );
  };

  const addBudget = (newBudget: Omit<Budget, "id">) => {
    const budgetWithId: Budget = {
      ...newBudget,
      id: `b${budgets.length + 1}`,
    };
    setBudgets((prev) => [budgetWithId, ...prev]);
  };

  const adjustStockProduct = (index: number, delta: number) => {
    setStockProducts((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const newQty = Math.max(0, item.qty + delta);
        // Mark low if qty is less than 5
        const low = newQty <= 5;
        return { ...item, qty: newQty, low };
      })
    );
  };

  const adjustStockFilament = (index: number, delta: number) => {
    setStockFilaments((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const newQty = Math.max(0, +(item.qty + delta).toFixed(2));
        // Mark low if qty is less than 1.0 kg
        const low = newQty <= 1.0;
        return { ...item, qty: newQty, low };
      })
    );
  };

  const addProduct = (newProduct: Omit<Product, "id">) => {
    const productWithId: Product = {
      ...newProduct,
      id: `p${products.length + 1}`,
    };
    setProducts((prev) => [...prev, productWithId]);
  };

  return (
    <StateContext.Provider
      value={{
        courses,
        budgets,
        stockProducts,
        stockFilaments,
        products,
        toggleModuleDone,
        addBudget,
        adjustStockProduct,
        adjustStockFilament,
        addProduct,
      }}
    >
      {children}
    </StateContext.Provider>
  );
}

export function useAppState() {
  const context = useContext(StateContext);
  if (context === undefined) {
    throw new Error("useAppState must be used within a StateProvider");
  }
  return context;
}
