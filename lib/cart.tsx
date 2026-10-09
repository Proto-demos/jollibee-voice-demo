"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import {
  CHOICE_KINDS,
  CHOICE_PREFIX,
  CUSTOMISABLE_CATEGORIES,
  MEAL_DRINK_OF,
  choiceKindOf,
  choicesOf,
  findAddon,
  findCombo,
  findMenuItem,
  findProduct,
  isPerItemAddon,
  type ChoiceKind,
} from "./menu";

export type DiscountType = "none" | "senior" | "pwd" | "promo10";
export type PaymentMethod = "cash" | "card" | "qr" | null;
export type OrderStage = "ordering" | "checkout" | "confirmed";

export interface CartLine {
  lineId: string;
  kind: "item" | "combo" | "addon";
  refId: string;
  name: string;
  /** Per-item price, including any per-item add-ons. */
  unitPrice: number;
  qty: number;
  /** Per-item add-ons and picked drinks applied to every item on this line (sorted). */
  modifiers: string[];
}

/** Same item + same add-ons = same line; a different set of add-ons is its own line. */
function lineIdFor(kind: CartLine["kind"], refId: string, modifiers: string[]): string {
  return [`${kind}-${refId}`, ...modifiers].join("+");
}

/** Combos and meals take per-item add-ons (drink upsize); solo items, sides and drinks don't. */
function isCustomisableLine(line: CartLine): boolean {
  if (line.kind === "combo") return true;
  if (line.kind !== "item") return false;
  const category = findMenuItem(line.refId)?.category;
  return category !== undefined && CUSTOMISABLE_CATEGORIES.includes(category);
}

/** How a line's add-ons read: "Sprite, Upsized drink", or "2× Coke" for a pick repeated. */
export function modifierLabel(line: Pick<CartLine, "modifiers"> & { refId?: string }): string {
  const counts = new Map<string, number>();
  for (const id of line.modifiers) counts.set(id, (counts.get(id) ?? 0) + 1);
  const name = (id: string) => findAddon(id)?.shortName ?? findAddon(id)?.name ?? id;
  // The picked drink first, then paid add-ons: "Coke, Upsized drink".
  const isPick = (id: string) => (choiceKindOf(id) ? 0 : 1);
  return [...counts]
    .sort(([a], [b]) => isPick(a) - isPick(b))
    .map(([id, n]) => `${n > 1 ? `${n}× ` : ""}${name(id)}`).join(", ");
}

/** What is still to pick for ONE item or combo on this line: e.g. { drinks: 1 }. */
export function choicesToPick(line: Pick<CartLine, "kind" | "refId" | "modifiers">): Partial<Record<ChoiceKind, number>> {
  if (line.kind === "addon") return {};
  const want = findProduct(line.refId)?.choose ?? {};
  const out: Partial<Record<ChoiceKind, number>> = {};
  for (const kind of CHOICE_KINDS) {
    const missing = (want[kind] ?? 0) - line.modifiers.filter((id) => id.startsWith(CHOICE_PREFIX[kind])).length;
    if (missing > 0) out[kind] = missing;
  }
  return out;
}

interface CartState {
  lines: CartLine[];
  discount: DiscountType;
  /** Whether the customer has explicitly answered the discount question (distinguishes "no discount" from "not asked yet"). */
  discountDecided: boolean;
  paymentMethod: PaymentMethod;
  stage: OrderStage;
  orderNumber: string | null;
}

export type CartAction =
  | { type: "ADD_LINE"; kind: CartLine["kind"]; refId: string; qty: number }
  | { type: "APPLY_MODIFIER"; addonId: string; targetRef: string; qty: number; lineId?: string }
  | {
      type: "UPGRADE_TO_COMBO";
      lineId: string;
      comboId: string;
      qty: number;
      absorb?: Array<{ lineId: string; qty: number }>;
      /** The combo's drink, when a drink ordered on its own was taken into it. */
      drinks?: string[];
    }
  | { type: "REMOVE_MODIFIER"; lineId: string; addonId: string; qty: number }
  | { type: "SET_CHOICES"; lineId: string; qty: number; kind: ChoiceKind; choices: string[] }
  | { type: "BATCH"; actions: CartAction[] }
  | { type: "REMOVE_LINE"; lineId: string }
  | { type: "UPDATE_QTY"; lineId: string; qty: number }
  | { type: "CLEAR_CART" }
  | { type: "SET_DISCOUNT"; discount: DiscountType }
  | { type: "SET_PAYMENT_METHOD"; method: PaymentMethod }
  | { type: "SET_STAGE"; stage: OrderStage }
  | { type: "CONFIRM_ORDER"; orderNumber: string };

