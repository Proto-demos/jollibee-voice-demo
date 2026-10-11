import {
  ADDONS,
  CHOICE_KINDS,
  COMBOS,
  UPSIZE_ADDON,
  choicesOf,
  combosForItem,
  findAddon,
  findCombo,
  findMenuItem,
  findOrderable,
  findProduct,
  hasDessertIn,
  hasDrinkIn,
  isPerItemAddon,
  type ChoiceKind,
  type Combo,
} from "@/lib/menu";
import { choicesToPick, computeTotals, modifierLabel, type CartContextValue, type CartLine, type DiscountType, type PaymentMethod } from "@/lib/cart";

/** Why Joy passed a customer to a live crew member – threats are flagged for security. */
export type HandoffKind = "prank" | "abuse" | "threat" | "request" | "complaint";
export const HANDOFF_KINDS: HandoffKind[] = ["prank", "abuse", "threat", "request", "complaint"];

/** What the tool handlers can show or trigger on the kiosk. */
export interface ToolUi {
  openCheckout: () => void;
  onSuggest?: (suggestions: UpsellSuggestion[]) => void;
  onHandoff?: (reason: string, kind: HandoffKind) => void;
}

/** The one upsell Joy is pitching right now, surfaced so the UI can show it as a card. */
export interface UpsellSuggestion {
  refId: string;
  kind: "item" | "addon" | "combo";
  name: string;
  price: number;
  image?: string;
  /** Card id on screen — reused by the "added" card so the offer morphs into it. */
  cardId?: number;
  /** Joy is asking which combos get it (e.g. "1× Cheesy Yumburger Combo (Coke)", "1× Cheesy Yumburger Combo (Sprite)"). */
  choices?: string[];
}

const CHOICE_IDS = (kind: ChoiceKind) => choicesOf(kind).map((a) => a.id);

/** What add_item and add_combo take besides the id: what the customer already said about the drink. */
const DRINK_PARAMS = {
  quantity: { type: "integer", minimum: 1, description: "Exactly the number the customer said – never reduce it." },
  confirmed_large: { type: "boolean", description: "Only after the customer confirmed an unusually large quantity (over 10) and it sounds genuine." },
  drink_size: { type: "string", enum: ["regular", "upsize"], description: "Combos and Kids Meals only. Regular is the default; upsize adds the drink upsize (₱15)." },
  drinks: { type: "array", items: { type: "string", enum: CHOICE_IDS("drinks") }, description: "Combos and Kids Meals: the drink(s) the customer said – one entry when they all get the same drink, or one entry PER combo when they differ (quantity 2, one Coke and one Sprite → [\"drink-coke\", \"drink-sprite\"])." },
};

