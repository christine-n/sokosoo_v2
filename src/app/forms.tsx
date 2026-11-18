"use client";

import { cloneElement, createContext, isValidElement, useContext, useId, useRef, type ReactNode } from "react";

export const FeedbackContext = createContext<{
  error: string; notice: string; fields: Record<string, string>; form: HTMLFormElement | null;
}>({ error: "", notice: "", fields: {}, form: null });

export function Field({ title, children }: { title: string; children: ReactNode }) {
  const { fields, form } = useContext(FeedbackContext);
  const field = useRef<HTMLLabelElement>(null);
  const id = useId();
  const control = isValidElement<{ name?: string; required?: boolean; "aria-invalid"?: boolean; "aria-describedby"?: string }>(children) ? children : null;
  const error = control?.props.name && form === field.current?.closest("form") ? fields[control.props.name] : "";
  const descriptions = [control?.props["aria-describedby"], error ? id : ""].filter(Boolean).join(" ");
  return <label ref={field} className="field"><span>{title}{control?.props.required && !title.includes("required") && <span className="required-note"> (required)</span>}</span>{control ? cloneElement(control, {
    "aria-invalid": error ? true : undefined, "aria-describedby": descriptions || undefined,
  }) : children}{error && <small id={id} className="field-error">{error}</small>}</label>;
}

export function focusFormError(form: HTMLFormElement, fields: Record<string, string>) {
  requestAnimationFrame(() => {
    const first = Object.keys(fields).map(key => form.elements.namedItem(key)).find(element => element instanceof HTMLElement);
    const target = first instanceof HTMLElement ? first
      : (form.closest("dialog") || form.closest("section"))?.querySelector<HTMLElement>('[role="alert"]');
    if (!target) return;
    if (!(first instanceof HTMLElement)) target.tabIndex = -1;
    target.scrollIntoView({ block: "center", behavior: "instant" });
    target.focus({ preventScroll: true });
  });
}