export const initialState: CartState = {
  lines: [],
  discount: "none",
  discountDecided: false,
  paymentMethod: null,
  stage: "ordering",
  orderNumber: null,
};

function resolveLine(kind: CartLine["kind"], refId: string) {
  if (kind === "item") {
    const item = findMenuItem(refId);
    if (!item) return null;
    return { name: item.name, unitPrice: item.price };
  }
  if (kind === "combo") {
    const combo = findCombo(refId);
    if (!combo) return null;
    return { name: combo.name, unitPrice: combo.price };
  }
  const addon = findAddon(refId);
  if (!addon) return null;
  return { name: addon.name, unitPrice: addon.price };
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD_LINE": {
      const resolved = resolveLine(action.kind, action.refId);
      if (!resolved) return state;

      const existing = state.lines.find(
        (line) => line.kind === action.kind && line.refId === action.refId && line.modifiers.length === 0
      );
      if (existing) {
        return {
          ...state,
          lines: state.lines.map((line) =>
            line.lineId === existing.lineId
              ? { ...line, qty: line.qty + action.qty }
              : line
          ),
        };
      }

      const newLine: CartLine = {
        lineId: lineIdFor(action.kind, action.refId, []),
        kind: action.kind,
        refId: action.refId,
        name: resolved.name,
        unitPrice: resolved.unitPrice,
        qty: action.qty,
        modifiers: [],
      };
      return { ...state, lines: [...state.lines, newLine] };
    }
    case "APPLY_MODIFIER": {
      // Move `qty` combos onto a line that has the add-on, splitting lines as
      // needed: 3 combos + upsize x2 -> 1x combo and 2x combo (Upsized drink).
      const addon = findAddon(action.addonId);
      if (!addon) return state;
      let lines = [...state.lines];
      let remaining = action.qty;
      for (const source of state.lines) {
        if (remaining <= 0) break;
        if (source.refId !== action.targetRef || source.kind === "addon" || source.modifiers.includes(addon.id)) continue;
        if (action.lineId && source.lineId !== action.lineId) continue;
        const moved = Math.min(remaining, source.qty);
        remaining -= moved;
        const modifiers = [...source.modifiers, addon.id].sort();
        const targetId = lineIdFor(source.kind, source.refId, modifiers);
        const at = lines.findIndex((l) => l.lineId === source.lineId);
        lines = lines.map((l) => (l.lineId === source.lineId ? { ...l, qty: l.qty - moved } : l));
        if (lines.some((l) => l.lineId === targetId)) {
          lines = lines.map((l) => (l.lineId === targetId ? { ...l, qty: l.qty + moved } : l));
        } else {
          lines.splice(at + 1, 0, {
            ...source,
            lineId: targetId,
            unitPrice: source.unitPrice + addon.price,
            qty: moved,
            modifiers,
          });
        }
        lines = lines.filter((l) => l.qty > 0);
      }
      return { ...state, lines };
    }
    case "UPGRADE_TO_COMBO": {
      // Turn `qty` of an ordered item into its combo ("gawin na nating
      // combo"), keeping any add-ons: a 1-pc Chickenjoy Solo becomes a
      // 1-pc Chickenjoy Combo.
      const source = state.lines.find((l) => l.lineId === action.lineId);
      const combo = findCombo(action.comboId);
      if (!source || !combo) return state;
      const moved = Math.min(action.qty, source.qty);
      const extras = source.modifiers.reduce((sum, id) => sum + (findAddon(id)?.price ?? 0), 0);
      const modifiers = [...source.modifiers, ...(action.drinks ?? [])].sort();
      const targetId = lineIdFor("combo", combo.id, modifiers);
      const at = state.lines.findIndex((l) => l.lineId === source.lineId);
      let lines = state.lines.map((l) => (l.lineId === source.lineId ? { ...l, qty: l.qty - moved } : l));
      if (lines.some((l) => l.lineId === targetId)) {
        lines = lines.map((l) => (l.lineId === targetId ? { ...l, qty: l.qty + moved } : l));
      } else {
        lines.splice(at + 1, 0, {
          lineId: targetId,
          kind: "combo",
          refId: combo.id,
          name: combo.name,
          unitPrice: combo.price + extras,
          qty: moved,
          modifiers,
        });
      }
      // The combo's fries or drink, ordered separately before, are now part of it.
      for (const { lineId, qty } of action.absorb ?? []) {
        lines = lines.map((l) => (l.lineId === lineId ? { ...l, qty: l.qty - qty } : l));
      }
      return { ...state, lines: lines.filter((l) => l.qty > 0) };
    }
    case "SET_CHOICES": {
      // Move `qty` combos of one line onto the line with exactly these picks
      // (replacing any made before): 2 combos, one Coke and one Sprite, end
      // up as 1× combo (Coke) and 1× combo (Sprite).
      const source = state.lines.find((l) => l.lineId === action.lineId);
      if (!source) return state;
      const moved = Math.min(action.qty, source.qty);
      const prefix = CHOICE_PREFIX[action.kind];
      const modifiers = [...source.modifiers.filter((id) => !id.startsWith(prefix)), ...action.choices].sort();
      const targetId = lineIdFor(source.kind, source.refId, modifiers);
      if (targetId === source.lineId) return state;
      const at = state.lines.findIndex((l) => l.lineId === source.lineId);
      let lines = state.lines.map((l) => (l.lineId === source.lineId ? { ...l, qty: l.qty - moved } : l));
      if (lines.some((l) => l.lineId === targetId)) {
        lines = lines.map((l) => (l.lineId === targetId ? { ...l, qty: l.qty + moved } : l));
      } else {
        lines.splice(at + 1, 0, { ...source, lineId: targetId, qty: moved, modifiers });
      }
      return { ...state, lines: lines.filter((l) => l.qty > 0) };
    }
    case "REMOVE_MODIFIER": {
      // Take an add-on off `qty` items of one line (the reverse of APPLY_MODIFIER).
      const addon = findAddon(action.addonId);
      const source = state.lines.find((l) => l.lineId === action.lineId);
      if (!addon || !source || !source.modifiers.includes(addon.id)) return state;
      const moved = Math.min(action.qty, source.qty);
      const modifiers = source.modifiers.filter((id) => id !== addon.id);
      const targetId = lineIdFor(source.kind, source.refId, modifiers);
      const at = state.lines.findIndex((l) => l.lineId === source.lineId);
      let lines = state.lines.map((l) => (l.lineId === source.lineId ? { ...l, qty: l.qty - moved } : l));
      if (lines.some((l) => l.lineId === targetId)) {
        lines = lines.map((l) => (l.lineId === targetId ? { ...l, qty: l.qty + moved } : l));
      } else {
        lines.splice(at + 1, 0, { ...source, lineId: targetId, unitPrice: source.unitPrice - addon.price, qty: moved, modifiers });
      }
      return { ...state, lines: lines.filter((l) => l.qty > 0) };
    }
    case "BATCH":
      return action.actions.reduce(cartReducer, state);
    case "REMOVE_LINE":
      return { ...state, lines: state.lines.filter((l) => l.lineId !== action.lineId) };
    case "UPDATE_QTY": {
      if (action.qty <= 0) {
        return { ...state, lines: state.lines.filter((l) => l.lineId !== action.lineId) };
      }
      return {
        ...state,
        lines: state.lines.map((l) =>
          l.lineId === action.lineId ? { ...l, qty: action.qty } : l
        ),
      };
    }
    case "CLEAR_CART":
      return { ...initialState };
    case "SET_DISCOUNT":
      return { ...state, discount: action.discount, discountDecided: true };
    case "SET_PAYMENT_METHOD":
      return { ...state, paymentMethod: action.method };
    case "SET_STAGE":
      return { ...state, stage: action.stage };
    case "CONFIRM_ORDER":
      return { ...state, stage: "confirmed", orderNumber: action.orderNumber };
    default:
      return state;
  }
}

