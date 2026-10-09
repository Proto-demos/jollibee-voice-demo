export type CategoryId =
  | "combos"
  | "chicken"
  | "burgers"
  | "spaghetti-palabok"
  | "ricemeals"
  | "sandwiches"
  | "sides"
  | "desserts"
  | "beverages"
  | "kids";

export interface Category {
  id: CategoryId;
  label: string;
  labelTl: string;
}

export interface MenuItem {
  id: string;
  name: string;
  nameTl?: string;
  description: string;
  category: CategoryId;
  price: number;
  image: string;
  tags?: Array<"bestseller" | "new" | "spicy">;
  /** Comes with a drink (Kids Meals) — counts as having a drink. */
  includesDrink?: boolean;
  /** What the customer picks for ONE of these — e.g. a Kids Meal: 1 drink. */
  choose?: Partial<Record<ChoiceKind, number>>;
  /** Addon ids suggested when this item is ordered (grounds upsell offers). */
  addonIds?: string[];
  /** Can be upgraded into a combo/meal by adding a drink + side. */
  comboEligible?: boolean;
}

/** The included things a customer picks for a combo or meal: at Jollibee, just the drink. */
export type ChoiceKind = "drinks";
export const CHOICE_PREFIX: Record<ChoiceKind, string> = { drinks: "drink-" };
export const CHOICE_KINDS: ChoiceKind[] = ["drinks"];
export function choiceKindOf(id: string): ChoiceKind | undefined {
  return CHOICE_KINDS.find((k) => id.startsWith(CHOICE_PREFIX[k]));
}

export interface Addon {
  id: string;
  name: string;
  price: number;
  /**
   * "upsize" goes on specific combos and meals; "choice" is the drink picked
   * for a combo or meal (no charge); "side", "dessert" and "drink" are items
   * of their own.
   */
  category: "upsize" | "extra" | "choice" | "side" | "dessert" | "drink";
  /** Reuses the matching menu item's photo where one exists. */
  image?: string;
  /** Short appetising sell-line Joy uses when pitching this add-on. */
  pitch?: string;
  /** For sides, desserts and drinks: the menu item it really is, so it lands in the order as that item. */
  itemId?: string;
  /** How it reads under an item, e.g. "Sprite". */
  shortName?: string;
}

/** The drink upsize attaches to specific combos and meals; sides, desserts and drinks are their own lines. */
export function isPerItemAddon(addon: Addon): boolean {
  return addon.category === "upsize" || addon.category === "extra";
}

/** Menu categories whose items can take per-item add-ons (drink upsize). Combos always can. */
export const CUSTOMISABLE_CATEGORIES: CategoryId[] = ["combos", "kids"];

/** The drink upsize on combos and meals. */
export const UPSIZE_ADDON = "addon-upsize-drink";

export interface Combo {
  id: string;
  name: string;
  description: string;
  /** What's in it: the main item first, then the side, then the drink (the customer picks the drink). */
  itemIds: string[];
  /** Other items that can be made into this combo ("gawin na nating combo"), e.g. a 1-pc Chickenjoy Solo. */
  upgradeFrom?: string[];
  price: number;
  image: string;
  tags?: Array<"bestseller" | "new">;
  /** Comes with a drink — counts as having a drink. */
  includesDrink?: boolean;
  /** What the customer picks for ONE combo: its drink. */
  choose?: Partial<Record<ChoiceKind, number>>;
  /** Addon ids suggested when this combo is ordered (grounds upsell offers). */
  addonIds?: string[];
}

export const CATEGORIES: Category[] = [
  { id: "combos", label: "Combos & Meals", labelTl: "Mga Combo" },
  { id: "chicken", label: "Chickenjoy", labelTl: "Chickenjoy" },
  { id: "burgers", label: "Burgers", labelTl: "Burger" },
  { id: "spaghetti-palabok", label: "Spaghetti & Palabok", labelTl: "Spaghetti't Palabok" },
  { id: "ricemeals", label: "Rice Meals", labelTl: "Rice Meals" },
  { id: "sandwiches", label: "Sandwiches", labelTl: "Sandwiches" },
  { id: "sides", label: "Fries & Sides", labelTl: "Fries at Sides" },
  { id: "desserts", label: "Desserts & Pies", labelTl: "Panghimagas" },
  { id: "beverages", label: "Beverages", labelTl: "Inumin" },
  { id: "kids", label: "Kids Meal", labelTl: "Kids Meal" },
];

