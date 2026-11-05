export interface Category {
  id: string;
  label: string;
  emoji: string;
  color: string;
}

export const CATEGORIES: Category[] = [
  { id: "cafe", label: "Kavárna", emoji: "☕", color: "#8d5524" },
  { id: "restaurant", label: "Restaurace", emoji: "🍽️", color: "#e4572e" },
  { id: "bar", label: "Bar", emoji: "🍸", color: "#9b5de5" },
  { id: "bakery", label: "Cukrárna a pekárna", emoji: "🧁", color: "#d63384" },
  { id: "nature", label: "Příroda", emoji: "🌲", color: "#2a9d8f" },
  { id: "viewpoint", label: "Vyhlídka", emoji: "🌄", color: "#e76f51" },
  { id: "sight", label: "Památka", emoji: "🏛️", color: "#577590" },
  { id: "museum", label: "Muzeum a galerie", emoji: "🖼️", color: "#4361ee" },
  { id: "beach", label: "Pláž a koupání", emoji: "🏖️", color: "#0096c7" },
  { id: "activity", label: "Zážitek", emoji: "🎢", color: "#c9184a" },
  { id: "shop", label: "Obchod", emoji: "🛍️", color: "#118a7e" },
  { id: "stay", label: "Ubytování", emoji: "🛏️", color: "#6c757d" },
  { id: "other", label: "Jiné", emoji: "📍", color: "#343a40" },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export function categoryOf(id: string): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}