export const TOOL_DEFINITIONS = [
  {
    type: "function",
    name: "add_item",
    description:
      "Add a menu item to the customer's cart by its exact item id. For a Kids Meal, pass anything the customer already said about it in the same call – the drink they picked, and drink_size \"upsize\" – applied to exactly these items.",
    parameters: {
      type: "object",
      properties: {
        item_id: { type: "string", description: "Exact menu item id from the MENU list." },
        ...DRINK_PARAMS,
      },
      required: ["item_id"],
    },
  },
  {
    type: "function",
    name: "add_combo",
    description:
      "Add a combo (main, side and a drink of the customer's choice) by its exact combo id. Pass anything the customer already said in the same call – the drink they picked and drink_size \"upsize\" – applied to exactly these combos. For an item ALREADY in the order, use upgrade_to_combo instead.",
    parameters: {
      type: "object",
      properties: {
        combo_id: { type: "string", description: "Exact combo id from the Combos list." },
        ...DRINK_PARAMS,
      },
      required: ["combo_id"],
    },
  },
  {
    type: "function",
    name: "upgrade_to_combo",
    description:
      "Turn an item already in the order into its combo (\"gawin na nating combo\"), e.g. a 1-pc Chickenjoy Solo into the 1-pc Chickenjoy Combo. Fries or a Coke ordered on their own become part of the combo, so they aren't paid for twice. Always use this – never remove_line + add_combo – when the customer accepts a combo for an item they already ordered.",
    parameters: {
      type: "object",
      properties: {
        combo_id: { type: "string", description: "Exact combo id (from suggest_combo_for_item or list_addons_for_item)." },
        item_id: { type: "string", description: "The ordered item that becomes the combo (e.g. chickenjoy-1pc-solo)." },
        line_id: { type: "string", description: "Exact line (from get_cart or a 'choices' list) when that item's copies differ." },
        quantity: { type: "integer", minimum: 1, description: "How many of that item to upgrade (default 1)." },
      },
      required: ["combo_id"],
    },
  },
  {
    type: "function",
    name: "suggest_combo_for_item",
    description:
      "Find the real combo an ordered item can become, with its exact price and what it adds, to offer a \"gawin na nating combo\" upgrade.",
    parameters: {
      type: "object",
      properties: { item_id: { type: "string" } },
      required: ["item_id"],
    },
  },
  {
    type: "function",
    name: "remove_addon",
    description:
      "Take the drink upsize off the combos or meals that have it, keeping the combo. Use this – never remove_line + re-adding – when the customer wants the upsize gone.",
    parameters: {
      type: "object",
      properties: {
        addon_id: { type: "string" },
        for_item_id: { type: "string", description: "The combo or meal it's on." },
        line_id: { type: "string", description: "Exact line (line_id from get_cart or a 'choices' list) when several have it." },
        quantity: { type: "integer", minimum: 1, description: "How many lose it (default: all that have it)." },
      },
      required: ["addon_id"],
    },
  },
  {
    type: "function",
    name: "add_addon",
    description:
      "Add an add-on by its exact addon id. The drink upsize attaches to specific combos or Kids Meals already in the order: pass for_item_id (the combo or meal id) and quantity = how many of them get it – the order splits them automatically (e.g. 1× Cheesy Yumburger Combo and 1× Cheesy Yumburger Combo with Upsized drink). Fries, gravy, desserts and drinks offered as add-ons are added as their own items.",
    parameters: {
      type: "object",
      properties: {
        addon_id: { type: "string", description: "Exact addon id from the Add-ons list." },
        quantity: { type: "integer", minimum: 1, description: "For the upsize: how many combos or meals get it." },
        for_item_id: {
          type: "string",
          description: "Upsize only: the combo or meal id in the order that gets it (e.g. combo-chickenjoy-1pc). Required when more than one kind is in the order.",
        },
        for_line_id: {
          type: "string",
          description: "Upsize only: the exact copies (line_id from get_cart or from a 'choices' list) when they differ, e.g. Coke vs Sprite.",
        },
      },
      required: ["addon_id"],
    },
  },
  {
    type: "function",
    name: "choose_included",
    description:
      "Record the drink the customer picked for a combo or Kids Meal already in the order (kind 'drinks'). Pass the pick for ONE of them; quantity = how many of them get it (default: all). When copies differ (2 combos: one Coke, one Sprite), call once per variant with quantity 1. Picks are free.",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: CHOICE_KINDS },
        choices: {
          type: "array",
          items: { type: "string", enum: CHOICE_KINDS.flatMap(CHOICE_IDS) },
          description: "One entry per drink of ONE combo or meal.",
        },
        for_item_id: { type: "string", description: "The combo or meal id." },
        line_id: { type: "string", description: "Exact line (from get_cart) when copies differ." },
        quantity: { type: "integer", minimum: 1 },
      },
      required: ["kind", "choices"],
    },
  },
  {
    type: "function",
    name: "remove_line",
    description: "Remove a line from the cart entirely. Use the line_id from get_cart (a combo can have several lines, e.g. one with Coke and one with Sprite); a plain item or combo id also works.",
    parameters: {
      type: "object",
      properties: { ref_id: { type: "string", description: "line_id from get_cart, or an item/combo/addon id." } },
      required: ["ref_id"],
    },
  },
  {
    type: "function",
    name: "update_quantity",
    description: "Change the quantity of a line already in the cart (line_id from get_cart, or a plain item or combo id). Use quantity 0 to remove it.",
    parameters: {
      type: "object",
      properties: {
        ref_id: { type: "string", description: "line_id from get_cart, or an item/combo/addon id." },
        quantity: { type: "integer", minimum: 0 },
        confirmed_large: { type: "boolean", description: "Only after the customer confirmed an unusually large quantity (over 10) and it sounds genuine." },
      },
      required: ["ref_id", "quantity"],
    },
  },
  {
    type: "function",
    name: "get_cart",
    description: "Get the current cart contents and totals. Call this to confirm what's in the cart or read back the order.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "list_addons_for_item",
    description:
      "Get the real, orderable offers for a given menu item or combo id, in the order to pitch them: the combo upgrade (for a solo item that has one), the drink upsize, a drink, fries, gravy, desserts. Always call this before upselling so you only offer real products and prices.",
    parameters: {
      type: "object",
      properties: { item_id: { type: "string", description: "Menu item or combo id." } },
      required: ["item_id"],
    },
  },
  {
    type: "function",
    name: "apply_discount",
    description: "Record the discount the customer is eligible for (or 'none').",
    parameters: {
      type: "object",
      properties: {
        discount_type: { type: "string", enum: ["none", "senior", "pwd", "promo10"] },
      },
      required: ["discount_type"],
    },
  },
  {
    type: "function",
    name: "set_payment_method",
    description: "Record how the customer wants to pay.",
    parameters: {
      type: "object",
      properties: { method: { type: "string", enum: ["cash", "card", "qr"] } },
      required: ["method"],
    },
  },
  {
    type: "function",
    name: "start_checkout",
    description: "Open checkout once the customer says they're done ordering.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "confirm_order",
    description:
      "Finalize and place the order for cash or QR payment, after a payment method has been set. Do NOT call this for card — card payments are completed by the customer on-screen and confirm automatically.",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "resume_ordering",
    description:
      "Close checkout and go back to ordering, keeping the cart as-is — use when the customer wants to add or change something before finishing checkout (e.g. 'wait, let me also get fries').",
    parameters: { type: "object", properties: {} },
  },
  {
    type: "function",
    name: "show_offer",
    description:
      "Highlight the ONE product you are pitching right now (a combo upgrade, the drink upsize, an add-on or a menu item) as the offer card on screen, so it always matches what you say. Call it every time you pitch a specific product, right before pitching it. Nothing is added to the order.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Id of the product you are about to pitch." } },
      required: ["id"],
    },
  },
  {
    type: "function",
    name: "show_items",
    description:
      "Put products on the customer's screen as a card with photos and prices. Call this WHENEVER you name, list, compare or recommend two or more specific products out loud (e.g. the customer asks what combos, Chickenjoy, burgers or desserts you have, or asks for a recommendation) — so the screen always shows what you are talking about. Ids can be menu item, combo or add-on ids. Nothing is added to the order.",
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short card heading in the customer's language, e.g. \"Mga combo\", \"Mga Chickenjoy\", \"Rekomendasyon ni Joy\".",
        },
        ids: {
          type: "array",
          items: { type: "string" },
          description: "The ids of the products you are naming, in the order you say them (max 6).",
        },
      },
      required: ["title", "ids"],
    },
  },
  {
    type: "function",
    name: "handoff_to_crew",
    description:
      "Hand this customer over to a live crew member (a person takes over the kiosk). Use it for a prank, joke or impossible order, a customer messing with you, insults or harassment, any threat, an order that is clearly not genuine (e.g. absurd quantities after you checked once), when they ask for a real person or a manager, a complaint you can't fix, or ANY question you can't answer from the menu, this order, its prices or the kiosk (general knowledge, news, politics, people, store hours, branches, other brands…). Say one short polite line, then stop.",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: HANDOFF_KINDS,
          description:
            "prank = joke, impossible or not a genuine order, or messing with you; abuse = insults or harassment; threat = any threat of harm or violence; request = asked for a person or manager; complaint = a complaint you can't fix. An off-topic question (outside the menu, this order and the kiosk) is never a handover – decline it politely and carry on.",
        },
        reason: { type: "string", description: "Short reason for the crew, in English, e.g. \"Prank: ordered 500 Chickenjoy Combos\", \"Insulted the order-taker\", \"Asked for a manager\"." },
      },
      required: ["kind", "reason"],
    },
  },
  {
    type: "function",
    name: "clear_cart",
    description:
      "Empty the cart completely and close checkout if it's open — use when the customer wants to start over, or is done after their order was confirmed (e.g. they say bye or want a new order).",
    parameters: { type: "object", properties: {} },
  },
];