export const ADDONS: Addon[] = [
  { id: "addon-upsize-drink", name: "Upsize Drink", shortName: "Upsized drink", price: 15, category: "upsize", image: "/menu/addon-upsize-drink.png", pitch: "I-upsize na natin ang drink – mas sulit, ₱15 lang ang dagdag" },
  { id: "addon-coke-regular", name: "Coke Regular", itemId: "coke-regular", price: 45, category: "drink", image: "/menu/coke-regular.png", pitch: "Ice-cold Coke — panghugas ng crispy Chickenjoy" },
  { id: "addon-coke-float", name: "Coke Float", itemId: "coke-float", price: 60, category: "drink", image: "/menu/coke-float.png", pitch: "Coke Float — may creamy vanilla ice cream sa ibabaw, paborito ng lahat" },
  { id: "addon-iced-tea", name: "Iced Tea", itemId: "iced-tea", price: 45, category: "drink", image: "/menu/iced-tea.png", pitch: "House-blend iced tea, panlaban sa init" },
  { id: "addon-fries-regular", name: "Regular Fries", itemId: "fries-regular", price: 55, category: "side", image: "/menu/fries-regular.png", pitch: "Crispy golden fries, bagong luto" },
  { id: "addon-gravy", name: "Extra Gravy", price: 25, category: "side", image: "/menu/gravy.png", pitch: "Extra gravy – yung sikat na Jollibee gravy, para sawsawan hanggang huling kagat" },
  { id: "addon-peach-mango-pie", name: "Peach-Mango Pie", itemId: "peach-mango-pie", price: 45, category: "dessert", image: "/menu/peach-mango-pie.png", pitch: "Mainit-init at crispy pa, may sweet peach-mango filling — perfect pang-dessert" },
  { id: "addon-sundae-chocolate", name: "Chocolate Sundae", itemId: "chocolate-sundae", price: 49, category: "dessert", image: "/menu/chocolate-sundae.png", pitch: "Creamy vanilla sundae na may chocolate syrup — pampatamis ng araw" },
  // The drink that comes with a combo or Kids Meal, picked by the customer (no charge).
  { id: "drink-coke", name: "Coke (meal drink)", shortName: "Coke", price: 0, category: "choice", image: "/menu/coke-regular.png" },
  { id: "drink-coke-zero", name: "Coke Zero (meal drink)", shortName: "Coke Zero", price: 0, category: "choice", image: "/menu/coke-zero.png" },
  { id: "drink-sprite", name: "Sprite (meal drink)", shortName: "Sprite", price: 0, category: "choice", image: "/menu/sprite.png" },
  { id: "drink-royal", name: "Royal (meal drink)", shortName: "Royal", price: 0, category: "choice", image: "/menu/royal.png" },
  { id: "drink-iced-tea", name: "Iced Tea (meal drink)", shortName: "Iced Tea", price: 0, category: "choice", image: "/menu/iced-tea.png" },
  { id: "drink-pineapple-juice", name: "Pineapple Juice (meal drink)", shortName: "Pineapple Juice", price: 0, category: "choice", image: "/menu/pineapple-juice.png" },
];

/** The choices of one kind, e.g. every drink a combo can come with. */
export function choicesOf(kind: ChoiceKind) {
  return ADDONS.filter((a) => a.category === "choice" && a.id.startsWith(CHOICE_PREFIX[kind]));
}

/** A drink ordered on its own that is also a combo drink, so a combo upgrade can take it in. */
export const MEAL_DRINK_OF: Record<string, string> = {
  "coke-regular": "drink-coke",
  "iced-tea": "drink-iced-tea",
};

// Upsell lists by kind of item (first = pitched first; a combo upgrade, when
// there is one, comes before all of these — see list_addons_for_item).
const CHICKEN = ["addon-coke-regular", "addon-gravy", "addon-fries-regular", "addon-peach-mango-pie"];
const BURGER = ["addon-coke-regular", "addon-fries-regular", "addon-peach-mango-pie", "addon-sundae-chocolate"];
const PASTA = ["addon-coke-regular", "addon-peach-mango-pie", "addon-sundae-chocolate"];
const RICE_MEAL = ["addon-coke-regular", "addon-gravy", "addon-peach-mango-pie"];
const SIDE = ["addon-coke-regular", "addon-peach-mango-pie"];
const DESSERT = ["addon-coke-float"];
const DRINK = ["addon-peach-mango-pie", "addon-sundae-chocolate"];
const COMBO = ["addon-upsize-drink", "addon-peach-mango-pie", "addon-sundae-chocolate"];
const CHICKEN_COMBO = ["addon-upsize-drink", "addon-gravy", "addon-peach-mango-pie", "addon-sundae-chocolate"];
const KIDS = ["addon-upsize-drink", "addon-peach-mango-pie", "addon-sundae-chocolate"];

