"use client";

import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Search } from "lucide-react";

export interface CalculatorSelectOption {
  value: string;
  label: string;
  element?: React.ReactNode;
}

interface CalculatorSelectProps {
  options: CalculatorSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  emptyMessage?: string;
  className?: string;
  usePortal?: boolean;
}

export function CalculatorSelect({
  options,
  value,
  onChange,
  placeholder = "Seleccionar...",
  searchable = false,
  disabled = false,
  emptyMessage = "No hay resultados",
  className = "",
  usePortal = false,
}: CalculatorSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const selectedOption = options.find((o) => String(o.value) === String(value));

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node) &&
        (!dropdownRef.current || !dropdownRef.current.contains(event.target as Node))
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && usePortal && wrapperRef.current) {
      const updatePosition = () => {
        if (!wrapperRef.current) return;
        const rect = wrapperRef.current.getBoundingClientRect();
        const availableHeight = window.innerHeight - rect.bottom - 16;
        const maxHeight = Math.min(300, Math.max(150, availableHeight));
        
        setDropdownStyle({
          position: "fixed",
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
          zIndex: 9999,
          maxHeight,
        });
      };
      
      updatePosition();
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
      
      return () => {
        window.removeEventListener("resize", updatePosition);
        window.removeEventListener("scroll", updatePosition, true);
      };
    }
  }, [isOpen, usePortal]);

  const filteredOptions = !searchable || query === ""
    ? options
    : options.filter((option) =>
        option.label.toLowerCase().includes(query.toLowerCase())
      );

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      <button
        type="button"
        disabled={disabled}
        aria-expanded={isOpen}
        className="h-11 w-full rounded-xl border border-white/10 bg-white/[0.06] px-4 text-sm text-white outline-none transition hover:bg-white/[0.08] focus:border-[#ff6a00]/60 focus:ring-2 focus:ring-[#ff6a00]/10 disabled:opacity-50 flex justify-between items-center text-left"
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            setQuery("");
          }
        }}
      >
        <span className={selectedOption ? "text-white truncate block w-full pr-2" : "text-neutral-500 truncate block w-full pr-2"}>
          {selectedOption ? (selectedOption.element || selectedOption.label) : placeholder}
        </span>
        <ChevronDown size={16} className="text-gray-400 ml-2 shrink-0" />
        </button>

      {isOpen && (
        usePortal ? createPortal(
          <div
            ref={dropdownRef}
            className="bg-[#111] border border-white/10 rounded-xl shadow-2xl overflow-hidden focus:outline-none flex flex-col"
            style={dropdownStyle}
          >
            {searchable && (
              <div className="px-3 py-2.5 border-b border-white/10 shrink-0">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    autoFocus
                    className="w-full bg-white/[0.04] pl-9 pr-3 py-2 text-xs border border-white/10 rounded-lg text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]/50"
                    placeholder="Buscar..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            )}
            
            <ul className="overflow-y-auto py-1.5 flex-1 min-h-0">
              {filteredOptions.length === 0 ? (
                <li className="text-neutral-500 cursor-default select-none relative py-2.5 px-4 text-xs">
                  {emptyMessage}
                </li>
              ) : (
                filteredOptions.map((option) => {
                  const isSelected = String(value) === String(option.value);
                  return (
                    <li
                      key={option.value}
                      className={`cursor-pointer select-none relative py-2.5 pl-4 pr-10 text-xs transition-colors hover:bg-white/5 ${
                        isSelected ? "text-white font-semibold" : "text-neutral-300"
                      }`}
                      onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                        setQuery("");
                      }}
                    >
                      <span className="block truncate">{option.element || option.label}</span>
                      {isSelected && (
                        <span className="absolute inset-y-0 right-3 flex items-center text-stampa-orange">
                          <Check size={16} />
                        </span>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body
        ) : (
          <div className="absolute z-50 mt-1 w-full bg-[#111] border border-white/10 rounded-xl shadow-2xl overflow-hidden focus:outline-none">
            {searchable && (
              <div className="px-3 py-2.5 border-b border-white/10 shrink-0">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    type="text"
                    autoFocus
                    className="w-full bg-white/[0.04] pl-9 pr-3 py-2 text-xs border border-white/10 rounded-lg text-white placeholder:text-neutral-600 focus:outline-none focus:border-[#ff6a00] focus:ring-1 focus:ring-[#ff6a00]/50"
                    placeholder="Buscar..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            )}
            
            <ul className="max-h-60 overflow-y-auto py-1.5">
              {filteredOptions.length === 0 ? (
                <li className="text-neutral-500 cursor-default select-none relative py-2.5 px-4 text-xs">
                  {emptyMessage}
                </li>
              ) : (
                filteredOptions.map((option) => {
                  const isSelected = String(value) === String(option.value);
                  return (
                    <li
                      key={option.value}
                      className={`cursor-pointer select-none relative py-2.5 pl-4 pr-10 text-xs transition-colors hover:bg-white/5 ${
                        isSelected ? "text-white font-semibold" : "text-neutral-300"
                      }`}
                      onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                        setQuery("");
                      }}
                    >
                      <span className="block truncate">{option.element || option.label}</span>
                      {isSelected && (
                        <span className="absolute inset-y-0 right-3 flex items-center text-stampa-orange">
                          <Check size={16} />
                        </span>
                      )}
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        )
      )}
    </div>
  );
}