const ASK: Record<ChoiceKind, (n: number) => [string, string]> = {
  drinks: (n) => [
    `Anong ${n > 1 ? `${n} drinks` : "drink"} po – Coke, Coke Zero, Sprite, Royal, iced tea, o pineapple juice?`,
    `Which ${n > 1 ? `${n} drinks` : "drink"} – Coke, Coke Zero, Sprite, Royal, iced tea or pineapple juice?`,
  ],
};

/** The next question about what comes with a combo or meal, or null when everything is picked. */
function nextPick(line: CartLine | undefined): string | null {
  if (!line) return null;
  const missing = choicesToPick(line);
  const kinds = CHOICE_KINDS.filter((k) => missing[k]);
  if (!kinds.length) return null;
  const qs = kinds.map((k) => ASK[k](missing[k]!));
  return `ask the drink for the ${line.name}. Tagalog: "${qs.map((q) => q[0]).join(" ")}" English: "${qs.map((q) => q[1]).join(" ")}"`;
}

function pendingLine(cart: CartContextValue, refId: string) {
  return cart.getState().lines.find((l) => l.refId === refId && CHOICE_KINDS.some((k) => choicesToPick(l)[k]));
}

function summarize(cart: CartContextValue) {
  // getState(), not cart.state: React state lags one render behind, which fed
  // Joy (and the on-screen cards) totals from BEFORE the action she just took.
  const state = cart.getState();
  const totals = computeTotals(state);
  return {
    lines: state.lines.map((l) => ({
      line_id: l.lineId,
      ref_id: l.refId,
      name: l.name,
      add_ons: l.modifiers.length ? modifierLabel(l) : undefined,
      still_to_pick: Object.keys(choicesToPick(l)).length ? choicesToPick(l) : undefined,
      unit_price: l.unitPrice,
      quantity: l.qty,
      line_total: l.unitPrice * l.qty,
    })),
    subtotal: totals.subtotal,
    discount: state.discount,
    discount_amount: totals.discountAmount,
    total: totals.total,
    payment_method: state.paymentMethod,
    stage: state.stage,
  };
}