export const MENU_ITEMS: MenuItem[] = [
  // Chickenjoy
  {
    id: "chickenjoy-1pc-solo",
    name: "1-pc Chickenjoy Solo",
    nameTl: "1-pc Chickenjoy",
    description: "Jollibee's signature crispy-juicy fried chicken, one piece.",
    category: "chicken",
    price: 98,
    image: "/menu/chickenjoy-1pc-solo.png",
    tags: ["bestseller"],
    addonIds: CHICKEN,
    comboEligible: true,
  },
  {
    id: "chickenjoy-2pc-solo",
    name: "2-pc Chickenjoy Solo",
    description: "Two pieces of Jollibee's crispy-juicy fried chicken.",
    category: "chicken",
    price: 189,
    image: "/menu/chickenjoy-2pc-solo.png",
    addonIds: CHICKEN,
    comboEligible: true,
  },
  {
    id: "chickenjoy-1pc-rice",
    name: "1-pc Chickenjoy w/ Rice",
    description: "One piece Chickenjoy served with a cup of steamed rice and gravy.",
    category: "chicken",
    price: 116,
    image: "/menu/chickenjoy-1pc-rice.png",
    tags: ["bestseller"],
    addonIds: RICE_MEAL,
    comboEligible: true,
  },
  // Burgers
  {
    id: "yumburger",
    name: "Yumburger",
    description: "Jollibee's classic burger with savory beef patty and sweet-style sauce.",
    category: "burgers",
    price: 39,
    image: "/menu/yumburger.png",
    addonIds: BURGER,
    comboEligible: true,
  },
  {
    id: "cheesy-yumburger",
    name: "Cheesy Yumburger",
    description: "The Yumburger topped with a slice of melted cheese.",
    category: "burgers",
    price: 59,
    image: "/menu/cheesy-yumburger.png",
    tags: ["bestseller"],
    addonIds: BURGER,
    comboEligible: true,
  },
  {
    id: "champ",
    name: "Champ Burger",
    description: "A big, juicy 100% pure beef burger stacked with fresh lettuce and tomato.",
    category: "burgers",
    price: 135,
    image: "/menu/champ.png",
    addonIds: BURGER,
    comboEligible: true,
  },
  // Spaghetti & Palabok
  {
    id: "jolly-spaghetti-solo",
    name: "Jolly Spaghetti Solo",
    description: "Sweet-style spaghetti with chunky ham, ground beef, and hotdog slices.",
    category: "spaghetti-palabok",
    price: 65,
    image: "/menu/jolly-spaghetti-solo.png",
    tags: ["bestseller"],
    addonIds: PASTA,
    comboEligible: true,
  },
  {
    id: "palabok-fiesta-solo",
    name: "Palabok Fiesta Solo",
    description: "Rice noodles in a savory shrimp-flavored sauce, topped with egg and chicharon.",
    category: "spaghetti-palabok",
    price: 68,
    image: "/menu/palabok-fiesta-solo.png",
    addonIds: PASTA,
    comboEligible: true,
  },
  // Rice meals
  {
    id: "burger-steak-1pc-rice",
    name: "1-pc Burger Steak w/ Rice",
    description: "Beef patty smothered in mushroom gravy, served with rice.",
    category: "ricemeals",
    price: 99,
    image: "/menu/burger-steak-1pc-rice.png",
    addonIds: RICE_MEAL,
    comboEligible: true,
  },
  {
    id: "chicken-fillet-rice",
    name: "Chicken Fillet w/ Rice",
    description: "Breaded chicken fillet steak, served with rice and gravy.",
    category: "ricemeals",
    price: 109,
    image: "/menu/chicken-fillet-rice.png",
    addonIds: RICE_MEAL,
    comboEligible: true,
  },
  // Sandwiches
  {
    id: "chicken-sandwich",
    name: "Crunchy Chicken Sandwich",
    description: "Crispy breaded chicken fillet on a toasted bun with mayo.",
    category: "sandwiches",
    price: 79,
    image: "/menu/chicken-sandwich.png",
    tags: ["new"],
    addonIds: BURGER,
    comboEligible: true,
  },
  {
    id: "jolly-hotdog",
    name: "Cheesy Classic Jolly Hotdog",
    description: "All-beef hotdog on a soft bun, topped with cheese sauce.",
    category: "sandwiches",
    price: 55,
    image: "/menu/jolly-hotdog.png",
    addonIds: BURGER,
    comboEligible: true,
  },
  // Sides
  {
    id: "fries-regular",
    name: "Regular Fries",
    description: "Crispy golden fries, lightly salted.",
    category: "sides",
    price: 55,
    image: "/menu/fries-regular.png",
    addonIds: SIDE,
  },
  {
    id: "chicken-nuggets-6pc",
    name: "6-pc Chicken Nuggets",
    description: "Bite-sized breaded chicken nuggets, served with gravy dip.",
    category: "sides",
    price: 99,
    image: "/menu/chicken-nuggets-6pc.png",
    addonIds: ["addon-coke-regular", "addon-gravy", "addon-fries-regular"],
  },
  {
    id: "mashed-potato",
    name: "Mashed Potato",
    description: "Creamy mashed potato topped with savory gravy.",
    category: "sides",
    price: 49,
    image: "/menu/mashed-potato.png",
    addonIds: ["addon-coke-regular", "addon-gravy"],
  },
  // Desserts
  {
    id: "peach-mango-pie",
    name: "Peach-Mango Pie",
    description: "Crispy fried pie filled with sweet peach-mango filling.",
    category: "desserts",
    price: 45,
    image: "/menu/peach-mango-pie.png",
    tags: ["bestseller"],
    addonIds: DESSERT,
  },
  {
    id: "halo-halo",
    name: "Halo-Halo",
    description: "Shaved ice dessert with mixed sweet beans, fruits, leche flan, and ube ice cream.",
    category: "desserts",
    price: 89,
    image: "/menu/halo-halo.png",
    tags: ["new"],
    addonIds: ["addon-peach-mango-pie"],
  },
  {
    id: "chocolate-sundae",
    name: "Chocolate Sundae",
    description: "Soft-serve vanilla ice cream topped with rich chocolate syrup.",
    category: "desserts",
    price: 49,
    image: "/menu/chocolate-sundae.png",
    addonIds: ["addon-peach-mango-pie"],
  },
  // Beverages
  {
    id: "coke-regular",
    name: "Coke Regular",
    description: "Ice-cold Coca-Cola.",
    category: "beverages",
    price: 45,
    image: "/menu/coke-regular.png",
    addonIds: DRINK,
  },
  {
    id: "coke-float",
    name: "Coke Float",
    description: "Coca-Cola topped with a scoop of soft-serve vanilla ice cream.",
    category: "beverages",
    price: 60,
    image: "/menu/coke-float.png",
    tags: ["bestseller"],
    addonIds: DRINK,
  },
  {
    id: "iced-tea",
    name: "Iced Tea",
    description: "House-blend iced tea.",
    category: "beverages",
    price: 45,
    image: "/menu/iced-tea.png",
    addonIds: DRINK,
  },
  // Kids
  {
    id: "kids-meal-chickenjoy",
    name: "Kids Meal: 1-pc Chickenjoy",
    description: "1-pc Chickenjoy with rice, a small drink, and a toy.",
    category: "kids",
    price: 129,
    image: "/menu/kids-meal-chickenjoy.png",
    includesDrink: true,
    choose: { drinks: 1 },
    addonIds: KIDS,
  },
  {
    id: "kids-meal-spaghetti",
    name: "Kids Meal: Jolly Spaghetti",
    description: "Jolly Spaghetti with a small drink and a toy.",
    category: "kids",
    price: 109,
    image: "/menu/kids-meal-spaghetti.png",
    includesDrink: true,
    choose: { drinks: 1 },
    addonIds: KIDS,
  },
];

