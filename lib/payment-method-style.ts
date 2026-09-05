// Colour by payment method, so CASH and GCASH are distinguishable at a
// glance rather than by reading a word.
//
// Owner report (2026-09-05): "the staff still having a hard time
// sometimes and still makes mistakes." The settlement picker was already
// built to make a wrong tap loud — two big buttons, nothing preselected,
// a "Settling PHP 350 as CASH" confirmation line — and mistakes still
// happen, because both buttons look identical until you read them.
//
// Colour is the layer that works at a glance and under time pressure:
//   CASH   light pink
//   GCASH  light blue
//
// Keyed on PaymentMethod.key, NOT on label or position. Labels are
// editable and order is not guaranteed; the key is the stable identity.
// Anything else falls back to neutral rather than guessing a colour,
// so adding a third method never silently borrows cash's pink.
export interface PaymentMethodStyle {
  /** Filled treatment, for the selected state. */
  selected: string;
  /** Tinted outline, for the unselected state. */
  idle: string;
  /** Small inline badge, for lists and tables. */
  badge: string;
}

const NEUTRAL: PaymentMethodStyle = {
  selected: "bg-slate-500 text-white hover:bg-slate-500",
  idle: "border-slate-300 text-slate-700 hover:bg-slate-100",
  badge: "bg-slate-100 text-slate-700 border-slate-300",
};

const BY_KEY: Record<string, PaymentMethodStyle> = {
  CASH: {
    selected: "bg-pink-300 text-pink-950 hover:bg-pink-300 border-pink-400",
    idle: "border-pink-300 text-pink-700 hover:bg-pink-50 dark:text-pink-300 dark:hover:bg-pink-950/40",
    badge: "bg-pink-100 text-pink-900 border-pink-300",
  },
  GCASH: {
    selected: "bg-sky-300 text-sky-950 hover:bg-sky-300 border-sky-400",
    idle: "border-sky-300 text-sky-700 hover:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-950/40",
    badge: "bg-sky-100 text-sky-900 border-sky-300",
  },
};

export function paymentMethodStyle(key: string | null | undefined): PaymentMethodStyle {
  return (key && BY_KEY[key]) || NEUTRAL;
}