/** By line_id first; a plain id picks that item's plain line (no add-ons) when there is one. */
function findLine(cart: CartContextValue, id: string) {
  const lines = cart.getState().lines;
  // Fries, desserts and drink add-ons live in the order as their menu item.
  const ref = findAddon(id)?.itemId ?? id;
  return (
    lines.find((l) => l.lineId === ref) ??
    lines.find((l) => l.refId === ref && l.modifiers.length === 0) ??
    lines.find((l) => l.refId === ref)
  );
}

function lineTitle(line: { name: string; modifiers: string[] }) {
  return line.modifiers.length ? `${line.name} (${modifierLabel(line)})` : line.name;
}

/** What a combo adds to an item it is made from, as Joy says it: "rice, fries at drink". */
function comboAdds(combo: Combo, fromItemId: string): string {
  const parts: string[] = [];
  if (fromItemId !== combo.itemIds[0] && /w\/ Rice/.test(findMenuItem(combo.itemIds[0])?.name ?? "")) parts.push("rice");
  for (const id of combo.itemIds.slice(1)) {
    const item = findMenuItem(id);
    parts.push(item?.category === "beverages" ? "drink" : item?.category === "sides" ? "fries" : item?.name ?? id);
  }
  return `${parts.slice(0, -1).join(", ")} at ${parts[parts.length - 1]}`;
}

/** The combo an item in the order can still become, as an offer (null when it has none or is already one). */
function comboOffer(cart: CartContextValue, itemId: string) {
  const item = findMenuItem(itemId);
  const combo = combosForItem(itemId)[0];
  if (!item || !combo) return null;
  const plain = cart.getState().lines.some((l) => l.kind === "item" && l.refId === itemId);
  if (!plain) return null;
  return {
    combo_id: combo.id,
    name: combo.name,
    price: combo.price,
    extra_cost: combo.price - item.price,
    includes: combo.itemIds.map((id) => (findMenuItem(id)?.category === "beverages" ? "a regular drink of their choice" : findMenuItem(id)?.name ?? id)),
    pitch: `Gawin na nating ${combo.name} – may ${comboAdds(combo, itemId)} na, ₱${combo.price} lahat, dagdag ₱${combo.price - item.price} lang`,
    accept_with: `upgrade_to_combo (combo_id ${combo.id}, item_id ${itemId})`,
  };
}

/**
 * The offers for an item or combo, in pitch order: the combo upgrade, then
 * the drink upsize (unless every copy has it), then a drink if the order has
 * none, then the rest — skipping fries, desserts and drinks already ordered
 * (on their own or inside a combo).
 */
