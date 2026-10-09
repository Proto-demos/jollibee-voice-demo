"use client";

import { useState } from "react";
import { CATEGORIES, COMBOS, MENU_ITEMS } from "@/lib/menu";
import { useCart } from "@/lib/cart";
import { MenuThumb } from "./MenuThumb";

interface Row {
  id: string;
  name: string;
  price: number;
  image: string;
}

/**
 * Reference-only menu rail: one scrollable list grouped by category, items in
 * the current order highlighted with their qty, running total pinned below.
 * Nothing here is tappable — ordering happens entirely through Joy.
 */
export function MenuDrawer() {
  const { findLineByRef } = useCart();
  // Mobile only: the drawer is a bottom sheet, collapsed to a handle by default.
  const [sheetOpen, setSheetOpen] = useState(false);

  const groups: Array<{ label: string; rows: Row[] }> = CATEGORIES.map((cat) => ({
    label: cat.labelTl,
    rows:
      cat.id === "combos"
        ? COMBOS.map((c) => ({ id: c.id, name: c.name, price: c.price, image: c.image }))
        : MENU_ITEMS.filter((i) => i.category === cat.id).map((i) => ({
            id: i.id,
            name: i.name,
            price: i.price,
            image: i.image,
          })),
  })).filter((g) => g.rows.length > 0);

  return (
    <>
      {/* mobile scrim behind the opened sheet */}
      {sheetOpen && (
        <button
          aria-label="Isara ang menu"
          onClick={() => setSheetOpen(false)}
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
        />
      )}

      <aside
        className={`bg-background text-foreground flex flex-col min-h-0
          fixed inset-x-0 bottom-0 z-40 h-[78vh] rounded-t-3xl shadow-[0_-16px_50px_-20px_rgba(0,0,0,0.45)]
          transition-transform duration-300 ease-out
          ${sheetOpen ? "translate-y-0" : "translate-y-[calc(100%-84px)]"}
          lg:static lg:z-auto lg:h-auto lg:translate-y-0 lg:rounded-none lg:shadow-none lg:border-l lg:border-[#EDE7DD]`}
      >
        {/* drag handle — mobile only */}
        <button
          onClick={() => setSheetOpen((v) => !v)}
          aria-expanded={sheetOpen}
          aria-label={sheetOpen ? "Isara ang menu" : "Buksan ang menu"}
          className="lg:hidden pt-2.5 pb-1 flex flex-col items-center gap-1.5 shrink-0"
        >
          <span className="w-11 h-1.5 rounded-full bg-neutral-300" />
          <span className="text-[11px] font-semibold text-neutral-500">
            {sheetOpen ? "Menu — i-tap para isara" : "Menu"}
          </span>
        </button>

      <div className="px-4 pt-1.5 lg:pt-3.5 pb-2 hidden lg:flex items-baseline justify-between shrink-0">
        <h2 className="font-bold text-[13.5px]">Menu</h2>
        <span className="text-[10.5px] text-neutral-400">sabihin lang ang pangalan</span>
      </div>

      <div className="menu-scroll flex-1 overflow-y-auto px-2.5 pb-2 min-h-0">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="text-[9.5px] font-semibold uppercase tracking-widest text-neutral-400 px-1.5 pt-2.5 pb-1 sticky top-0 bg-background">
              {group.label}
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-3">
            {group.rows.map((row) => {
              const line = findLineByRef(row.id);
              return (
                <div
                  key={row.id}
                  className={`flex items-center gap-2.5 px-1.5 py-1.5 rounded-xl ${
                    line ? "bg-[#FBEAE8] outline outline-[1.5px] outline-jb-red" : ""
                  }`}
                >
                  <MenuThumb
                    src={row.image}
                    alt={row.name}
                    category="combos"
                    className="w-11 h-9 rounded-lg shrink-0"
                  />
                  <span className="flex-1 min-w-0 font-semibold text-[11.5px] leading-tight">
                    {row.name}
                  </span>
                  {line && (
                    <span className="w-[18px] h-[18px] rounded-full bg-jb-red text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
                      {line.qty}
                    </span>
                  )}
                  <span className="font-bold text-xs shrink-0">₱{row.price}</span>
                </div>
              );
            })}
            </div>
          </div>
        ))}
      </div>
      </aside>
    </>
  );
}
