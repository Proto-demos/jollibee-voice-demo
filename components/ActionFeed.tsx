"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ActionCard } from "@/lib/voice/useRealtimeVoice";
import type { UpsellSuggestion } from "@/lib/voice/tools";
import { MenuThumb } from "./MenuThumb";
import { formatPeso, modifierLabel, type CartLine } from "@/lib/cart";
import { findAddon, findOrderable } from "@/lib/menu";

type ChangeKind = "added" | "qty" | "removed";

const BADGE: Record<ChangeKind, string> = {
  added: "✓ Idinagdag",
  qty: "✎ Binago",
  removed: "✕ Inalis",
};

/** One product in the order, with its add-ons and picked drinks summed across its copies. */
interface OrderGroup {
  refId: string;
  title: string;
  qty: number;
  price: number;
  image?: string;
  addons: Array<{ label: string; copies: number; price: number; included?: boolean }>;
}

/** A combo can sit on several cart lines (Coke, Sprite, upsized…): one card per product. */
function groupLines(lines: CartLine[]): OrderGroup[] {
  const groups = new Map<string, OrderGroup>();
  for (const line of lines) {
    const product = findOrderable(line.refId)?.data;
    const key = line.refId;
    const group = groups.get(key) ?? {
      refId: key,
      title: product?.name ?? line.name,
      qty: 0,
      price: product?.price ?? line.unitPrice,
      image: product?.image,
      addons: [],
    };
    group.qty += line.qty;
    // The picked drink reads as one line ("Sprite"); paid add-ons each get their own.
    const picks = line.modifiers.filter((id) => findAddon(id)?.category === "choice");
    const rows = [
      ...(picks.length ? [{ label: modifierLabel({ modifiers: picks, refId: line.refId }), price: 0, included: true }] : []),
      ...line.modifiers
        .map((id) => findAddon(id))
        .filter((a): a is NonNullable<typeof a> => Boolean(a) && a!.category !== "choice")
        .map((a) => ({ label: a.shortName ?? a.name, price: a.price, included: false })),
    ];
    for (const row of rows) {
      const existing = group.addons.find((a) => a.label === row.label);
      if (existing) existing.copies += line.qty;
      else group.addons.push({ ...row, copies: line.qty });
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

const addonCopies = (g: OrderGroup) => g.addons.reduce((n, a) => n + a.copies, 0);

/** Removed items stay on screen as "Inalis" briefly, then fade out and leave. */
interface Ghost {
  group: OrderGroup;
  index: number;
  leaving: boolean;
}

/**
 * The stage shows the whole order — one card per product, its drink and
 * upsize nested underneath — plus whatever Joy is browsing (bestsellers / a
 * list) and her current offer. The card that changed last carries a badge and
 * stays bright; removed items fade out after a moment.
 */
export function ActionFeed({
  actions,
  lines,
  suggestion,
  morphKeys,
}: {
  actions: ActionCard[];
  lines: CartLine[];
  suggestion: UpsellSuggestion | undefined;
  /** Order cards that took over an accepted offer card's key, so it morphs in place. */
  morphKeys: Record<string, string>;
}) {
  const browse = actions.filter((c) => c.kind === "bestsellers" || c.kind === "options").at(-1);
  const groups = useMemo(() => groupLines(lines), [lines]);

  // Work out what changed since the last order, during render (React's
  // "adjust state when props change" pattern): a removed card must turn into
  // its "Inalis" ghost in the same frame, or it would flash off and back on.
  const [prevGroups, setPrevGroups] = useState(groups);
  const [latest, setLatest] = useState<{ refId: string; kind: ChangeKind } | null>(null);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  if (groups !== prevGroups) {
    const before = new Map(prevGroups.map((g) => [g.refId, g]));
    const after = new Map(groups.map((g) => [g.refId, g]));
    let change: { refId: string; kind: ChangeKind } | null = null;
    for (const g of groups) {
      const old = before.get(g.refId);
      if (!old || g.qty > old.qty || addonCopies(g) > addonCopies(old)) change = { refId: g.refId, kind: "added" };
      else if (g.qty !== old.qty || addonCopies(g) !== addonCopies(old)) change = { refId: g.refId, kind: "qty" };
    }
    const gone = prevGroups
      .map((group, index) => ({ group, index, leaving: false }))
      .filter((g) => !after.has(g.group.refId));
    // A pure removal is the change to show; when something was also added
    // (e.g. a solo item upgraded into a combo), the new card takes the badge.
    if (gone.length && change?.kind !== "added") change = { refId: gone[gone.length - 1].group.refId, kind: "removed" };
    setPrevGroups(groups);
    if (change) setLatest(change);
    if (gone.length) setGhosts((prev) => [...prev.filter((g) => !after.has(g.group.refId)), ...gone]);
    // Something re-added before its ghost left: drop the ghost.
    if (ghosts.some((g) => after.has(g.group.refId))) setGhosts((prev) => prev.filter((g) => !after.has(g.group.refId)));
  }

  // Ghosts fade after ~1.2s, then leave.
  const scheduled = useRef(new Set<string>());
  useEffect(() => {
    for (const ghost of ghosts) {
      const id = ghost.group.refId;
      if (scheduled.current.has(id)) continue;
      scheduled.current.add(id);
      setTimeout(() => setGhosts((prev) => prev.map((g) => (g.group.refId === id ? { ...g, leaving: true } : g))), 1200);
      setTimeout(() => {
        setGhosts((prev) => prev.filter((g) => g.group.refId !== id));
        scheduled.current.delete(id);
      }, 1600);
    }
  }, [ghosts]);

  // Live cards in order, ghosts slotted back where they were.
  const cards: Array<{ group: OrderGroup; ghost?: Ghost }> = groups.map((group) => ({ group }));
  for (const ghost of [...ghosts].sort((a, b) => a.index - b.index)) {
    cards.splice(Math.min(ghost.index, cards.length), 0, { group: ghost.group, ghost });
  }

  return (
    <div className="relative z-10 w-full max-w-md flex flex-col gap-3">
      {browse && <BrowseCard key={browse.id} card={browse} dimmed={cards.length > 0 || Boolean(suggestion)} />}
      {[
        ...cards.map(({ group, ghost }) => {
          // The item that changed last keeps its badge and stays bright, even
          // while Joy pitches the next thing below it.
          const isLatest = latest?.refId === group.refId;
          const kind: ChangeKind | undefined = ghost ? "removed" : isLatest ? latest?.kind : undefined;
          return (
            <LineCard
              key={ghost ? `ghost-${group.refId}` : (morphKeys[group.refId] ?? `line-${group.refId}`)}
              group={ghost ? { ...group, addons: [] } : group}
              kind={kind}
              leaving={ghost?.leaving}
              dimmed={!isLatest && !ghost}
            />
          );
        }),
        // Same list as the order cards: an accepted offer's card is reused by
        // the item it became (via morphKeys), so it transitions in place.
        suggestion && <LineCard key={`offer-${suggestion.cardId ?? suggestion.refId}`} offer={suggestion} />,
      ]}
    </div>
  );
}

/** Bestsellers / the products Joy is naming, as a white card on the red stage. */
function BrowseCard({ card, dimmed }: { card: ActionCard; dimmed: boolean }) {
  return (
    <div
      className={`card-in bg-white text-foreground rounded-2xl px-4 pt-3.5 pb-4 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.45)] transition-opacity ${
        dimmed ? "opacity-80" : ""
      }`}
    >
      <p className="font-extrabold text-[15px] tracking-[-0.01em] text-jb-red-dark pb-2 border-b border-[#EDE7DD]">
        {card.title}
      </p>
      <div className="grid grid-cols-3 gap-x-3 gap-y-3.5 pt-3.5">
        {card.items?.map((item) => (
          <div key={item.name} className="flex flex-col items-center text-center">
            {item.image && (
              <MenuThumb
                src={item.image}
                alt={item.name}
                category="combos"
                className={`${
                  (card.items?.length ?? 0) > 3 ? "w-[60px] h-[60px]" : "w-[72px] h-[72px]"
                } rounded-full bg-background`}
              />
            )}
            <p className="mt-2 font-semibold text-[12px] leading-snug line-clamp-2">{item.name}</p>
            <p className="mt-0.5 text-[11.5px] font-bold text-jb-red">{formatPeso(item.price)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One card for an order item and for Joy's offer, so an accepted offer
 * transitions in place: the yellow "Recommended" ring and pill turn into the
 * red "Idinagdag" badge, and the price stays where it is.
 */
function LineCard({
  group,
  offer,
  kind,
  leaving = false,
  dimmed = false,
}: {
  group?: OrderGroup;
  offer?: UpsellSuggestion;
  kind?: ChangeKind;
  leaving?: boolean;
  dimmed?: boolean;
}) {
  const isOffer = Boolean(offer);
  const removed = kind === "removed";
  const title = offer?.name ?? group?.title ?? "";
  const image = offer?.image ?? group?.image;
  const qty = group?.qty;
  const unit = offer?.price ?? group?.price;
  const amount = unit !== undefined && !removed ? unit * (isOffer ? 1 : qty ?? 1) : undefined;
  const badge = offer?.choices ? "Saan ilalagay?" : isOffer ? "★ Recommended ni Joy" : kind ? BADGE[kind] : null;

  return (
    <div
      className={`${leaving ? "card-out" : "card-in"} bg-white text-foreground rounded-2xl px-3.5 py-3 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.45)] ring-2 transition-[opacity,box-shadow,transform] duration-500 ease-out ${
        isOffer ? "ring-jb-yellow scale-[1.02]" : "ring-transparent"
      } ${dimmed ? "opacity-75" : ""}`}
    >
      <div className="flex items-center gap-3">
        {image ? (
          <MenuThumb src={image} alt={title} category="combos" className="w-[52px] h-[52px] rounded-full bg-background shrink-0" />
        ) : (
          <span className="w-[52px] h-[52px] rounded-full bg-jb-red/10 text-jb-red flex items-center justify-center text-xl shrink-0">
            {removed ? "✕" : isOffer ? "★" : "✓"}
          </span>
        )}
        <span className="min-w-0 flex-1">
          {badge && (
            <span
              key={badge}
              className={`badge-in inline-block mb-1 text-[10px] font-semibold uppercase tracking-wider rounded-full px-2 py-0.5 ${
                isOffer
                  ? "bg-jb-yellow text-jb-red-dark"
                  : removed
                    ? "bg-neutral-200 text-neutral-600"
                    : "bg-jb-red text-white"
              }`}
            >
              {badge}
            </span>
          )}
          <span
            className={`block font-bold text-[14px] leading-tight truncate ${
              removed ? "text-neutral-500 line-through" : ""
            }`}
          >
            {qty && qty > 1 ? `${qty}× ` : ""}
            {title}
          </span>
        </span>
        {amount !== undefined && (
          <span className="text-right shrink-0 leading-tight">
            <span className="block font-bold text-[14px]">{formatPeso(amount)}</span>
            {offer?.choices ? (
              <span className="block text-[11px] text-neutral-500 mt-0.5">bawat isa</span>
            ) : isOffer ? (
              <span key="hint" className="badge-in inline-block mt-1 rounded-full bg-jb-red text-white font-semibold text-[11px] px-2.5 py-0.5">
                &ldquo;sige&rdquo; o &ldquo;oo&rdquo;
              </span>
            ) : qty && qty > 1 && unit !== undefined ? (
              <span className="block text-[11px] text-neutral-500 mt-0.5">
                {qty} × {formatPeso(unit)}
              </span>
            ) : null}
          </span>
        )}
      </div>

      {/* Which combos? Joy is asking — the options, under the upsize */}
      {offer?.choices && (
        <div className="mt-2 ml-[64px] flex flex-wrap gap-1.5">
          {offer.choices.map((choice) => (
            <span
              key={choice}
              className="badge-in rounded-full border border-jb-red/40 bg-white px-2.5 py-1 text-[12px] font-semibold"
            >
              {choice}
            </span>
          ))}
        </div>
      )}

      {/* The picked drink and the upsize sit under their combo (indented past
          the photo, prices in the same column as the combo's), each popping in when added. */}
      {group && group.addons.length > 0 && (
        <ul className="mt-2 ml-[64px] pt-2 border-t border-dashed border-[#E5DACB] space-y-1">
          {group.addons.map((a) => (
            <li key={`${a.label}-${a.copies}`} className="badge-in flex items-baseline justify-between gap-3 text-[12.5px]">
              <span className="min-w-0">
                <span className="text-jb-red font-bold">+</span> {a.label}
                {group.qty > 1 && (
                  <span className="text-neutral-500">
                    {" "}
                    · {a.copies}×
                  </span>
                )}
              </span>
              <span className="shrink-0 font-semibold">{a.price ? `+${formatPeso(a.price * a.copies)}` : a.included ? "Kasama" : "Libre"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