export const DISCOUNT_RATES: Record<DiscountType, number> = {
  none: 0,
  senior: 0.2,
  pwd: 0.2,
  promo10: 0.1,
};

export const DISCOUNT_LABELS: Record<DiscountType, string> = {
  none: "Walang discount",
  senior: "Senior Citizen (20%)",
  pwd: "PWD (20%)",
  promo10: "Promo code (10%)",
};

export function computeTotals(state: Pick<CartState, "lines" | "discount">) {
  const subtotal = state.lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0);
  const discountRate = DISCOUNT_RATES[state.discount];
  // Keep centavos: 10% of ₱129 is ₱12.90, not ₱13.
  const discountAmount = Math.round(subtotal * discountRate * 100) / 100;
  const total = Math.round((subtotal - discountAmount) * 100) / 100;
  return { subtotal, discountAmount, total };
}

/** ₱179 for whole pesos, ₱161.10 when there are centavos. */
export function formatPeso(amount: number): string {
  const digits = Number.isInteger(amount) ? 0 : 2;
  return `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/**
 * Works out where a per-item add-on (the drink upsize) goes, without
 * touching the order: the APPLY_MODIFIER action to dispatch, or an error —
 * including "choices" when the combo's copies differ (e.g. one with Coke, one
 * with Sprite) and only some get it, so the customer picks instead of us
 * guessing. Pure, so scripts can use it.
 */
export function planAddon(
  lines: CartLine[],
  addonId: string,
  qty: number,
  forRef?: string,
  forLineId?: string
):
  | { action: CartAction; applied: number; itemName: string; itemRef: string }
  | { error: string; choices?: Array<{ line_id: string; items: string }> } {
  const addon = findAddon(addonId);
  if (!addon || !isPerItemAddon(addon)) return { error: `Not a per-item add-on: ${addonId}` };
  const items = lines.filter(isCustomisableLine);
  const describe = (l: CartLine) => `${l.qty}× ${l.name}${l.modifiers.length ? ` (${modifierLabel(l)})` : ""}`;
  const label = (l: CartLine) => (l.modifiers.length ? `${l.name} (${modifierLabel(l)})` : l.name);

  // Exact items, chosen by line.
  if (forLineId) {
    const line = lines.find((l) => l.lineId === forLineId);
    if (!line || !isCustomisableLine(line)) return { error: `No combo or meal line: ${forLineId}` };
    if (line.modifiers.includes(addon.id)) return { error: `${describe(line)} already has ${addon.name}.` };
    const applied = Math.min(Math.max(1, qty), line.qty);
    return {
      action: { type: "APPLY_MODIFIER", addonId: addon.id, targetRef: line.refId, qty: applied, lineId: line.lineId },
      applied,
      itemName: label(line),
      itemRef: line.refId,
    };
  }

  let target = forRef;
  if (target && !items.some((l) => l.refId === target)) {
    // e.g. upsize "for the Chickenjoy" when the Chickenjoy is inside a 1-pc Chickenjoy Combo.
    const combo = items.find(
      (l) => l.kind === "combo" && (findCombo(l.refId)?.itemIds.includes(target!) || findCombo(l.refId)?.upgradeFrom?.includes(target!))
    );
    if (combo) target = combo.refId;
  }
  if (!target) {
    const refs = [...new Set(items.map((l) => l.refId))];
    if (refs.length !== 1) {
      return { error: `Which combo is the ${addon.name} for? Pass for_item_id, one of: ${refs.join(", ") || "(no combos or meals in the order)"}` };
    }
    target = refs[0];
  }
  const product = findProduct(target);
  if (product && !product.addonIds?.includes(addon.id)) {
    return { error: `${product.name} doesn't take ${addon.name} – only combos and meals come with a drink to upsize.` };
  }
  const candidates = items.filter((l) => l.refId === target && !l.modifiers.includes(addon.id));
  const available = candidates.reduce((n, l) => n + l.qty, 0);
  if (available === 0) return { error: `No ${target} in the order without ${addon.name} yet.` };
  const applied = Math.min(Math.max(1, qty), available);
  if (candidates.length > 1 && applied < available) {
    return {
      error: `The ${candidates[0].name} copies differ — ask the customer which ones get the ${addon.name}, then call add_addon again with for_line_id.`,
      choices: candidates.map((l) => ({ line_id: l.lineId, items: describe(l) })),
    };
  }
  return {
    action: { type: "APPLY_MODIFIER", addonId: addon.id, targetRef: target, qty: applied },
    applied,
    itemName: candidates.length === 1 ? label(candidates[0]) : candidates[0].name,
    itemRef: target,
  };
}

