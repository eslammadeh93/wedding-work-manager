import React from 'react';
import { DollarSign, List, UserRound } from 'lucide-react';
import { OrderSource } from '../../types';

interface OrderSourceBadgeProps {
  source?: OrderSource;
  language: 'ar' | 'en';
  compact?: boolean;
}

/** Keeps lead-source wording, fallback behaviour, iconography, and colours identical everywhere. */
export const getOrderSource = (source?: OrderSource): OrderSource =>
  source === 'organic' || source === 'campaign' || source === 'other' ? source : 'other';

export const getOrderSourceLabel = (source: OrderSource | undefined, language: 'ar' | 'en') => {
  const labels: Record<OrderSource, { ar: string; en: string }> = {
    campaign: { ar: 'كامبين', en: 'Campaign' },
    organic: { ar: 'أورجانيك', en: 'Organic' },
    other: { ar: 'أخرى', en: 'Other' },
  };
  return labels[getOrderSource(source)][language];
};

export const OrderSourceBadge: React.FC<OrderSourceBadgeProps> = ({ source, language, compact = false }) => {
  const resolvedSource = getOrderSource(source);
  const config = {
    campaign: {
      Icon: DollarSign,
      className: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-700',
    },
    organic: {
      Icon: UserRound,
      className: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-700',
    },
    other: {
      Icon: List,
      className: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600',
    },
  }[resolvedSource];
  const { Icon } = config;
  const label = getOrderSourceLabel(resolvedSource, language);

  return (
    <span
      title={label}
      aria-label={label}
      className={`inline-flex items-center gap-1 rounded-full border font-extrabold whitespace-nowrap ${config.className} ${compact ? 'p-1' : 'px-2 py-1 text-[10px]'}`}
    >
      <Icon className={compact ? 'w-3.5 h-3.5' : 'w-3 h-3'} aria-hidden="true" />
      {!compact && <span>{label}</span>}
    </span>
  );
};
