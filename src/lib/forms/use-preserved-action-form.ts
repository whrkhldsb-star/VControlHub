"use client";

import { useCallback, useLayoutEffect, useRef } from "react";

type RestorableControl = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

type FormControlSnapshot = {
  name: string;
  ordinal: number;
  value: string;
  checked?: boolean;
};

function isRestorableControl(element: Element): element is RestorableControl {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  );
}

function captureForm(form: HTMLFormElement): FormControlSnapshot[] {
  const ordinals = new Map<string, number>();
  return Array.from(form.elements).flatMap((element) => {
    if (!isRestorableControl(element) || !element.name || element.name.startsWith("$ACTION_")) {
      return [];
    }
    if (element instanceof HTMLInputElement && ["file", "submit", "button", "reset"].includes(element.type)) {
      return [];
    }
    const ordinal = ordinals.get(element.name) ?? 0;
    ordinals.set(element.name, ordinal + 1);
    return [{
      name: element.name,
      ordinal,
      value: element.value,
      ...((element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type))
        ? { checked: element.checked }
        : {}),
    }];
  });
}

function restoreForm(form: HTMLFormElement, snapshot: FormControlSnapshot[]) {
  const controlsByName = new Map<string, RestorableControl[]>();
  for (const element of Array.from(form.elements)) {
    if (!isRestorableControl(element) || !element.name) continue;
    const controls = controlsByName.get(element.name) ?? [];
    controls.push(element);
    controlsByName.set(element.name, controls);
  }
  for (const field of snapshot) {
    const control = controlsByName.get(field.name)?.[field.ordinal];
    if (!control) continue;
    control.value = field.value;
    if (control instanceof HTMLInputElement && field.checked !== undefined) {
      control.checked = field.checked;
    }
  }
}

/** Preserve browser-only form values when a Server Action returns a retryable result. */
export function usePreservedActionForm(actionState: object | null, shouldRestore: boolean) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const snapshotRef = useRef<FormControlSnapshot[]>([]);

  const captureBeforeSubmit = useCallback((event: React.FormEvent<HTMLFormElement>) => {
    snapshotRef.current = captureForm(event.currentTarget);
  }, []);

  useLayoutEffect(() => {
    if (shouldRestore && formRef.current && snapshotRef.current.length > 0) {
      restoreForm(formRef.current, snapshotRef.current);
    }
    if (!shouldRestore) snapshotRef.current = [];
  }, [actionState, shouldRestore]);

  return { formRef, captureBeforeSubmit };
}