/**
 * Works out an upgrade of an ordered item into its combo: which line, how
 * many — or "choices" when that item's copies differ and only some are
 * upgraded. Fries and a drink ordered on their own become part of the combo
 * (the drink becomes its pick), so nothing is paid for twice. Pure, like planAddon.
 */
export function planUpgrade(
  lines: CartLine[],
  comboId: string,
  qty: number,
  forRef?: string,
  forLineId?: string
):
  | { action: CartAction; upgraded: number; from: string; absorbed: string[]; drinkPicked?: string }
  | { error: string; choices?: Array<{ line_id: string; items: string }> } {
  const combo = findCombo(comboId);
  if (!combo) return { error: `Unknown combo_id: ${comboId}` };
  const label = (l: CartLine) => `${l.qty}× ${l.name}${l.modifiers.length ? ` (${modifierLabel(l)})` : ""}`;
  // Only the main item becomes the combo — fries or a Coke on their own don't.
  const mains = [combo.itemIds[0], ...(combo.upgradeFrom ?? [])];
  const isMain = (l: CartLine) => l.kind === "item" && mains.includes(l.refId);

  let candidates: CartLine[];
  if (forLineId) {
    const line = lines.find((l) => l.lineId === forLineId);
    if (!line || !isMain(line)) return { error: `${forLineId} can't be made into ${combo.name}.` };
    candidates = [line];
  } else {
    candidates = lines.filter((l) => isMain(l) && (!forRef || l.refId === forRef));
    if (!candidates.length) {
      return { error: `Nothing in the order can become ${combo.name} – use add_combo to add it as a new combo.` };
    }
    const refs = new Set(candidates.map((l) => l.refId));
    if (refs.size > 1) {
      return { error: `Which item becomes the ${combo.name}? Pass item_id, one of: ${[...refs].join(", ")}` };
    }
  }
  const available = candidates.reduce((n, l) => n + l.qty, 0);
  const wanted = Math.min(Math.max(1, qty), available);
  if (candidates.length > 1 && wanted < available) {
    return {
      error: `The ${candidates[0].name} copies differ – ask the customer which one becomes the combo, then call upgrade_to_combo again with line_id.`,
      choices: candidates.map((l) => ({ line_id: l.lineId, items: label(l) })),
    };
  }
  const line = candidates[0];
  const upgraded = Math.min(wanted, line.qty);
  // The combo's other items, if already ordered on their own (plain lines),
  // become part of it rather than being paid for twice. Its drink slot takes
  // any drink that is also a combo drink (a Coke Regular becomes its Coke).
  const absorb: Array<{ lineId: string; qty: number }> = [];
  const absorbed: string[] = [];
  let drinks: string[] | undefined;
  let drinkPicked: string | undefined;
  for (const id of combo.itemIds.slice(1)) {
    const isDrinkSlot = findMenuItem(id)?.category === "beverages";
    const other = lines.find(
      (l) =>
        l.kind === "item" &&
        l.modifiers.length === 0 &&
        (isDrinkSlot ? l.refId in MEAL_DRINK_OF : l.refId === id) &&
        !absorb.some((a) => a.lineId === l.lineId)
    );
    if (!other) continue;
    const n = Math.min(upgraded, other.qty);
    absorb.push({ lineId: other.lineId, qty: n });
    absorbed.push(`${n}× ${other.name}`);
    if (isDrinkSlot && n === upgraded) {
      drinks = [MEAL_DRINK_OF[other.refId]];
      drinkPicked = findAddon(drinks[0])?.shortName;
    }
  }
  return {
    action: { type: "UPGRADE_TO_COMBO", lineId: line.lineId, comboId: combo.id, qty: upgraded, absorb, drinks },
    upgraded,
    from: line.modifiers.length ? `${line.name} (${modifierLabel(line)})` : line.name,
    absorbed,
    drinkPicked,
  };
}