function offersFor(cart: CartContextValue, productId: string) {
  const product = findProduct(productId);
  if (!product) return null;
  const lines = cart.getState().lines;
  const ordered = new Set(lines.flatMap((l) => (l.kind === "combo" ? COMBOS.find((c) => c.id === l.refId)?.itemIds ?? [] : [l.refId])));
  const hasDrink = hasDrinkIn(lines);
  const hasDessert = hasDessertIn(lines);
  const own = lines.filter((l) => l.kind !== "addon" && l.refId === product.id);
  const noUpsize = own.length === 0 || own.every((l) => l.modifiers.includes(UPSIZE_ADDON));
  // One drink is enough: once the order has any drink (or a combo or meal
  // with one), no more drinks are pitched.
  const addons = (product.addonIds ?? [])
    .map((id) => ADDONS.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .filter((a) => !(a.itemId && ordered.has(a.itemId)))
    .filter((a) => !(noUpsize && a.id === UPSIZE_ADDON) && !(hasDrink && a.category === "drink"))
    // Likewise one dessert: with a pie, sundae or Halo-Halo already in, no more desserts.
    .filter((a) => !(hasDessert && a.category === "dessert"));
  const rank = (a: (typeof addons)[number]) => (a.id === UPSIZE_ADDON ? 0 : !hasDrink && a.category === "drink" ? 1 : 2);
  addons.sort((a, b) => rank(a) - rank(b));
  const combo = comboOffer(cart, product.id);
  return [
    ...(combo ? [{ combo_id: combo.combo_id, name: combo.name, price: combo.price, pitch: combo.pitch, accept_with: combo.accept_with }] : []),
    ...addons.map((a) => ({ addon_id: a.id, name: a.name, price: a.price, pitch: a.pitch })),
  ];
}

/** Checkout questions are answered on screen — so the payment screen must be open for them. */
function openCheckout(cart: CartContextValue, ui: { openCheckout: () => void }) {
  if (cart.getState().stage === "checkout") return;
  cart.setStage("checkout");
  ui.openCheckout();
}

/**
 * Where checkout stands, so Joy resumes it instead of starting over (e.g.
 * after the customer adds something mid-checkout): what's settled and the one
 * question to ask next.
 */
function checkoutProgress(cart: CartContextValue) {
  const state = cart.getState();
  const discount = state.discountDecided ? state.discount : null;
  const payment = state.paymentMethod;
  // Example lines in Tagalog: Joy echoes the language of what she's given.
  const ask_next = !state.discountDecided
    ? "Discount — Tagalog: \"May Senior Citizen o PWD ID po ba kayo, o promo code?\" / English: \"Do you have a Senior Citizen or PWD ID, or a promo code?\""
    : !payment
      ? "Payment — Tagalog: \"Paano po kayo magbabayad — cash, card, o QR (GCash/Maya)?\" / English: \"How would you like to pay — cash, card, or QR (GCash/Maya)?\""
      : "Name, then finish — Tagalog: \"Ano po ang pangalan para sa order?\" / English: \"What name should we put on the order?\" (skip if you already have it) — then confirm_order for cash/QR when they're ready; card completes on screen.";
  return {
    discount: discount ?? "not asked yet",
    payment_method: payment ?? "not asked yet",
    ask_next,
    rule: "Never re-ask anything already settled above. Use the line in the language the customer is speaking.",
  };
}

/** Tools that change what's in the order. */
const ORDER_CHANGING = new Set([
  "add_item",
  "add_combo",
  "upgrade_to_combo",
  "add_addon",
  "remove_addon",
  "choose_included",
  "remove_line",
  "update_quantity",
]);

/** Above this many of one product, Joy checks once before adding (prank guard). */
const MAX_QTY = 10;
/** Beyond this, no kiosk order is genuine: always a live agent. */
const ABSURD_QTY = 60;

/** The quantity guard for add_item / add_combo / update_quantity: null when it's fine to go ahead. */
function quantityGuard(qty: number, name: string, confirmed: unknown, retry: string): { error: string } | null {
  if (!Number.isFinite(qty)) return null;
  // Hundreds of combos at a kiosk isn't a real order: never add it, a person takes over.
  if (qty > ABSURD_QTY) {
    return {
      error: `Not added: ${qty}× ${name} can't be a genuine kiosk order. Call handoff_to_crew now (kind "prank", reason: the quantity) and say only the handover line – don't ask, don't comment on the number.`,
    };
  }
  // A kiosk order this big is rare – check once before adding it.
  if (qty > MAX_QTY && !confirmed) {
    return {
      error: `Not added: ${qty}× ${name} is unusually large for a kiosk order. Ask once, neutrally, and say ONLY: "${qty} po talaga?" (English: "${qty}, is that right?") – nothing more: don't mention pranks, the crew, a "large order" or adding it again. If they confirm and it sounds genuine (e.g. a family or office order), call ${retry} again with confirmed_large: true. If it's absurd or they're joking, call handoff_to_crew.`,
    };
  }
  return null;
}

export function createToolHandlers(
  cart: CartContextValue,
  ui: ToolUi
): Record<string, (args: Record<string, unknown>) => unknown> {
  const handlers = baseHandlers(cart, ui);
  // A change during checkout ("teka, pa-add ng Peach-Mango Pie") reopens
  // ordering by itself — Joy forgot the change when it took a separate resume step.
  for (const name of ORDER_CHANGING) {
    const run = handlers[name];
    handlers[name] = (args) => {
      if (cart.getState().stage !== "checkout") return run(args);
      cart.setStage("ordering");
      const result = run(args);
      return result && typeof result === "object" && !("error" in result)
        ? { ...result, checkout: "Reopened for this change — call start_checkout again once they're done." }
        : result;
    };
  }
  return handlers;
}

function baseHandlers(
  cart: CartContextValue,
  ui: ToolUi
): Record<string, (args: Record<string, unknown>) => unknown> {
  /** add_item and add_combo: add, then put what the customer already said about the drink on exactly these. */
  const addProduct = (id: string, quantity: unknown, drink_size: unknown, drinks: unknown, confirmed_large: unknown, tool: string) => {
    const qty = Number(quantity) || 1;
    const product = findProduct(id);
    if (!product) return { error: `Unknown item or combo id: ${id}` };
    const guard = quantityGuard(qty, product.name, confirmed_large, tool);
    if (guard) return guard;
    const isCombo = Boolean(findCombo(id));
    if (drink_size === "upsize" && !product.addonIds?.includes(UPSIZE_ADDON)) {
      return { error: `${product.name} has no drink to upsize – that's for combos and Kids Meals.` };
    }
    if (isCombo) cart.addCombo(id, qty);
    else cart.addItem(id, qty);
    const notes: string[] = [];
    const list = Array.isArray(drinks) ? drinks.map(String) : [];
    const perOne = product.choose?.drinks ?? 0;
    // The same drink for all of them, or one drink per combo when they differ
    // (2 combos, [Coke, Sprite] → 1× with Coke and 1× with Sprite).
    const groups: Array<[string[], number]> =
      !list.length
        ? []
        : list.length === perOne
          ? [[list, qty]]
          : perOne === 1 && list.length === qty
            ? [...new Set(list)].map((d): [string[], number] => [[d], list.filter((x) => x === d).length])
            : [];
    if (list.length && !perOne) notes.push(`${product.name} doesn't come with a drink to choose.`);
    else if (list.length && !groups.length) notes.push(`${product.name} comes with ${perOne} drink – pass one drink for all of them, or exactly one per combo (${qty}).`);
    for (const [picks, n] of groups) {
      const line = cart.getState().lines.find((l) => l.refId === id && (choicesToPick(l).drinks ?? 0) > 0);
      if (!line) break;
      const res = cart.setChoices("drinks", picks, n, id, line.lineId);
      if ("error" in res) notes.push(res.error);
    }
    if (drink_size === "upsize") {
      // Every copy just added gets it, across the lines their drinks split them into.
      let left = qty;
      for (const line of cart.getState().lines.filter((l) => l.refId === id && !l.modifiers.includes(UPSIZE_ADDON))) {
        if (left <= 0) break;
        const res = cart.applyAddon(UPSIZE_ADDON, Math.min(left, line.qty), id, line.lineId);
        if (!("error" in res)) left -= res.applied;
      }
    }
    const ask = nextPick(pendingLine(cart, id));
    return {
      ...summarize(cart),
      ...(notes.length ? { pick_errors: notes } : {}),
      ...(ask
        ? { ask_first: `Confirm it, then ${ask} – and stop: no add-on, no combo pitch, no show_offer in this reply. (Several added this turn: ask once for all of them.) Pitch the first offer only once the drink is picked.` }
        : {}),
    };
  };

  return {
    add_item: ({ item_id, quantity, drink_size, drinks, confirmed_large }) => {
      let id = String(item_id);
      // A drink or dessert add-on id ("addon-coke-regular") is really that menu item.
      const addon = findAddon(id);
      if (addon?.itemId) id = addon.itemId;
      else if (addon) return { error: `${addon.name} is an add-on – call add_addon with addon_id "${addon.id}".` };
      if (!findMenuItem(id) && !findCombo(id)) return { error: `Unknown item_id: ${item_id}` };
      return addProduct(id, quantity, drink_size, drinks, confirmed_large, "add_item");
    },
    add_combo: ({ combo_id, quantity, drink_size, drinks, confirmed_large }) => {
      const id = String(combo_id);
      if (!findCombo(id) && !findMenuItem(id)) return { error: `Unknown combo_id: ${combo_id}` };
      return addProduct(id, quantity, drink_size, drinks, confirmed_large, "add_combo");
    },
    upgrade_to_combo: ({ combo_id, item_id, line_id, quantity }) => {
      const res = cart.upgradeToCombo(
        String(combo_id),
        Number(quantity) || 1,
        item_id ? String(item_id) : undefined,
        line_id ? String(line_id) : undefined
      );
      if ("error" in res) return res;
      const combo = findCombo(String(combo_id))!;
      const includes = combo.itemIds.map((id) => (findMenuItem(id)?.category === "beverages" ? "a regular drink" : findMenuItem(id)?.name ?? id));
      const ask = nextPick(pendingLine(cart, combo.id));
      const first = ask ? null : offersFor(cart, combo.id)?.[0];
      return {
        ...summarize(cart),
        upgraded: res.upgraded,
        from: res.from,
        ...(res.absorbed.length
          ? { now_part_of_combo: res.absorbed, say: `Tell the customer their separately ordered ${res.absorbed.join(", ")} is now part of the combo (not charged twice).` }
          : {}),
        ...(res.drinkPicked ? { drink: `${res.drinkPicked} – taken from what they already ordered; don't ask the drink.` } : {}),
        combo_includes: includes,
        note: `Already in the combo – do not offer these again: ${includes.join(", ")}.`,
        next: ask
          ? `Confirm the upgrade, then ${ask} – no pitch in this reply.`
          : first
            ? `Confirm the upgrade, then pitch ${first.name} (₱${first.price}) with show_offer ${"addon_id" in first ? first.addon_id : first.combo_id}.`
            : "Confirm the upgrade and ask \"Yun lang po ba?\".",
      };
    },
    suggest_combo_for_item: ({ item_id }) => {
      const id = String(item_id);
      const item = findMenuItem(id);
      if (!item) return { error: `Unknown item_id: ${item_id}` };
      const combos = combosForItem(id);
      if (!combos.length) return { combos: [], note: `${item.name} has no combo – pitch an add-on instead.` };
      return {
        combos: combos.map((c) => ({
          combo_id: c.id,
          name: c.name,
          price: c.price,
          extra_cost: c.price - item.price,
          adds: comboAdds(c, id),
          includes: c.itemIds.map((i) => (findMenuItem(i)?.category === "beverages" ? "a regular drink of their choice" : findMenuItem(i)?.name ?? i)),
          description: c.description,
        })),
      };
    },
    add_addon: ({ addon_id, quantity, for_item_id, for_line_id }) => {
      const addon = findAddon(String(addon_id));
      if (!addon) return { error: `Unknown addon_id: ${addon_id}` };
      if (isPerItemAddon(addon)) {
        const res = cart.applyAddon(
          addon.id,
          Number(quantity) || 1,
          for_item_id ? String(for_item_id) : undefined,
          for_line_id ? String(for_line_id) : undefined
        );
        if ("error" in res) return res;
        return { ...summarize(cart), applied_to_items: res.applied, item: res.itemName, item_ref: res.itemRef };
      }
      if (addon.category === "choice") {
        return { error: `${addon.name} is the drink that comes with a combo – use choose_included, not add_addon.` };
      }
      // Fries, a dessert or a drink offered as an add-on is just that menu
      // item — add it as the item, so it merges with the same item and shows in the menu.
      if (addon.itemId) cart.addItem(addon.itemId, Number(quantity) || 1);
      else cart.addAddon(addon.id, Number(quantity) || 1);
      return summarize(cart);
    },
    remove_addon: ({ addon_id, for_item_id, line_id, quantity }) => {
      const res = cart.removeAddon(
        String(addon_id),
        quantity ? Number(quantity) : undefined,
        for_item_id ? String(for_item_id) : undefined,
        line_id ? String(line_id) : undefined
      );
      if ("error" in res) return res;
      return { ...summarize(cart), removed_from_items: res.removed, item: res.itemName };
    },
    choose_included: ({ kind, choices, for_item_id, line_id, quantity }) => {
      const k = String(kind) as ChoiceKind;
      if (!CHOICE_KINDS.includes(k)) return { error: `Unknown kind: ${kind}` };
      const list = Array.isArray(choices) ? choices.map(String) : [];
      const res = cart.setChoices(
        k,
        list,
        quantity ? Number(quantity) : undefined,
        for_item_id ? String(for_item_id) : undefined,
        line_id ? String(line_id) : undefined
      );
      if ("error" in res) return res;
      const ref = cart.getState().lines.find((l) => l.name === res.itemName)?.refId ?? findProduct(String(for_item_id ?? ""))?.id ?? "";
      const ask = nextPick(pendingLine(cart, ref));
      const first = ask ? null : offersFor(cart, ref)?.[0];
      return {
        ...summarize(cart),
        set_for: res.set,
        item: res.itemName,
        next: ask
          ? `Confirm briefly, then ${ask} – still no pitch.`
          : first
            ? `The drink is picked – confirm briefly, then pitch ${first.name} (₱${first.price}) with show_offer ${"addon_id" in first ? first.addon_id : first.combo_id}: "${first.pitch}".`
            : "The drink is picked – confirm briefly and ask \"Yun lang po ba?\".",
      };
    },
    remove_line: ({ ref_id }) => {
      const line = findLine(cart, String(ref_id));
      if (!line) return { error: `No cart line for: ${ref_id}` };
      cart.removeLine(line.lineId);
      return { ...summarize(cart), removed: lineTitle(line) };
    },
    update_quantity: ({ ref_id, quantity, confirmed_large }) => {
      const line = findLine(cart, String(ref_id));
      if (!line) return { error: `No cart line for: ${ref_id}` };
      const guard = quantityGuard(Number(quantity), line.name, confirmed_large, "update_quantity");
      if (guard) return guard;
      cart.updateQty(line.lineId, Number(quantity));
      return { ...summarize(cart), changed: lineTitle(line) };
    },
    get_cart: () => summarize(cart),
    list_addons_for_item: ({ item_id }) => {
      const offers = offersFor(cart, findAddon(String(item_id))?.itemId ?? String(item_id));
      if (!offers) return { error: `Unknown item_id: ${item_id}` };
      // Put the first offer on screen now, so Joy confirms and pitches in one
      // spoken reply – a separate show_offer step let her fill the gap with
      // "sandali lang, may upgrade ako…". Only once nothing is waiting for its
      // drink (the drink question comes first) and only for the product just
      // added, so a multi-item order shows the offer for its last item.
      const lines = cart.getState().lines;
      const pending = lines.some((l) => Object.keys(choicesToPick(l)).length);
      const latest = lines.filter((l) => l.kind !== "addon").at(-1)?.refId === findProduct(findAddon(String(item_id))?.itemId ?? String(item_id))?.id;
      const first = offers[0];
      const firstId = first && ("combo_id" in first ? first.combo_id : first.addon_id);
      const found = firstId ? findOrderable(firstId) : undefined;
      if (found && !pending && latest) {
        ui.onSuggest?.([{ refId: found.data.id, kind: found.kind, name: found.data.name, price: found.data.price, image: found.data.image }]);
        return {
          addons: offers,
          offer_card_shown: found.data.id,
          note: "The first offer is already on screen as the offer card – confirm the order and pitch it in this same spoken reply; don't call show_offer for it (only to pitch a different product).",
        };
      }
      return { addons: offers };
    },
    show_offer: ({ id }) => {
      const found = findOrderable(String(id));
      if (!found) return { error: `Unknown id: ${id}` };
      const { data } = found;
      ui.onSuggest?.([{ refId: data.id, kind: found.kind, name: data.name, price: data.price, image: data.image }]);
      return { shown: { id: data.id, name: data.name, price: data.price } };
    },
    show_items: ({ ids }) => {
      const list = Array.isArray(ids) ? ids.map(String).slice(0, 6) : [];
      const found = list.map((id) => findOrderable(id)).filter((o): o is NonNullable<typeof o> => Boolean(o));
      if (!found.length) return { error: `None of these ids exist: ${list.join(", ")}` };
      return { shown: found.map((o) => ({ id: o.data.id, name: o.data.name, price: o.data.price })) };
    },
    apply_discount: ({ discount_type }) => {
      openCheckout(cart, ui);
      cart.setDiscount(discount_type as DiscountType);
      return { ...summarize(cart), checkout: checkoutProgress(cart) };
    },
    set_payment_method: ({ method }) => {
      openCheckout(cart, ui);
      cart.setPaymentMethod(method as PaymentMethod);
      return { ...summarize(cart), checkout: checkoutProgress(cart) };
    },
    start_checkout: () => {
      // Never check out with a combo still waiting for its drink.
      const pending = cart.getState().lines.find((l) => Object.keys(choicesToPick(l)).length);
      if (pending) return { error: `The ${pending.name} still needs its drink – ${nextPick(pending)} first, then call start_checkout.` };
      openCheckout(cart, ui);
      return { ...summarize(cart), checkout: checkoutProgress(cart) };
    },
    confirm_order: () => {
      if (!cart.getState().paymentMethod) {
        return { error: "No payment method set yet — ask how they'd like to pay first." };
      }
      if (cart.getState().paymentMethod === "card") {
        return {
          error:
            "Card payments are completed on-screen by the customer, not by you. Tell them to enter their card details on the gateway shown — do not call confirm_order for card payments.",
        };
      }
      const orderNumber = cart.confirmOrder();
      return { ...summarize(cart), order_number: orderNumber };
    },
    resume_ordering: () => {
      cart.setStage("ordering");
      return summarize(cart);
    },
    handoff_to_crew: ({ reason, kind }) => {
      const k = (HANDOFF_KINDS as string[]).includes(String(kind)) ? (String(kind) as HandoffKind) : "prank";
      ui.onHandoff?.(String(reason ?? "Needs a live agent"), k);
      return {
        handed_off: true,
        say: 'One short, polite line and nothing more – no answer to their question, no comment on what they said. Tagalog: "Sandali lang po, ikokonekta ko kayo sa aming crew." English: "One moment please, I\'ll connect you with our crew." Don\'t take any more of the order; a crew member is taking over.',
      };
    },
    clear_cart: () => {
      cart.clearCart();
      return { cleared: true };
    },
  };
}
