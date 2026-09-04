"use client";

import React, { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { StampyContextPayload } from "@/app/stampy/actions";
import {
  sanitizeStampyScreenContext,
  type StampyScreenContext,
} from "@/lib/stampy/screen-context";

type StampyContextValue = {
  stampyContext: StampyContextPayload | null;
  setStampyContext: (ctx: StampyContextPayload | null) => void;
};

const StampyContext = createContext<StampyContextValue>({
  stampyContext: null,
  setStampyContext: () => {},
});

type StampyScreenContextValue = {
  publishScreenContext: (ownerId: string, context: StampyScreenContext) => void;
  clearScreenContext: (ownerId: string) => void;
  getScreenContextSnapshot: () => StampyScreenContext | null;
};

const StampyScreenContextApi = createContext<StampyScreenContextValue | null>(null);

export function StampyContextProvider({ children }: { children: React.ReactNode }) {
  const [stampyContext, setStampyContext] = useState<StampyContextPayload | null>(null);
  const screenContextRef = useRef<StampyScreenContext | null>(null);
  const screenContextOwnerRef = useRef<string | null>(null);
  const debugSignatureRef = useRef("");

  const publishScreenContext = useCallback((ownerId: string, context: StampyScreenContext) => {
    const sanitized = sanitizeStampyScreenContext(context);
    if (!sanitized) return;
    screenContextOwnerRef.current = ownerId;
    screenContextRef.current = sanitized;

    if (process.env.NODE_ENV !== "production") {
      (window as typeof window & { __STAMPY_SCREEN_CONTEXT__?: StampyScreenContext }).__STAMPY_SCREEN_CONTEXT__ = sanitized;
      const signature = [
        sanitized.page.section,
        sanitized.page.route,
        sanitized.mode,
        sanitized.selectedEntity?.id,
        sanitized.visibleEntities?.length ?? 0,
      ].join(":");
      if (signature !== debugSignatureRef.current) {
        debugSignatureRef.current = signature;
        console.debug("[Stampy Screen Context]", sanitized);
      }
    }
  }, []);

  const clearScreenContext = useCallback((ownerId: string) => {
    if (screenContextOwnerRef.current !== ownerId) return;
    screenContextOwnerRef.current = null;
    screenContextRef.current = null;
    debugSignatureRef.current = "";
    if (process.env.NODE_ENV !== "production") {
      delete (window as typeof window & { __STAMPY_SCREEN_CONTEXT__?: StampyScreenContext }).__STAMPY_SCREEN_CONTEXT__;
    }
  }, []);

  const getScreenContextSnapshot = useCallback(() => screenContextRef.current, []);
  const screenContextApi = useMemo(() => ({
    publishScreenContext,
    clearScreenContext,
    getScreenContextSnapshot,
  }), [publishScreenContext, clearScreenContext, getScreenContextSnapshot]);

  return (
    <StampyScreenContextApi.Provider value={screenContextApi}>
      <StampyContext.Provider value={{ stampyContext, setStampyContext }}>
        {children}
      </StampyContext.Provider>
    </StampyScreenContextApi.Provider>
  );
}

export function useStampyContext() {
  return useContext(StampyContext);
}

export function useStampyScreenContext() {
  const context = useContext(StampyScreenContextApi);
  if (!context) throw new Error("useStampyScreenContext must be used within StampyContextProvider");
  return context;
}

export function usePublishStampyScreenContext(context: StampyScreenContext) {
  const ownerId = useId();
  const { publishScreenContext, clearScreenContext } = useStampyScreenContext();

  useEffect(() => {
    publishScreenContext(ownerId, context);
  }, [context, ownerId, publishScreenContext]);

  useEffect(() => () => {
    clearScreenContext(ownerId);
  }, [clearScreenContext, ownerId]);
}