/**
 * Takes a per-item add-on off items that have it, or explains which items to
 * choose from when several lines have it and only some lose it. Pure.
 */
export function planRemoveAddon(
  lines: CartLine[],
  addonId: string,
  qty: number | undefined,
  forRef?: string,
  forLineId?: string
):
  | { action: CartAction; removed: number; itemName: string }
  | { error: string; choices?: Array<{ line_id: string; items: string }> } {
  const addon = findAddon(addonId);
  if (!addon) return { error: `Unknown addon_id: ${addonId}` };
  const label = (l: CartLine) => `${l.qty}× ${l.name}${l.modifiers.length ? ` (${modifierLabel(l)})` : ""}`;
  const candidates = lines.filter(
    (l) =>
      l.modifiers.includes(addon.id) &&
      (!forLineId || l.lineId === forLineId) &&
      (!forRef || l.refId === forRef || findCombo(l.refId)?.itemIds.includes(forRef))
  );
  if (!candidates.length) return { error: `No items in the order have ${addon.name}.` };
  const available = candidates.reduce((n, l) => n + l.qty, 0);
  const wanted = Math.min(Math.max(1, qty ?? available), available);
  if (candidates.length > 1 && wanted < available) {
    return {
      error: `Several items have ${addon.name} — ask the customer which, then call remove_addon again with line_id.`,
      choices: candidates.map((l) => ({ line_id: l.lineId, items: label(l) })),
    };
  }
  // All items that have it lose it: one action per line, applied in order.
  const line = candidates[0];
  if (candidates.length > 1) {
    // wanted === available here: strip it from every line.
    return {
      action: { type: "BATCH", actions: candidates.map((l) => ({ type: "REMOVE_MODIFIER", lineId: l.lineId, addonId: addon.id, qty: l.qty }) as CartAction) },
      removed: available,
      itemName: line.name,
    };
  }
  return {
    action: { type: "REMOVE_MODIFIER", lineId: line.lineId, addonId: addon.id, qty: Math.min(wanted, line.qty) },
    removed: Math.min(wanted, line.qty),
    itemName: line.name,
  };
}

