import type { ReactNode } from "react";

/**
 * One section of an editor's form panel (series recording, collection): a heading over its
 * fields. Sections that follow each other are divided by a hairline.
 */
export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-4 p-5 short:gap-3 [&+&]:border-t [&+&]:border-line">
      <h2 className="font-sans text-[15px] font-[650] tracking-normal">{title}</h2>
      {children}
    </section>
  );
}