// Every combo comes with a regular drink the customer picks (Coke, Coke
// Zero, Sprite, Royal, Iced Tea or Pineapple Juice) and can be upsized.
const withDrink = { includesDrink: true, choose: { drinks: 1 } };

export const COMBOS: Combo[] = [
  {
    id: "combo-chickenjoy-1pc",
    name: "1-pc Chickenjoy Combo",
    description: "1-pc Chickenjoy w/ Rice, Regular Fries, and a regular drink of your choice.",
    itemIds: ["chickenjoy-1pc-rice", "fries-regular", "coke-regular"],
    upgradeFrom: ["chickenjoy-1pc-solo"],
    price: 179,
    image: "/menu/combo-chickenjoy-1pc.png",
    tags: ["bestseller"],
    ...withDrink,
    addonIds: CHICKEN_COMBO,
  },
  {
    id: "combo-chickenjoy-2pc",
    name: "2-pc Chickenjoy Combo",
    description: "2-pc Chickenjoy Solo, Regular Fries, and a regular drink of your choice.",
    itemIds: ["chickenjoy-2pc-solo", "fries-regular", "coke-regular"],
    price: 259,
    image: "/menu/combo-chickenjoy-2pc.png",
    ...withDrink,
    addonIds: CHICKEN_COMBO,
  },
  {
    id: "combo-cheesy-yumburger",
    name: "Cheesy Yumburger Combo",
    description: "Cheesy Yumburger, Regular Fries, and a regular drink of your choice.",
    itemIds: ["cheesy-yumburger", "fries-regular", "coke-regular"],
    price: 129,
    image: "/menu/combo-cheesy-yumburger.png",
    tags: ["bestseller"],
    ...withDrink,
    addonIds: COMBO,
  },
  {
    id: "combo-champ",
    name: "Champ Combo",
    description: "Champ Burger, Regular Fries, and a regular drink of your choice.",
    itemIds: ["champ", "fries-regular", "coke-regular"],
    price: 199,
    image: "/menu/combo-champ.png",
    ...withDrink,
    addonIds: COMBO,
  },
  {
    id: "combo-jolly-spaghetti",
    name: "Jolly Spaghetti Combo",
    description: "Jolly Spaghetti, a slice of Peach-Mango Pie, and a regular drink of your choice.",
    itemIds: ["jolly-spaghetti-solo", "peach-mango-pie", "coke-regular"],
    price: 139,
    image: "/menu/combo-jolly-spaghetti.png",
    tags: ["new"],
    ...withDrink,
    addonIds: ["addon-upsize-drink", "addon-sundae-chocolate"],
  },
  {
    id: "combo-chicken-sandwich",
    name: "Crunchy Chicken Sandwich Combo",
    description: "Crunchy Chicken Sandwich, Regular Fries, and a regular drink of your choice.",
    itemIds: ["chicken-sandwich", "fries-regular", "coke-regular"],
    price: 159,
    image: "/menu/combo-chicken-sandwich.png",
    tags: ["new"],
    ...withDrink,
    addonIds: COMBO,
  },
];