const KIND_WORD: Record<ChoiceKind, [string, string]> = {
  drinks: ["drink", "drinks"],
};

/**
 * Works out which combos or meals get these picks — the picks for ONE of
 * them, e.g. the drink for a 1-pc Chickenjoy Combo — without touching the
 * order. Copies still missing that pick go first; `forLineId` picks exact ones.
 */
export function planChoices(
  lines: CartLine[],
  kind: ChoiceKind,
  choices: string[],
  qty?: number,
  forRef?: string,
  forLineId?: string
): { action: CartAction; set: number; itemName: string } | { error: string } {
  const valid = choicesOf(kind).map((a) => a.id);
  const bad = choices.filter((c) => !valid.includes(c));
  if (bad.length) return { error: `Not a ${KIND_WORD[kind][0]} choice: ${bad.join(", ")}. Use: ${valid.join(", ")}.` };
  const takes = lines.filter((l) => l.kind !== "addon" && (findProduct(l.refId)?.choose?.[kind] ?? 0) > 0);
  let line: CartLine | undefined;
  if (forLineId) line = takes.find((l) => l.lineId === forLineId);
  else {
    const refs = [...new Set(takes.map((l) => l.refId))];
    // "The Chickenjoy's drink" when the Chickenjoy is inside a combo.
    let target = forRef;
    if (target && !refs.includes(target)) {
      target = refs.find((r) => findCombo(r)?.itemIds.includes(target!) || findCombo(r)?.upgradeFrom?.includes(target!)) ?? target;
    }
    if (!target) {
      // Several combos, but only one still waiting for its drink: that one.
      const waiting = [...new Set(takes.filter((l) => (choicesToPick(l)[kind] ?? 0) > 0).map((l) => l.refId))];
      target = refs.length === 1 ? refs[0] : waiting.length === 1 ? waiting[0] : undefined;
    }
    if (!target) return { error: `Which combo is this for? Pass for_item_id, one of: ${refs.join(", ") || `(nothing in the order comes with a ${KIND_WORD[kind][0]} to choose)`}` };
    const own = takes.filter((l) => l.refId === target);
    line = own.find((l) => (choicesToPick(l)[kind] ?? 0) > 0) ?? own[0];
  }
  if (!line) return { error: `That item doesn't come with a ${KIND_WORD[kind][0]} to choose.` };
  const want = findProduct(line.refId)?.choose?.[kind] ?? 0;
  if (choices.length !== want) {
    return {
      error: `${line.name} comes with ${want} ${want === 1 ? KIND_WORD[kind][0] : KIND_WORD[kind][1]} — pass exactly ${want} (one entry each, repeats allowed) for ONE ${line.name}.`,
    };
  }
  const n = Math.min(qty ?? line.qty, line.qty);
  return { action: { type: "SET_CHOICES", lineId: line.lineId, qty: n, kind, choices }, set: n, itemName: line.name };
}

