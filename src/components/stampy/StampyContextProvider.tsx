"use client";

import React, { createContext, useContext, useState } from "react";
import type { StampyContextPayload } from "@/app/stampy/actions";

type StampyContextValue = {
  stampyContext: StampyContextPayload | null;
  setStampyContext: (ctx: StampyContextPayload | null) => void;
};

const StampyContext = createContext<StampyContextValue>({
  stampyContext: null,
  setStampyContext: () => {},
});

export function StampyContextProvider({ children }: { children: React.ReactNode }) {
  const [stampyContext, setStampyContext] = useState<StampyContextPayload | null>(null);

  return (
    <StampyContext.Provider value={{ stampyContext, setStampyContext }}>
      {children}
    </StampyContext.Provider>
  );
}

export function useStampyContext() {
  return useContext(StampyContext);
}