/** The item or combo a line orders — whichever the id is. */
export function findProduct(id: string): MenuItem | Combo | undefined {
  return findMenuItem(id) ?? findCombo(id);
}

/** The combos an ordered item can become ("gawin na nating combo"): its own combo, or the one it upgrades into. */
export function combosForItem(itemId: string): Combo[] {
  return COMBOS.filter((c) => c.itemIds[0] === itemId || c.upgradeFrom?.includes(itemId));
}

/** True when the order already has a drink — a drink item, or a combo/meal that comes with one. */
export function hasDrinkIn(lines: Array<{ refId: string }>): boolean {
  return lines.some((l) => {
    const i = findMenuItem(l.refId);
    return i?.category === "beverages" || Boolean(i?.includesDrink) || Boolean(findCombo(l.refId)?.includesDrink);
  });
}

/**
 * The three bestsellers featured in Joy's greeting AND on the welcome card —
 * one list so what she says always matches what's on screen.
 */
export function getFeaturedBestsellers(): Array<{ name: string; price: number; image: string }> {
  const combos = COMBOS.filter((c) => c.tags?.includes("bestseller")).map((c) => ({
    name: c.name,
    price: c.price,
    image: c.image,
  }));
  const items = MENU_ITEMS.filter((i) => i.tags?.includes("bestseller")).map((i) => ({
    name: i.name,
    price: i.price,
    image: i.image,
  }));
  return [...combos, ...items].slice(0, 3);
}

export function findMenuItem(id: string): MenuItem | undefined {
  return MENU_ITEMS.find((item) => item.id === id);
}

export function findCombo(id: string): Combo | undefined {
  return COMBOS.find((combo) => combo.id === id);
}

export function findAddon(id: string): Addon | undefined {
  return ADDONS.find((addon) => addon.id === id);
}

/** Any orderable line — a single item or a combo — looked up by id. */
export function findOrderable(
  id: string
): { kind: "item"; data: MenuItem } | { kind: "combo"; data: Combo } | { kind: "addon"; data: Addon } | undefined {
  const item = findMenuItem(id);
  if (item) return { kind: "item", data: item };
  const combo = findCombo(id);
  if (combo) return { kind: "combo", data: combo };
  const addon = findAddon(id);
  if (addon) return { kind: "addon", data: addon };
  return undefined;
}