export interface CartContextValue {
  state: CartState;
  /**
   * Latest state, updated synchronously on every dispatch — React state lags
   * a render behind, which fed Joy stale totals when a tool call read the
   * cart right after mutating it.
   */
  getState: () => CartState;
  totals: { subtotal: number; discountAmount: number; total: number };
  addItem: (refId: string, qty?: number) => boolean;
  addCombo: (refId: string, qty?: number) => boolean;
  addAddon: (refId: string, qty?: number) => boolean;
  /**
   * Put a per-item add-on (drink upsize) on `qty` combos or meals already in
   * the order. `forRef` can be omitted when only one kind is in the order;
   * `forLineId` picks exact ones when the copies differ (e.g. Coke vs Sprite).
   */
  applyAddon: (
    addonId: string,
    qty: number,
    forRef?: string,
    forLineId?: string
  ) =>
    | { applied: number; itemName: string; itemRef: string }
    | { error: string; choices?: Array<{ line_id: string; items: string }> };
  /** Turn an ordered item into its combo, keeping its add-ons. */
  upgradeToCombo: (
    comboId: string,
    qty: number,
    forRef?: string,
    forLineId?: string
  ) =>
    | { upgraded: number; from: string; absorbed: string[]; drinkPicked?: string }
    | { error: string; choices?: Array<{ line_id: string; items: string }> };
  /** Take a per-item add-on off items that have it. */
  removeAddon: (
    addonId: string,
    qty?: number,
    forRef?: string,
    forLineId?: string
  ) => { removed: number; itemName: string } | { error: string; choices?: Array<{ line_id: string; items: string }> };
  /** Make the included picks of one kind (the drink) for `qty` of a combo or meal already in the order. */
  setChoices: (
    kind: ChoiceKind,
    choices: string[],
    qty?: number,
    forRef?: string,
    forLineId?: string
  ) => { set: number; itemName: string } | { error: string };
  removeLine: (lineId: string) => void;
  updateQty: (lineId: string, qty: number) => void;
  findLineByRef: (refId: string) => CartLine | undefined;
  clearCart: () => void;
  setDiscount: (discount: DiscountType) => void;
  setPaymentMethod: (method: PaymentMethod) => void;
  setStage: (stage: OrderStage) => void;
  confirmOrder: () => string;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, initialState);
  const stateRef = useRef(initialState);

  // Mirror every action through the same pure reducer so reads immediately
  // after a dispatch (voice tool calls) see the post-action state.
  const dispatchTracked = useCallback((action: CartAction) => {
    stateRef.current = cartReducer(stateRef.current, action);
    dispatch(action);
  }, []);
  const getState = useCallback(() => stateRef.current, []);

  const addItem = useCallback(
    (refId: string, qty = 1) => {
      if (!findMenuItem(refId)) return false;
      dispatchTracked({ type: "ADD_LINE", kind: "item", refId, qty });
      return true;
    },
    [dispatchTracked]
  );

  const addCombo = useCallback((refId: string, qty = 1) => {
    if (!findCombo(refId)) return false;
    dispatchTracked({ type: "ADD_LINE", kind: "combo", refId, qty });
    return true;
  }, [dispatchTracked]);

  const addAddon = useCallback((refId: string, qty = 1) => {
    if (!findAddon(refId)) return false;
    dispatchTracked({ type: "ADD_LINE", kind: "addon", refId, qty });
    return true;
  }, [dispatchTracked]);

  const applyAddon = useCallback(
    (addonId: string, qty: number, forRef?: string, forLineId?: string) => {
      const plan = planAddon(stateRef.current.lines, addonId, qty, forRef, forLineId);
      if ("error" in plan) return plan;
      dispatchTracked(plan.action);
      return { applied: plan.applied, itemName: plan.itemName, itemRef: plan.itemRef };
    },
    [dispatchTracked]
  );

  const upgradeToCombo = useCallback(
    (comboId: string, qty: number, forRef?: string, forLineId?: string) => {
      const plan = planUpgrade(stateRef.current.lines, comboId, qty, forRef, forLineId);
      if ("error" in plan) return plan;
      dispatchTracked(plan.action);
      return { upgraded: plan.upgraded, from: plan.from, absorbed: plan.absorbed, drinkPicked: plan.drinkPicked };
    },
    [dispatchTracked]
  );

  const removeAddon = useCallback(
    (addonId: string, qty?: number, forRef?: string, forLineId?: string) => {
      const plan = planRemoveAddon(stateRef.current.lines, addonId, qty, forRef, forLineId);
      if ("error" in plan) return plan;
      dispatchTracked(plan.action);
      return { removed: plan.removed, itemName: plan.itemName };
    },
    [dispatchTracked]
  );

  const setChoices = useCallback(
    (kind: ChoiceKind, choices: string[], qty?: number, forRef?: string, forLineId?: string) => {
      const plan = planChoices(stateRef.current.lines, kind, choices, qty, forRef, forLineId);
      if ("error" in plan) return plan;
      dispatchTracked(plan.action);
      return { set: plan.set, itemName: plan.itemName };
    },
    [dispatchTracked]
  );

  const removeLine = useCallback((lineId: string) => {
    dispatchTracked({ type: "REMOVE_LINE", lineId });
  }, [dispatchTracked]);

  const updateQty = useCallback((lineId: string, qty: number) => {
    dispatchTracked({ type: "UPDATE_QTY", lineId, qty });
  }, [dispatchTracked]);

  // An item can span several lines (e.g. combos with different drinks): report the total.
  const findLineByRef = useCallback(
    (refId: string) => {
      const matches = state.lines.filter((l) => l.refId === refId);
      if (!matches.length) return undefined;
      return { ...matches[0], qty: matches.reduce((n, l) => n + l.qty, 0) };
    },
    [state.lines]
  );

  const clearCart = useCallback(() => dispatchTracked({ type: "CLEAR_CART" }), [dispatchTracked]);
  const setDiscount = useCallback(
    (discount: DiscountType) => dispatchTracked({ type: "SET_DISCOUNT", discount }),
    [dispatchTracked]
  );
  const setPaymentMethod = useCallback(
    (method: PaymentMethod) => dispatchTracked({ type: "SET_PAYMENT_METHOD", method }),
    [dispatchTracked]
  );
  const setStage = useCallback(
    (stage: OrderStage) => dispatchTracked({ type: "SET_STAGE", stage }),
    [dispatchTracked]
  );
  const confirmOrder = useCallback(() => {
    const orderNumber = `JB-${Math.floor(1000 + Math.random() * 9000)}`;
    dispatchTracked({ type: "CONFIRM_ORDER", orderNumber });
    return orderNumber;
  }, [dispatchTracked]);

  const totals = useMemo(() => computeTotals(state), [state]);

  const value = useMemo<CartContextValue>(
    () => ({
      state,
      getState,
      totals,
      addItem,
      addCombo,
      addAddon,
      applyAddon,
      upgradeToCombo,
      removeAddon,
      setChoices,
      removeLine,
      updateQty,
      findLineByRef,
      clearCart,
      setDiscount,
      setPaymentMethod,
      setStage,
      confirmOrder,
    }),
    [
      state,
      getState,
      totals,
      addItem,
      addCombo,
      addAddon,
      applyAddon,
      upgradeToCombo,
      removeAddon,
      setChoices,
      removeLine,
      updateQty,
      findLineByRef,
      clearCart,
      setDiscount,
      setPaymentMethod,
      setStage,
      confirmOrder,
    ]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
