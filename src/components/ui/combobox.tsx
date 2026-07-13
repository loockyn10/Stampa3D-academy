"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Search } from "lucide-react";

interface Option {
  id: string | number;
  label: string;
}

interface ComboboxProps {
  options: Option[];
  value: string | number | null;
  onChange: (value: string | number) => void;
  placeholder?: string;
  emptyText?: string;
  className?: string;
}

export function Combobox({ options, value, onChange, placeholder = "Seleccionar...", emptyText = "No hay resultados", className = "" }: ComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((o) => String(o.id) === String(value));

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = query === ""
    ? options
    : options.filter((option) =>
        option.label.toLowerCase().includes(query.toLowerCase())
      );

  return (
    <div className={`relative ${className}`} ref={wrapperRef}>
      <button
        type="button"
        className="w-full bg-white text-left text-sm border border-gray-300 rounded-md shadow-sm px-3 py-2 focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500 flex justify-between items-center"
        onClick={() => {
          setIsOpen(!isOpen);
          setQuery("");
        }}
      >
        <span className={selectedOption ? "text-gray-900 truncate block w-full pr-2" : "text-gray-500 truncate block w-full pr-2"}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={16} className="text-gray-400 ml-2 shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute z-10 mt-1 w-full bg-white shadow-lg rounded-md text-base ring-1 ring-black ring-opacity-5 overflow-visible focus:outline-none sm:text-sm">
          <div className="bg-white px-2 py-2 border-b border-gray-100 rounded-t-md">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input
                type="text"
                autoFocus
                className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-orange-500 focus:border-orange-500"
                placeholder="Buscar..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
          
          <ul className="max-h-48 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <li className="text-gray-500 cursor-default select-none relative py-2 pl-3 pr-9 text-sm">
                {emptyText}
              </li>
            ) : (
              filteredOptions.map((option) => (
                <li
                  key={option.id}
                  className={`cursor-pointer select-none relative py-2 pl-3 pr-9 text-sm hover:bg-orange-50 ${
                    String(value) === String(option.id) ? "text-orange-900 font-medium" : "text-gray-900"
                  }`}
                  onClick={() => {
                    onChange(option.id);
                    setIsOpen(false);
                    setQuery("");
                  }}
                >
                  <span className="block truncate">{option.label}</span>
                  {String(value) === String(option.id) && (
                    <span className="absolute inset-y-0 right-0 flex items-center pr-4 text-orange-600">
                      <Check size={16} />
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
